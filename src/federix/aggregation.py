"""Server aggregation: w_{t+1} = w_t + sum_k omega_k * delta_k   (Eq. 10)"""
import torch

def sample_weights(num_samples):
    """FedProx/FedAvg baseline weights: omega_k = n_k / sum_j n_j."""
    n = torch.tensor(num_samples, dtype=torch.float)
    return n / n.sum()

def aggregate(global_vec, deltas, weights):
    return global_vec + sum(w * d for w, d in zip(weights, deltas))