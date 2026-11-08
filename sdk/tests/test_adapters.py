import numpy as np
import pytest
import torch
import torch.nn as nn

from federix_sdk import ModelAdapter
from federix_sdk.adapters.pytorch import TorchAdapter

BRAIN_MLP_SPEC_PREFIX = "209dc8ee689348b5"


def brain_mlp():
    return nn.Sequential(nn.Flatten(), nn.Linear(784, 128), nn.ReLU(), nn.Linear(128, 10))


def test_the_torch_adapter_is_a_model_adapter():
    assert isinstance(TorchAdapter(brain_mlp()), ModelAdapter)
    assert TorchAdapter.framework == "pytorch"


def test_the_spec_hash_matches_the_brain_for_the_same_architecture():
    spec = TorchAdapter(brain_mlp()).spec()
    assert spec.size == 101770
    assert spec.hash.startswith(BRAIN_MLP_SPEC_PREFIX)


def test_weights_round_trip_between_two_models():
    torch.manual_seed(0)
    a, b = TorchAdapter(brain_mlp()), TorchAdapter(brain_mlp())
    b.set_weights(a.get_weights())
    x = torch.randn(3, 1, 28, 28)
    assert torch.equal(a.model(x), b.model(x))
    assert a.get_weights().dtype == np.float32


def test_bad_vectors_and_dtypes_are_refused():
    a = TorchAdapter(brain_mlp())
    with pytest.raises(ValueError, match="101770 parameters"):
        a.set_weights(np.zeros(5, dtype=np.float32))
    bad = np.zeros(101770, dtype=np.float32)
    bad[3] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        a.set_weights(bad)
    with pytest.raises(ValueError, match="float32"):
        TorchAdapter(nn.Linear(2, 2).double())
