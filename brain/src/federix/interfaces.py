from dataclasses import dataclass


@dataclass
class ClientUpdate:
    client_id: str
    payload: tuple
    num_samples: int
    loss_before: float = 0.0
    loss_after: float = 0.0
    utility: float = 0.0
    ratio: float = 1.0
    bytes_sent: int = 0
