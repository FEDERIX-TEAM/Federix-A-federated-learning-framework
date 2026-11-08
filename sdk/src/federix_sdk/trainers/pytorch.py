from collections import Counter

from federix_sdk.adapters.pytorch import TorchAdapter
from federix_sdk.trainer import Trainer, TrainResult, warn_if_unstable

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader


def _labels(dataset):
    if hasattr(dataset, "targets"):
        return [int(y) for y in dataset.targets]
    if hasattr(dataset, "indices") and hasattr(dataset, "dataset"):
        inner = _labels(dataset.dataset)
        return [inner[i] for i in dataset.indices]
    if hasattr(dataset, "tensors"):
        return [int(y) for y in dataset.tensors[-1]]
    return [int(dataset[i][1]) for i in range(len(dataset))]


class TorchFedProxTrainer(Trainer):
    def __init__(self, model, train_data, val_data, lr=0.05, eval_batch_size=1024, labels=None):
        if len(train_data) == 0 or len(val_data) == 0:
            raise ValueError("train_data and val_data must both be non-empty")
        self.adapter = TorchAdapter(model)
        self.model = model
        self.train_data = train_data
        self.val_data = val_data
        self.lr = lr
        self.eval_batch_size = eval_batch_size
        counts = Counter(labels if labels is not None else _labels(train_data))
        self._label_counts = {str(k): int(v) for k, v in sorted(counts.items())}

    def num_samples(self):
        return len(self.train_data)

    def label_counts(self):
        return dict(self._label_counts)

    @torch.no_grad()
    def _val_loss(self):
        self.model.eval()
        total = 0.0
        for x, y in DataLoader(self.val_data, batch_size=self.eval_batch_size):
            total += F.cross_entropy(self.model(x), y, reduction="sum").item()
        return total / len(self.val_data)

    def train(self, config):
        warn_if_unstable(self.lr, config.mu)
        start = [p.detach().clone() for p in self.model.parameters()]
        before = self._val_loss()
        opt = torch.optim.SGD(self.model.parameters(), lr=self.lr)
        self.model.train()
        for _ in range(config.local_epochs):
            for x, y in DataLoader(self.train_data, batch_size=config.batch_size, shuffle=True):
                opt.zero_grad()
                prox = sum(((p - s) ** 2).sum() for p, s in zip(self.model.parameters(), start))
                (F.cross_entropy(self.model(x), y) + (config.mu / 2) * prox).backward()
                opt.step()
        return TrainResult(loss_before=before, loss_after=self._val_loss())
