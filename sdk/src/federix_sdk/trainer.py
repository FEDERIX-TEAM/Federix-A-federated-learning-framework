import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(frozen=True)
class RoundConfig:
    mu: float
    local_epochs: int
    batch_size: int
    utility: dict = field(default_factory=dict)

    @classmethod
    def from_response(cls, res):
        u = res.utility
        return cls(
            mu=res.mu,
            local_epochs=max(1, res.local_epochs),
            batch_size=max(1, res.batch_size),
            utility={f.name: getattr(u, f.name) for f in u.DESCRIPTOR.fields},
        )


@dataclass(frozen=True)
class TrainResult:
    loss_before: float
    loss_after: float


class Trainer(ABC):
    adapter = None

    @abstractmethod
    def num_samples(self) -> int:
        raise NotImplementedError

    @abstractmethod
    def label_counts(self) -> dict:
        raise NotImplementedError

    @abstractmethod
    def train(self, config: RoundConfig) -> TrainResult:
        raise NotImplementedError


def warn_if_unstable(lr, mu):
    if lr * mu >= 2:
        logging.getLogger("federix_sdk").warning(
            "lr * mu = %.3g >= 2: plain SGD on the FedProx term will diverge; lower lr or ask the admin to lower mu", lr * mu
        )
        return True
    return False
