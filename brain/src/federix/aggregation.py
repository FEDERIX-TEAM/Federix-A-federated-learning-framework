import numpy as np


def sample_weights(num_samples):
    n = np.asarray(num_samples, dtype=np.float64)
    if n.size == 0 or np.any(n <= 0):
        raise ValueError("every update needs a positive sample count")
    return n / n.sum()


def utility_weights(num_samples, utilities, temperature):
    n = np.asarray(num_samples, dtype=np.float64)
    u = np.asarray(utilities, dtype=np.float64)
    if n.shape != u.shape or n.size == 0 or np.any(n <= 0):
        raise ValueError("need one positive sample count and one utility per update")
    if temperature <= 0:
        raise ValueError("temperature must be > 0")
    logits = np.log(n) + u / temperature
    logits -= logits.max()
    w = np.exp(logits)
    return w / w.sum()


def aggregate(global_vec, deltas, weights):
    g = np.asarray(global_vec, dtype=np.float64)
    if len(deltas) != len(weights):
        raise ValueError("need one weight per delta")
    total = np.zeros_like(g)
    for w, d in zip(weights, deltas):
        d = np.asarray(d, dtype=np.float64)
        if d.shape != g.shape:
            raise ValueError(f"delta has shape {d.shape}, expected {g.shape}")
        total += w * d
    return (g + total).astype(np.float32)
