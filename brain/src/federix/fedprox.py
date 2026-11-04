"""FedProx local training: min F_k(w) + (mu/2)||w - w_t||^2   (Eq. 1)"""
import torch, torch.nn.functional as F
from torch.nn.utils import parameters_to_vector as flat, vector_to_parameters as unflat
from torch.utils.data import DataLoader

@torch.no_grad()
def local_loss(model, data):
    """Mean cross-entropy over a client's data (batched, so large clients stay cheap)."""
    model.eval()
    total = sum(F.cross_entropy(model(x), y, reduction="sum").item() for x, y in DataLoader(data, batch_size=1024))
    return total / len(data)

def local_train(model, global_vec, data, cfg):
    """Train from the global weights; return (delta = w_k - w_t, loss_before, loss_after)."""
    unflat(global_vec.clone(), model.parameters())
    before = local_loss(model, data)
    opt = torch.optim.SGD(model.parameters(), lr=cfg.lr)
    model.train()
    for _ in range(cfg.local_epochs):
        for x, y in DataLoader(data, batch_size=cfg.batch_size, shuffle=True):
            opt.zero_grad()
            prox = (cfg.mu / 2) * (flat(model.parameters()) - global_vec).pow(2).sum()   # proximal term
            (F.cross_entropy(model(x), y) + prox).backward()
            opt.step()
    after = local_loss(model, data)
    return (flat(model.parameters()) - global_vec).detach(), before, after