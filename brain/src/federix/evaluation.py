import torch
import torch.nn.functional as F
from torch.nn.utils import vector_to_parameters as unflat
from torch.utils.data import DataLoader


@torch.no_grad()
def evaluate(model, global_vec, test, batch_size=1024):
    unflat(global_vec.clone(), model.parameters())
    model.eval()
    correct = 0
    loss = 0.0
    for x, y in DataLoader(test, batch_size=batch_size):
        out = model(x)
        correct += (out.argmax(1) == y).sum().item()
        loss += F.cross_entropy(out, y, reduction="sum").item()
    return {"acc": correct / len(test), "loss": loss / len(test)}
