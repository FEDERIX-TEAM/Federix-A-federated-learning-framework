import pytest
import torch
from torch.utils.data import TensorDataset


def prototype_dataset(n, classes=10, noise=0.3, seed=0, proto_seed=1234):
    protos = torch.randn(classes, 1, 28, 28, generator=torch.Generator().manual_seed(proto_seed))
    g = torch.Generator().manual_seed(seed)
    y = torch.randint(0, classes, (n,), generator=g)
    return TensorDataset(protos[y] + noise * torch.randn(n, 1, 28, 28, generator=g), y)


@pytest.fixture
def small_datasets():
    return prototype_dataset(1200, seed=1), prototype_dataset(300, seed=2)
