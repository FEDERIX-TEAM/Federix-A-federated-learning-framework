from abc import ABC, abstractmethod

import numpy as np

from federix_sdk.layout import Layout
from federix_sdk.spec import ModelSpec


class ModelAdapter(ABC):
    framework = "unknown"

    def __init__(self, layout=None):
        self.layout = layout if layout is None or isinstance(layout, Layout) else Layout(layout)
        local = self._local_params()
        bad = [name for name, arr in local if np.asarray(arr).dtype != np.float32]
        if bad:
            raise ValueError(f"only float32 parameters are supported; convert these first: {', '.join(bad)}")
        shapes = {name: tuple(np.shape(arr)) for name, arr in local}
        if self.layout is None:
            self._plan = [(name, name, False) for name, _ in local]
        else:
            self._plan = self.layout.resolve(shapes)
        self._local_shapes = shapes
        self._spec = ModelSpec.from_pairs(
            (name, shapes[source][::-1] if transpose else shapes[source]) for name, source, transpose in self._plan
        )

    @abstractmethod
    def _local_params(self):
        raise NotImplementedError

    @abstractmethod
    def _load_local(self, arrays):
        raise NotImplementedError

    def spec(self) -> ModelSpec:
        return self._spec

    def get_weights(self) -> np.ndarray:
        local = dict(self._local_params())
        parts = []
        for _, source, transpose in self._plan:
            arr = np.asarray(local[source], dtype=np.float32)
            parts.append((arr.T if transpose else arr).ravel())
        return np.concatenate(parts).astype(np.float32)

    def set_weights(self, vector: np.ndarray) -> None:
        vector = self.check_vector(vector)
        arrays = {}
        offset = 0
        for (name, source, transpose), param in zip(self._plan, self._spec.params):
            n = param.size
            block = vector[offset:offset + n].reshape(param.shape)
            arrays[source] = np.ascontiguousarray(block.T if transpose else block)
            offset += n
        self._load_local(arrays)

    def check_vector(self, vector):
        vector = np.asarray(vector, dtype=np.float32)
        expected = self._spec.size
        if vector.ndim != 1 or vector.size != expected:
            raise ValueError(f"weights vector has {vector.size} values but the model has {expected} parameters")
        if not np.all(np.isfinite(vector)):
            raise ValueError("weights vector contains non-finite values")
        return vector
