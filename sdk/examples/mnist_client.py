import argparse
import logging
import sys

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Subset, TensorDataset
from torchvision import datasets

from federix_sdk import ClientSettings, FederixClient, Session, SettingsError
from federix_sdk.trainers.pytorch import TorchFedProxTrainer


def make_model():
    return nn.Sequential(nn.Flatten(), nn.Linear(784, 128), nn.ReLU(), nn.Linear(128, 10))


def load_mnist(data_dir):
    d = datasets.MNIST(data_dir, train=True, download=True)
    x = ((d.data.float() / 255 - 0.1307) / 0.3081).unsqueeze(1)
    return TensorDataset(x, d.targets)


def label_skewed_shard(data, shard, shards, alpha, seed):
    labels = data.tensors[1].numpy()
    rng = np.random.default_rng(seed)
    mine = []
    for cls in np.unique(labels):
        ids = rng.permutation(np.where(labels == cls)[0])
        cuts = (np.cumsum(rng.dirichlet([alpha] * shards))[:-1] * len(ids)).astype(int)
        mine += np.split(ids, cuts)[shard].tolist()
    mine = rng.permutation(np.array(mine, dtype=int))
    n_val = max(1, len(mine) // 5)
    return Subset(data, mine[n_val:].tolist()), Subset(data, mine[:n_val].tolist())


def parse_args(argv):
    p = argparse.ArgumentParser(description="Join a Federix federation as an MNIST client.")
    p.add_argument("--shard", type=int, required=True, help="which slice of MNIST this client owns (0-based)")
    p.add_argument("--shards", type=int, default=10, help="how many clients split MNIST")
    p.add_argument("--alpha", type=float, default=0.5, help="Dirichlet label skew; smaller is more skewed")
    p.add_argument("--rounds", type=int, default=None, help="stop after this many rounds (default: run until stopped)")
    p.add_argument("--lr", type=float, default=0.05)
    p.add_argument("--data-dir", default="data")
    p.add_argument("--seed", type=int, default=0)
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    if not 0 <= args.shard < args.shards:
        print(f"--shard must be between 0 and {args.shards - 1}", file=sys.stderr)
        return 2
    try:
        settings = ClientSettings.load(client_name=f"mnist-shard-{args.shard}")
    except SettingsError as err:
        print(err, file=sys.stderr)
        return 2
    torch.manual_seed(args.seed + args.shard)
    train, val = label_skewed_shard(load_mnist(args.data_dir), args.shard, args.shards, args.alpha, args.seed)
    trainer = TorchFedProxTrainer(make_model(), train, val, lr=args.lr)
    logging.info("shard %d/%d: %d training and %d held-out samples, labels %s",
                 args.shard, args.shards, len(train), len(val), trainer.label_counts())
    with Session(settings) as session, FederixClient(session, trainer) as client:
        logging.info("connected to %s as client %s", settings.server_url, session.client_id)
        try:
            outcomes = client.run(max_rounds=args.rounds)
        except KeyboardInterrupt:
            return 130
    for o in outcomes:
        logging.info("round %s: %s, %d bytes, utility %.3f, val loss %.3f -> %.3f",
                     o.round_id, o.status, o.bytes_sent, o.utility, o.loss_before, o.loss_after)
    return 0


if __name__ == "__main__":
    sys.exit(main())
