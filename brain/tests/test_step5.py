import json
import struct
from pathlib import Path

import numpy as np
import pytest
import torch

from federix.adapters.pytorch import load_vector, spec_of, to_vector
from federix_sdk.codec import HEADER_SIZE, CodecError, DensePayload, TopKPayload, decode, encode, encoded_size
from federix_sdk.compression import ErrorFeedback, compress, topk_count
from federix.model import make_model
from federix_sdk.spec import ModelSpec

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "spec" / "codec_vectors.json").read_text())
SPEC = ModelSpec.from_pairs(VECTORS["spec"]["params"])


def test_spec_hash_matches_the_shared_vector():
    assert SPEC.canonical() == VECTORS["spec"]["canonical"]
    assert SPEC.hash == VECTORS["spec"]["sha256"]
    assert SPEC.size == 9


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["name"] for c in VECTORS["cases"]])
def test_matches_the_shared_codec_vector(case):
    residual = None if case["residual_in"] is None else np.array(case["residual_in"], dtype=np.float32)
    payload, new_residual = compress(np.array(case["delta"], dtype=np.float32), case["ratio"], residual)
    blob = encode(payload, SPEC.digest)
    assert blob.hex() == case["encoded_hex"]
    assert len(blob) == case["encoded_size"] == encoded_size(payload)
    np.testing.assert_array_equal(new_residual, np.array(case["residual_out"], dtype=np.float32))

    decoded, digest = decode(bytes.fromhex(case["encoded_hex"]), expected_digest=SPEC.digest)
    assert digest == SPEC.digest
    if case["kind"] == "dense":
        assert isinstance(decoded, DensePayload)
        np.testing.assert_array_equal(decoded.values, np.array(case["values"], dtype=np.float32))
    else:
        assert isinstance(decoded, TopKPayload)
        assert decoded.indices.tolist() == case["indices"]
        np.testing.assert_array_equal(decoded.values, np.array(case["values"], dtype=np.float32))


def test_spec_hash_changes_with_names_shapes_and_order():
    base = ModelSpec.from_pairs([("a", (2, 3)), ("b", (3,))])
    assert base.hash == ModelSpec.from_pairs([("a", (2, 3)), ("b", (3,))]).hash
    assert base.hash != ModelSpec.from_pairs([("a", (3, 2)), ("b", (3,))]).hash
    assert base.hash != ModelSpec.from_pairs([("b", (3,)), ("a", (2, 3))]).hash
    assert base.hash != ModelSpec.from_pairs([("x", (2, 3)), ("b", (3,))]).hash
    with pytest.raises(ValueError, match="unique"):
        ModelSpec.from_pairs([("a", (1,)), ("a", (2,))])
    with pytest.raises(ValueError, match="invalid shape"):
        ModelSpec.from_pairs([("a", (0,))])


def test_random_round_trips_are_exact():
    rng = np.random.default_rng(0)
    for ratio in (1.0, 0.5, 0.3, 0.1, 0.01):
        delta = rng.normal(size=5000).astype(np.float32)
        payload, _ = compress(delta, ratio)
        decoded, _ = decode(encode(payload, SPEC.digest))
        np.testing.assert_array_equal(decoded.to_dense(), payload.to_dense())


def test_top_k_keeps_exactly_k_of_the_largest_values():
    rng = np.random.default_rng(1)
    delta = rng.normal(size=1000).astype(np.float32)
    payload, _ = compress(delta, 0.1)
    assert isinstance(payload, TopKPayload) and payload.indices.size == 100
    kept = np.abs(delta[payload.indices]).min()
    dropped = np.delete(np.abs(delta), payload.indices).max()
    assert kept >= dropped


def test_compressed_size_follows_the_ratio():
    delta = np.random.default_rng(2).normal(size=101770).astype(np.float32)
    dense = encoded_size(compress(delta, 1.0)[0])
    assert dense == HEADER_SIZE + 4 * 101770
    sparse = encoded_size(compress(delta, 0.1)[0])
    assert sparse == HEADER_SIZE + 8 * topk_count(0.1, 101770)
    assert sparse / dense < 0.21
    assert encoded_size(compress(delta, 0.5)[0]) == dense


def test_error_feedback_never_loses_anything():
    rng = np.random.default_rng(3)
    ef = ErrorFeedback()
    deltas = [rng.normal(size=500).astype(np.float32) for _ in range(20)]
    sent = np.zeros(500, dtype=np.float64)
    for d in deltas:
        sent += ef.compress("c1", d, 0.05).to_dense()
    total = np.sum(np.stack(deltas).astype(np.float64), axis=0)
    np.testing.assert_allclose(sent + ef.residual("c1"), total, atol=1e-4)
    assert ErrorFeedback(enabled=False).residual("c1") is None


def test_error_feedback_is_kept_per_client():
    ef = ErrorFeedback()
    ef.compress("a", np.array([1, 2, 3, 4, 5, 6, 7, 8], dtype=np.float32), 0.125)
    assert ef.residual("b") is None
    assert ef.residual("a")[7] == 0 and ef.residual("a")[0] == 1


def corrupt(blob, offset, value):
    b = bytearray(blob)
    b[offset:offset + len(value)] = value
    return bytes(b)


def test_decode_refuses_damaged_or_foreign_files():
    good = encode(TopKPayload(10, np.array([1, 4, 7]), np.array([1, 2, 3], dtype=np.float32)), SPEC.digest)
    cases = {
        "not an FXW1 file": corrupt(good, 0, b"NOPE"),
        "unsupported dtype": corrupt(good, 5, b"\x02"),
        "reserved header bytes": corrupt(good, 6, b"\x01"),
        "unknown payload kind": corrupt(good, 4, b"\x09"),
        "body size": good[:-1],
        "shorter than": good[:10],
        "strictly ascending": corrupt(good, HEADER_SIZE, struct.pack("<III", 4, 1, 7)),
        "inside the vector": corrupt(good, HEADER_SIZE + 8, struct.pack("<I", 10)),
        "must be finite": corrupt(good, HEADER_SIZE + 12, struct.pack("<f", float("nan"))),
    }
    for message, blob in cases.items():
        with pytest.raises(CodecError, match=message):
            decode(blob)
    with pytest.raises(CodecError, match="spec hash does not match"):
        decode(good, expected_digest=b"\x00" * 32)
    with pytest.raises(CodecError, match="does not match the expected"):
        decode(good, expected_length=11)
    with pytest.raises(CodecError, match="body size"):
        decode(good + b"\x00")


def test_the_pytorch_adapter_round_trips_a_model():
    torch.manual_seed(0)
    a, b = make_model(), make_model()
    load_vector(b, to_vector(a))
    x = torch.randn(4, 1, 28, 28)
    assert torch.equal(a(x), b(x))
    assert spec_of(a).hash == spec_of(b).hash
    with pytest.raises(ValueError, match="parameters"):
        load_vector(b, np.zeros(3, dtype=np.float32))


def test_compression_rejects_bad_ratios():
    for bad in (0, -0.1, 1.5):
        with pytest.raises(ValueError):
            topk_count(bad, 10)
