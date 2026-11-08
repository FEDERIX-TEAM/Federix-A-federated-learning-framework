import numpy as np

from federix_sdk.adapters.jax import JaxAdapter
from federix_sdk.trainer import Trainer, TrainResult, warn_if_unstable
from federix_sdk.trainers._jax_common import as_arrays, batches, cross_entropy, jax, label_counts, prox


class JaxFedProxTrainer(Trainer):
    def __init__(self, params, apply_fn, train_data, val_data, lr=0.05, layout=None, seed=0, eval_batch_size=1024):
        self.adapter = JaxAdapter(params, layout)
        self.apply_fn = apply_fn
        self.x, self.y = as_arrays(train_data, "train_data")
        self.vx, self.vy = as_arrays(val_data, "val_data")
        self.lr = lr
        self.rng = np.random.default_rng(seed)
        self.eval_batch_size = eval_batch_size

        def objective(params, anchor, x, y, mu):
            return cross_entropy(apply_fn(params, x), y) + (mu / 2) * prox(params, anchor)

        self._grad = jax.jit(jax.grad(objective))
        self._loss = jax.jit(lambda params, x, y: cross_entropy(apply_fn(params, x), y) * x.shape[0])

    def num_samples(self):
        return len(self.x)

    def label_counts(self):
        return label_counts(self.y)

    def _val_loss(self, params):
        total = 0.0
        for i in range(0, len(self.vx), self.eval_batch_size):
            total += float(self._loss(params, self.vx[i:i + self.eval_batch_size], self.vy[i:i + self.eval_batch_size]))
        return total / len(self.vx)

    def train(self, config):
        warn_if_unstable(self.lr, config.mu)
        params = self.adapter.params
        anchor = params
        before = self._val_loss(params)
        for _ in range(config.local_epochs):
            for idx in batches(len(self.x), config.batch_size, self.rng):
                grads = self._grad(params, anchor, self.x[idx], self.y[idx], config.mu)
                params = jax.tree_util.tree_map(lambda p, g: p - self.lr * g, params, grads)
        self.adapter.params = params
        return TrainResult(loss_before=before, loss_after=self._val_loss(params))
