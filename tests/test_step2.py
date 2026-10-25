import os
import numpy as np
from federix.config import Config
from federix.data import dirichlet_split
import torch
from federix.model import make_model
 
def test_split():
    labels = np.random.default_rng(0).integers(0, 10, 5000)
    parts = dirichlet_split(labels, num_clients=10, alpha=0.1, min_size=10, seed=0)
    allidx = np.concatenate(parts)
    assert len(parts) == 10 and min(len(p) for p in parts) >= 10
    assert len(allidx) == len(labels) and len(set(allidx)) == len(labels)   # every sample used exactly once
    again = dirichlet_split(labels, 10, 0.1, 10, 0)
    assert all((a == b).all() for a, b in zip(parts, again))                # reproducible with same seed
    # alpha=0.1 must be far more skewed than alpha=100 (nearly IID)
    skew = lambda ps: np.mean([np.bincount(labels[p], minlength=10).max() / len(p) for p in ps])
    assert skew(parts) > skew(dirichlet_split(labels, 10, 100.0, 10, 0)) + 0.2
    print("split ok")
 
def test_model():
    out = make_model()(torch.randn(4, 1, 28, 28))
    assert out.shape == (4, 10)
    print("model ok")
 
if __name__ == "__main__":
    test_split(); test_model()
    print("Step 2 tests passed")