import numpy as np
import pytest
import torch
from torch.utils.data import TensorDataset

from federix.config import Config
from federix.data import dirichlet_split, make_clients
from federix.model import make_model


def test_split_uses_every_sample_once_and_is_reproducible():
    labels = np.random.default_rng(0).integers(0, 10, 5000)
    parts = dirichlet_split(labels, num_clients=10, alpha=0.1, min_size=10, seed=0)
    allidx = np.concatenate(parts)
    assert len(parts) == 10 and min(len(p) for p in parts) >= 10
    assert len(allidx) == len(labels) and len(set(allidx)) == len(labels)
    again = dirichlet_split(labels, 10, 0.1, 10, 0)
    assert all((a == b).all() for a, b in zip(parts, again))
    skew = lambda ps: np.mean([np.bincount(labels[p], minlength=10).max() / len(p) for p in ps])
    assert skew(parts) > skew(dirichlet_split(labels, 10, 100.0, 10, 0)) + 0.2


def test_impossible_split_fails_immediately():
    labels = np.zeros(50, dtype=int)
    with pytest.raises(ValueError, match="cannot give 10 clients at least 10 samples each from 50 samples"):
        dirichlet_split(labels, num_clients=10, alpha=0.1, min_size=10)


def test_unlucky_split_gives_up_after_max_attempts():
    labels = np.random.default_rng(0).integers(0, 10, 200)
    with pytest.raises(ValueError, match="in 3 attempts"):
        dirichlet_split(labels, num_clients=19, alpha=0.01, min_size=10, max_attempts=3)


def test_clients_get_disjoint_train_and_held_out_sets():
    n = 2000
    y = torch.from_numpy(np.random.default_rng(1).integers(0, 10, n))
    train = TensorDataset(torch.zeros(n, 1, 28, 28), y)
    cfg = Config(num_clients=5, clients_per_round=2, dirichlet_alpha=1.0, val_fraction=0.25)
    clients = make_clients(train, cfg)
    seen = []
    for c in clients:
        tr, va = set(c.train.indices.tolist()), set(c.val.indices.tolist())
        assert tr and va and not (tr & va)
        assert abs(len(va) / len(c) - 0.25) < 0.05
        seen += list(tr | va)
    assert sorted(seen) == list(range(n))


def test_model_shape():
    assert make_model()(torch.randn(4, 1, 28, 28)).shape == (4, 10)
