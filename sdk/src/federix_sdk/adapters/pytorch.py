import numpy as np

from federix_sdk.adapters.base import ModelAdapter

try:
    import torch
except ImportError as err:
    raise ImportError("the PyTorch adapter needs torch; install it with: pip install 'federix-sdk[torch]'") from err


class TorchAdapter(ModelAdapter):
    framework = "pytorch"

    def __init__(self, model, layout=None):
        self.model = model
        bad = [n for n, p in model.named_parameters() if p.dtype != torch.float32]
        if bad:
            raise ValueError(f"only float32 parameters are supported; convert these first: {', '.join(bad)}")
        super().__init__(layout)

    def _local_params(self):
        return [(name, p.detach().cpu().numpy()) for name, p in self.model.named_parameters()]

    def _load_local(self, arrays):
        with torch.no_grad():
            for name, p in self.model.named_parameters():
                p.copy_(torch.from_numpy(np.asarray(arrays[name], dtype=np.float32)).to(p.device))
