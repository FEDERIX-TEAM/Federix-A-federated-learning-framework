from dataclasses import dataclass

import numpy as np
from torch.utils.data import Subset, TensorDataset
from torchvision import datasets


@dataclass
class ClientData:
    train: Subset
    val: Subset

    def __len__(self):
        return len(self.train) + len(self.val)


def load_mnist(data_dir="data"):
    def to_ds(train):
        d = datasets.MNIST(data_dir, train=train, download=True)
        x = ((d.data.float() / 255 - 0.1307) / 0.3081).unsqueeze(1)
        return TensorDataset(x, d.targets)

    return to_ds(True), to_ds(False)


def dirichlet_split(labels, num_clients, alpha, min_size=10, seed=0, max_attempts=1000):
    labels = np.asarray(labels)
    if num_clients * min_size > len(labels):
        raise ValueError(
            f"cannot give {num_clients} clients at least {min_size} samples each from {len(labels)} samples"
        )
    rng = np.random.default_rng(seed)
    smallest = 0
    for _ in range(max_attempts):
        parts = [[] for _ in range(num_clients)]
        for cls in np.unique(labels):
            ids = rng.permutation(np.where(labels == cls)[0])
            cuts = (np.cumsum(rng.dirichlet([alpha] * num_clients))[:-1] * len(ids)).astype(int)
            for k, chunk in enumerate(np.split(ids, cuts)):
                parts[k] += chunk.tolist()
        smallest = min(len(p) for p in parts)
        if smallest >= min_size:
            return [np.array(sorted(p)) for p in parts]
    raise ValueError(
        f"no Dirichlet split with alpha={alpha} gave every client >= {min_size} samples in {max_attempts} attempts "
        f"(smallest client in the last attempt had {smallest}); raise dirichlet_alpha or lower min_client_samples"
    )


def train_val_split(indices, val_fraction, rng):
    shuffled = rng.permutation(indices)
    n_val = min(len(shuffled) - 1, max(1, int(round(len(shuffled) * val_fraction))))
    return np.sort(shuffled[n_val:]), np.sort(shuffled[:n_val])


def make_clients(train, cfg):
    parts = dirichlet_split(
        train.tensors[1].numpy(), cfg.num_clients, cfg.dirichlet_alpha, cfg.min_client_samples, cfg.seed, cfg.split_max_attempts
    )
    rng = np.random.default_rng(cfg.seed + 1)
    clients = []
    for part in parts:
        tr, va = train_val_split(part, cfg.val_fraction, rng)
        clients.append(ClientData(train=Subset(train, tr), val=Subset(train, va)))
    return clients
