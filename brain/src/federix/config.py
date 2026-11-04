from dataclasses import dataclass

@dataclass
class Config:
    # --- hardware (CPU only) ---
    device: str = "cpu"
    num_threads: int = 4              # lower to 2 if your laptop gets hot/slow
    # --- federated setup ---
    num_clients: int = 10
    clients_per_round: int = 5
    rounds: int = 20
    local_epochs: int = 1
    batch_size: int = 64
    lr: float = 0.05
    dirichlet_alpha: float = 0.1      # non-IID skew (paper uses 0.1)
    min_client_samples: int = 10      # resample the split until every client has at least this many
    data_dir: str = "data"            # where MNIST is downloaded (git-ignored)
    # --- FedProx ---
    mu: float = 0.01
    # --- utility u = a*q + b*s + c*r (used from Step 4) ---
    a: float = 1.0
    b: float = 0.5
    c: float = 0.3
    eps: float = 1e-8
    # --- compression tiers (used from Step 5) ---
    tau_high: float = 0.9
    tau_low: float = 0.5
    ratios: tuple = (1.0, 0.5, 0.1)   # high / medium / low utility
    # --- aggregation (used from Step 6) ---
    temperature: float = 1.0
    # --- misc ---
    seed: int = 0
    log_dir: str = "logs"

def setup_cpu(cfg: Config):
    """Seed everything and limit CPU threads. Call once at program start."""
    import random, numpy as np, torch
    random.seed(cfg.seed); np.random.seed(cfg.seed); torch.manual_seed(cfg.seed)
    torch.set_num_threads(cfg.num_threads)