
import torch
from torch.utils.data import TensorDataset
from torch.nn.utils import parameters_to_vector as flat
from federix.config import Config
from federix.model import make_model
from federix.fedprox import local_train
from federix.aggregation import sample_weights, aggregate

def toy_data(n=256):
    g = torch.Generator().manual_seed(0)
    y = torch.randint(0, 10, (n,), generator=g)
    protos = torch.randn(10, 1, 28, 28, generator=g)
    return TensorDataset(protos[y] + 0.3 * torch.randn(n, 1, 28, 28, generator=g), y)

def test_fedprox():
    torch.manual_seed(0)
    model, data = make_model(), toy_data()
    w = flat(model.parameters()).detach()
    d0, lb, la = local_train(model, w, data, Config(mu=0.0, lr=0.01, local_epochs=10))
    assert la < lb and d0.shape == w.shape                      # local training reduces local loss
    d1, _, _ = local_train(model, w, data, Config(mu=10.0, lr=0.01, local_epochs=10))
    assert d1.norm() < d0.norm()                                # proximal term keeps client near global model
    print("fedprox ok")

def test_aggregate():
    wt = sample_weights([100, 300])
    assert torch.allclose(wt, torch.tensor([0.25, 0.75]))
    out = aggregate(torch.zeros(3), [torch.ones(3), 3 * torch.ones(3)], wt)
    assert torch.allclose(out, torch.full((3,), 2.5))           # 0.25*1 + 0.75*3
    print("aggregate ok")

if __name__ == "__main__":
    test_fedprox(); test_aggregate()
    print("Step 3 tests passed")