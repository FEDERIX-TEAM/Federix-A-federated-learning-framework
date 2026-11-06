import torch
import torch.nn.functional as F
from torch.nn.utils import parameters_to_vector as flat
from torch.nn.utils import vector_to_parameters as unflat
from torch.utils.data import DataLoader


@torch.no_grad()
def mean_loss(model, data, batch_size=1024):
    model.eval()
    total = sum(F.cross_entropy(model(x), y, reduction="sum").item() for x, y in DataLoader(data, batch_size=batch_size))
    return total / len(data)


def local_train(model, global_vec, client, cfg):
    unflat(global_vec.clone(), model.parameters())
    before = mean_loss(model, client.val, cfg.eval_batch_size)
    opt = torch.optim.SGD(model.parameters(), lr=cfg.lr)
    model.train()
    for _ in range(cfg.local_epochs):
        for x, y in DataLoader(client.train, batch_size=cfg.batch_size, shuffle=True):
            opt.zero_grad()
            prox = (cfg.mu / 2) * (flat(model.parameters()) - global_vec).pow(2).sum()
            (F.cross_entropy(model(x), y) + prox).backward()
            opt.step()
    after = mean_loss(model, client.val, cfg.eval_batch_size)
    return (flat(model.parameters()) - global_vec).detach(), before, after
