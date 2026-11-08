import numpy as np

from federix_sdk.adapters.base import ModelAdapter
from federix_sdk.spec import ModelSpec

try:
    import torch
except ImportError as err:
    raise ImportError("the PyTorch adapter needs torch; install it with: pip install 'federix-sdk[torch]'") from err

SUPPORTED = {torch.float32}


class TorchAdapter(ModelAdapter):
    framework = "pytorch"

    def __init__(self, model):
        self.model = model
        bad = [n for n, p in model.named_parameters() if p.dtype not in SUPPORTED]
        if bad:
            raise ValueError(f"only float32 parameters are supported; convert these first: {', '.join(bad)}")
        self._spec = ModelSpec.from_pairs((name, tuple(p.shape)) for name, p in model.named_parameters())

    def spec(self):
        return self._spec

    def get_weights(self):
        return np.concatenate([p.detach().cpu().numpy().astype(np.float32).ravel() for _, p in self.model.named_parameters()])

    def set_weights(self, vector):
        vector = self.check_vector(vector)
        offset = 0
        with torch.no_grad():
            for _, p in self.model.named_parameters():
                n = p.numel()
                p.copy_(torch.from_numpy(vector[offset:offset + n].reshape(tuple(p.shape))).to(p.device))
                offset += n
