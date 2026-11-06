import struct
from dataclasses import dataclass

import numpy as np

MAGIC = b"FXW1"
KIND_DENSE = 1
KIND_TOPK = 2
DTYPE_FLOAT32 = 1
HEADER = struct.Struct("<4sBBHQQ32s")
HEADER_SIZE = HEADER.size
MAX_LENGTH = 2**32 - 1


class CodecError(ValueError):
    pass


@dataclass(frozen=True)
class DensePayload:
    values: np.ndarray

    @property
    def length(self):
        return int(self.values.size)

    def to_dense(self):
        return self.values.astype(np.float32, copy=True)


@dataclass(frozen=True)
class TopKPayload:
    length: int
    indices: np.ndarray
    values: np.ndarray

    def to_dense(self):
        out = np.zeros(self.length, dtype=np.float32)
        out[self.indices] = self.values
        return out


def encoded_size(payload):
    if isinstance(payload, DensePayload):
        return HEADER_SIZE + 4 * payload.length
    return HEADER_SIZE + 8 * int(payload.indices.size)


def encode(payload, spec_digest):
    if len(spec_digest) != 32:
        raise CodecError("spec digest must be 32 bytes")
    if isinstance(payload, DensePayload):
        values = np.ascontiguousarray(payload.values, dtype="<f4")
        if values.ndim != 1 or values.size > MAX_LENGTH:
            raise CodecError("dense values must be a 1-D array of at most 2^32-1 floats")
        header = HEADER.pack(MAGIC, KIND_DENSE, DTYPE_FLOAT32, 0, values.size, values.size, spec_digest)
        return header + values.tobytes()
    if isinstance(payload, TopKPayload):
        indices = np.ascontiguousarray(payload.indices, dtype="<u4")
        values = np.ascontiguousarray(payload.values, dtype="<f4")
        if indices.shape != values.shape or indices.ndim != 1:
            raise CodecError("top-k indices and values must be 1-D arrays of the same length")
        if payload.length > MAX_LENGTH or indices.size > payload.length:
            raise CodecError("top-k payload is larger than its vector")
        header = HEADER.pack(MAGIC, KIND_TOPK, DTYPE_FLOAT32, 0, payload.length, indices.size, spec_digest)
        return header + indices.tobytes() + values.tobytes()
    raise CodecError(f"cannot encode {type(payload).__name__}")


def decode(data, expected_digest=None, expected_length=None):
    if len(data) < HEADER_SIZE:
        raise CodecError(f"file is {len(data)} bytes, shorter than the {HEADER_SIZE}-byte header")
    magic, kind, dtype, reserved, length, count, digest = HEADER.unpack_from(data)
    if magic != MAGIC:
        raise CodecError("not an FXW1 file")
    if dtype != DTYPE_FLOAT32:
        raise CodecError(f"unsupported dtype code {dtype}")
    if reserved != 0:
        raise CodecError("reserved header bytes must be zero")
    if expected_digest is not None and digest != expected_digest:
        raise CodecError("model spec hash does not match; the update was made for a different model")
    if expected_length is not None and length != expected_length:
        raise CodecError(f"vector length {length} does not match the expected {expected_length}")
    body = memoryview(data)[HEADER_SIZE:]

    if kind == KIND_DENSE:
        if count != length or len(body) != 4 * length:
            raise CodecError("dense body size does not match its header")
        values = np.frombuffer(body, dtype="<f4").astype(np.float32)
        if not np.all(np.isfinite(values)):
            raise CodecError("dense values must be finite")
        return DensePayload(values), digest

    if kind == KIND_TOPK:
        if count > length or len(body) != 8 * count:
            raise CodecError("top-k body size does not match its header")
        indices = np.frombuffer(body[: 4 * count], dtype="<u4").astype(np.int64)
        values = np.frombuffer(body[4 * count:], dtype="<f4").astype(np.float32)
        if count and (indices[-1] >= length or np.any(np.diff(indices) <= 0)):
            raise CodecError("top-k indices must be strictly ascending and inside the vector")
        if not np.all(np.isfinite(values)):
            raise CodecError("top-k values must be finite")
        return TopKPayload(int(length), indices, values), digest

    raise CodecError(f"unknown payload kind {kind}")
