from collections import Counter

import numpy as np

try:
    import jax
    import jax.numpy as jnp
except ImportError as err:
    raise ImportError("this trainer needs jax; install it with: pip install 'federix-sdk[jax]'") from err


def as_arrays(data, name):
    try:
        x, y = data
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be an (inputs, labels) pair of arrays") from None
    x = np.asarray(x, dtype=np.float32)
    y = np.asarray(y).astype(np.int32)
    if len(x) == 0 or len(x) != len(y):
        raise ValueError(f"{name} must be non-empty with one label per input")
    return x, y


def label_counts(y):
    return {str(k): int(v) for k, v in sorted(Counter(int(v) for v in y).items())}


def cross_entropy(logits, y):
    logp = jax.nn.log_softmax(logits)
    return -jnp.mean(jnp.take_along_axis(logp, y[:, None], axis=1))


def prox(params, anchor):
    return sum(jnp.sum((p - a) ** 2) for p, a in zip(jax.tree_util.tree_leaves(params), jax.tree_util.tree_leaves(anchor)))


def batches(n, batch_size, rng):
    order = rng.permutation(n)
    for i in range(0, n, batch_size):
        yield order[i:i + batch_size]
