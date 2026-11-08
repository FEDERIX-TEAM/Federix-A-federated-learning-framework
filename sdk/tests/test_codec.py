import json
from pathlib import Path

import numpy as np
import pytest

from federix_sdk import CodecError, DensePayload, ErrorFeedback, ModelSpec, TopKPayload, compress, decode, encode

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "spec" / "codec_vectors.json").read_text())
SPEC = ModelSpec.from_pairs(VECTORS["spec"]["params"])


def test_spec_hash_matches_the_shared_vector():
    assert SPEC.canonical() == VECTORS["spec"]["canonical"]
    assert SPEC.hash == VECTORS["spec"]["sha256"]


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["name"] for c in VECTORS["cases"]])
def test_matches_the_shared_codec_vector(case):
    residual = None if case["residual_in"] is None else np.array(case["residual_in"], dtype=np.float32)
    payload, new_residual = compress(np.array(case["delta"], dtype=np.float32), case["ratio"], residual)
    assert encode(payload, SPEC.digest).hex() == case["encoded_hex"]
    np.testing.assert_array_equal(new_residual, np.array(case["residual_out"], dtype=np.float32))
    decoded, _ = decode(bytes.fromhex(case["encoded_hex"]), expected_digest=SPEC.digest)
    assert isinstance(decoded, DensePayload if case["kind"] == "dense" else TopKPayload)


def test_decode_refuses_a_file_made_for_another_model():
    blob = encode(DensePayload(np.ones(3, dtype=np.float32)), SPEC.digest)
    with pytest.raises(CodecError, match="different model"):
        decode(blob, expected_digest=b"\x01" * 32)


def test_error_feedback_keeps_what_was_not_sent():
    ef = ErrorFeedback()
    ef.compress("me", np.arange(10, dtype=np.float32), 0.2)
    assert ef.residual("me")[:8].tolist() == list(range(8))
