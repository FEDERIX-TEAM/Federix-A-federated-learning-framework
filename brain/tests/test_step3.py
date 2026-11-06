import torch
from torch.nn.utils import parameters_to_vector as flat
from torch.utils.data import Subset

from federix.aggregation import aggregate, sample_weights
from federix.config import Config
from federix.data import ClientData
from federix.evaluation import evaluate
from federix.fedprox import local_train, mean_loss
from federix.model import make_model
from conftest import prototype_dataset


def client_of(ds, n_val=64):
    idx = torch.arange(len(ds))
    return ClientData(train=Subset(ds, idx[n_val:].tolist()), val=Subset(ds, idx[:n_val].tolist()))


def test_fedprox_reduces_held_out_loss_and_mu_keeps_clients_close():
    torch.manual_seed(0)
    model, client = make_model(), client_of(prototype_dataset(320))
    w = flat(model.parameters()).detach()
    d0, lb, la = local_train(model, w, client, Config(mu=0.0, lr=0.01, local_epochs=10))
    assert la < lb and d0.shape == w.shape
    d1, _, _ = local_train(model, w, client, Config(mu=10.0, lr=0.01, local_epochs=10))
    assert d1.norm() < d0.norm()


def test_losses_are_measured_on_the_held_out_split_not_the_training_data():
    torch.manual_seed(0)
    train_part = prototype_dataset(256, seed=3)
    held_out = prototype_dataset(64, seed=99)
    client = ClientData(train=Subset(train_part, list(range(256))), val=Subset(held_out, list(range(64))))
    model = make_model()
    w = flat(model.parameters()).detach()
    _, before, after = local_train(model, w, client, Config(mu=0.0, lr=0.01, local_epochs=1))
    from torch.nn.utils import vector_to_parameters
    vector_to_parameters(w.clone(), model.parameters())
    assert abs(before - mean_loss(model, client.val)) < 1e-6
    assert abs(before - mean_loss(model, client.train)) > 1e-3


def test_aggregate():
    wt = sample_weights([100, 300])
    assert torch.allclose(wt, torch.tensor([0.25, 0.75]))
    out = aggregate(torch.zeros(3), [torch.ones(3), 3 * torch.ones(3)], wt)
    assert torch.allclose(out, torch.full((3,), 2.5))


def test_evaluate_reports_accuracy_and_loss():
    torch.manual_seed(0)
    model = make_model()
    w = flat(model.parameters()).detach()
    m = evaluate(model, w, prototype_dataset(200))
    assert set(m) == {"acc", "loss"}
    assert 0 <= m["acc"] <= 1 and m["loss"] > 0
