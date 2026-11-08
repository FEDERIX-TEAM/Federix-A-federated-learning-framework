import numpy as np

from federix_sdk.adapters.keras import KerasAdapter, keras
from federix_sdk.trainer import Trainer, TrainResult, warn_if_unstable
from federix_sdk.trainers._jax_common import as_arrays, batches, cross_entropy, jax, label_counts, prox


class KerasFedProxTrainer(Trainer):
    def __init__(self, model, train_data, val_data, lr=0.05, layout=None, seed=0, eval_batch_size=1024):
        if keras.backend.backend() != "jax":
            raise RuntimeError(
                f"KerasFedProxTrainer needs the JAX backend (set KERAS_BACKEND=jax before importing keras); "
                f"the current backend is {keras.backend.backend()!r}. With other backends use KerasAdapter with your own Trainer."
            )
        self.adapter = KerasAdapter(model, layout)
        self.model = model
        self.x, self.y = as_arrays(train_data, "train_data")
        self.vx, self.vy = as_arrays(val_data, "val_data")
        self.lr = lr
        self.rng = np.random.default_rng(seed)
        self.eval_batch_size = eval_batch_size

        def objective(trainable, non_trainable, anchor, x, y, mu):
            logits, new_non_trainable = model.stateless_call(trainable, non_trainable, x, training=True)
            return cross_entropy(logits, y) + (mu / 2) * prox(trainable, anchor), new_non_trainable

        self._grad = jax.jit(jax.grad(objective, has_aux=True))

        def eval_loss(trainable, non_trainable, x, y):
            logits, _ = model.stateless_call(trainable, non_trainable, x, training=False)
            return cross_entropy(logits, y) * x.shape[0]

        self._loss = jax.jit(eval_loss)

    def num_samples(self):
        return len(self.x)

    def label_counts(self):
        return label_counts(self.y)

    def _val_loss(self, trainable, non_trainable):
        total = 0.0
        for i in range(0, len(self.vx), self.eval_batch_size):
            total += float(self._loss(trainable, non_trainable, self.vx[i:i + self.eval_batch_size], self.vy[i:i + self.eval_batch_size]))
        return total / len(self.vx)

    def train(self, config):
        warn_if_unstable(self.lr, config.mu)
        trainable = [v.value for v in self.model.trainable_variables]
        non_trainable = [v.value for v in self.model.non_trainable_variables]
        anchor = list(trainable)
        before = self._val_loss(trainable, non_trainable)
        for _ in range(config.local_epochs):
            for idx in batches(len(self.x), config.batch_size, self.rng):
                grads, non_trainable = self._grad(trainable, non_trainable, anchor, self.x[idx], self.y[idx], config.mu)
                trainable = [p - self.lr * g for p, g in zip(trainable, grads)]
        for var, value in zip(self.model.trainable_variables, trainable):
            var.assign(value)
        for var, value in zip(self.model.non_trainable_variables, non_trainable):
            var.assign(value)
        return TrainResult(loss_before=before, loss_after=self._val_loss(trainable, non_trainable))
