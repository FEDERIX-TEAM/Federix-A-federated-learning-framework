import numpy as np
from torchvision import datasets
from torch.utils.data import TensorDataset
from torch.utils.data import Subset
def load_mnist(data_dir="data"):
    """Normalised MNIST (train, test) as in-memory TensorDatasets. Downloads on first use."""
    def to_ds(train):
        d = datasets.MNIST(data_dir, train=train, download=True)
        x = ((d.data.float() / 255 - 0.1307) / 0.3081).unsqueeze(1)   # standard MNIST mean/std
        return TensorDataset(x, d.targets)
    return to_ds(True), to_ds(False)

def dirichlet_split(labels, num_clients, alpha, min_size=10, seed=0):
    """Label-skew split: for each class, share its samples among clients with proportions ~ Dir(alpha).
    Smaller alpha = more skew. Resamples until every client has >= min_size samples."""
    rng = np.random.default_rng(seed)
    labels = np.asarray(labels)
    while True:
        parts = [[] for _ in range(num_clients)]
        for cls in np.unique(labels):
            ids = rng.permutation(np.where(labels == cls)[0])
            cuts = (np.cumsum(rng.dirichlet([alpha] * num_clients))[:-1] * len(ids)).astype(int)
            for k, chunk in enumerate(np.split(ids, cuts)):
                parts[k] += chunk.tolist()
        if min(len(p) for p in parts) >= min_size:
            return [np.array(sorted(p)) for p in parts]

def make_clients(train, cfg):
    """List of per-client Datasets (torch Subsets) built from the Dirichlet split."""
    parts = dirichlet_split(train.tensors[1].numpy(), cfg.num_clients, cfg.dirichlet_alpha,cfg.min_client_samples, cfg.seed)
                            
    return [Subset(train, p) for p in parts]