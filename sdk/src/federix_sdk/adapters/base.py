from abc import ABC, abstractmethod

import numpy as np

from federix_sdk.spec import ModelSpec


class ModelAdapter(ABC):
    framework = "unknown"

    @abstractmethod
    def spec(self) -> ModelSpec:
        raise NotImplementedError

    @abstractmethod
    def get_weights(self) -> np.ndarray:
        raise NotImplementedError

    @abstractmethod
    def set_weights(self, vector: np.ndarray) -> None:
        raise NotImplementedError

    def check_vector(self, vector):
        vector = np.asarray(vector, dtype=np.float32)
        expected = self.spec().size
        if vector.ndim != 1 or vector.size != expected:
            raise ValueError(f"weights vector has {vector.size} values but the model has {expected} parameters")
        if not np.all(np.isfinite(vector)):
            raise ValueError("weights vector contains non-finite values")
        return vector
