import torch.nn as nn
 
def make_model():
    """Small MLP (~100k params): fast on CPU, enough for MNIST."""
    return nn.Sequential(nn.Flatten(), nn.Linear(784, 128), nn.ReLU(), nn.Linear(128, 10))
 