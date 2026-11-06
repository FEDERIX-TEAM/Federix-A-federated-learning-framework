import hashlib
import json
import math
from dataclasses import dataclass

SUPPORTED_DTYPES = ("float32",)


@dataclass(frozen=True)
class ParamSpec:
    name: str
    shape: tuple
    dtype: str = "float32"

    @property
    def size(self):
        return math.prod(self.shape)


@dataclass(frozen=True)
class ModelSpec:
    params: tuple

    def __post_init__(self):
        names = [p.name for p in self.params]
        if not names:
            raise ValueError("a model spec needs at least one parameter")
        if len(set(names)) != len(names):
            raise ValueError("parameter names in a model spec must be unique")
        for p in self.params:
            if p.dtype not in SUPPORTED_DTYPES:
                raise ValueError(f"parameter {p.name} has unsupported dtype {p.dtype}")
            if any(not isinstance(d, int) or d < 1 for d in p.shape):
                raise ValueError(f"parameter {p.name} has an invalid shape {p.shape}")

    @property
    def size(self):
        return sum(p.size for p in self.params)

    def canonical(self):
        body = {"version": 1, "params": [[p.name, list(p.shape), p.dtype] for p in self.params]}
        return json.dumps(body, separators=(",", ":"), sort_keys=True)

    @property
    def digest(self):
        return hashlib.sha256(self.canonical().encode()).digest()

    @property
    def hash(self):
        return self.digest.hex()

    @classmethod
    def from_pairs(cls, pairs):
        return cls(tuple(ParamSpec(name, tuple(int(d) for d in shape)) for name, shape in pairs))
