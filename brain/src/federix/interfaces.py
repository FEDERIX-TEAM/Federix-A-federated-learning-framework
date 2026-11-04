"""Shared contract between modules. Teammates only depend on this type.
Kept free of torch imports so it is lightweight and easy to test."""
from dataclasses import dataclass

@dataclass
class ClientUpdate:
    client_id: int
    payload: tuple              # (possibly compressed) delta, format defined in compression.py (Step 5)
    num_samples: int            # n_k = |D_k|
    loss_before: float = 0.0    # local loss before training  (for quality score q)
    loss_after: float = 0.0     # local loss after training
    utility: float = 0.0        # u_k, filled by the utility engine (Step 4)
    ratio: float = 1.0          # compression ratio c_k used (Step 5)
    bytes_sent: int = 0         # uplink bytes, for communication accounting
