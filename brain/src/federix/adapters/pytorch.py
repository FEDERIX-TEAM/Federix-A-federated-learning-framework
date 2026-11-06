import numpy as np
import torch

from federix.spec import ModelSpec


def spec_of(model):
    return ModelSpec.from_pairs((name, tuple(p.shape)) for name, p in model.named_parameters())


def to_vector(model):
    return np.concatenate([p.detach().cpu().numpy().astype(np.float32).ravel() for _, p in model.named_parameters()])


def load_vector(model, vector):
    vector = np.asarray(vector, dtype=np.float32)
    expected = sum(p.numel() for p in model.parameters())
    if vector.size != expected:
        raise ValueError(f"vector has {vector.size} values but the model has {expected} parameters")
    offset = 0
    with torch.no_grad():
        for _, p in model.named_parameters():
            n = p.numel()
            p.copy_(torch.from_numpy(vector[offset:offset + n].reshape(tuple(p.shape))))
            offset += n
