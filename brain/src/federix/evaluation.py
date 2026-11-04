import torch
from torch.nn.utils import vector_to_parameters as unflat
from torch.utils.data import DataLoader

@torch.no_grad()
def accuracy(model, data):
    model.eval()
    correct = sum((model(x).argmax(1) == y).sum().item() for x, y in DataLoader(data, batch_size=1024))
    return correct / len(data)

def evaluate(model, global_vec, test):
    """Load the global weights into the model and score them on the test set."""
    unflat(global_vec.clone(), model.parameters())
    return {"acc": accuracy(model, test)}