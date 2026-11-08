import math

import numpy as np

from federix_sdk.codec import DensePayload, TopKPayload


def topk_count(ratio, length):
    if not (0 < ratio <= 1):
        raise ValueError(f"ratio must be within (0, 1] (got {ratio})")
    return min(length, max(1, math.floor(ratio * length + 0.5)))


def topk_indices(vector, k):
    order = np.argsort(-np.abs(vector), kind="stable")
    return np.sort(order[:k])


def compress(delta, ratio, residual=None):
    delta = np.asarray(delta, dtype=np.float32)
    corrected = delta if residual is None else delta + np.asarray(residual, dtype=np.float32)
    n = corrected.size
    k = topk_count(ratio, n) if n else 0
    if ratio >= 1 or 2 * k >= n:
        return DensePayload(corrected.copy()), np.zeros(n, dtype=np.float32)
    idx = topk_indices(corrected, k)
    payload = TopKPayload(n, idx.astype(np.int64), corrected[idx].astype(np.float32))
    new_residual = corrected.copy()
    new_residual[idx] = 0.0
    return payload, new_residual


class ErrorFeedback:
    def __init__(self, enabled=True):
        self.enabled = enabled
        self._residuals = {}

    def compress(self, client_id, delta, ratio):
        residual = self._residuals.get(client_id) if self.enabled else None
        payload, new_residual = compress(delta, ratio, residual)
        if self.enabled:
            self._residuals[client_id] = new_residual
        return payload

    def residual(self, client_id):
        return self._residuals.get(client_id)
