import argparse
import random
import sys

import torch
from torch.nn.utils import parameters_to_vector as flat

from federix.adapters.pytorch import spec_of
from federix.codec import DensePayload, decode, encode, encoded_size
from federix.compression import ErrorFeedback

from federix.aggregation import aggregate, sample_weights
from federix.config import Config, ConfigError, setup_cpu
from federix.data import load_mnist, make_clients
from federix.evaluation import evaluate
from federix.fedprox import local_train
from federix.interfaces import ClientUpdate
from federix.logger import get_logger
from federix.model import make_model
from federix.utility import label_counts, tier, utility


def run(cfg, datasets=None, log=None):
    log = log or get_logger("fedprox", cfg.log_dir, cfg.log_level)
    setup_cpu(cfg)
    train, test = datasets if datasets is not None else load_mnist(cfg.data_dir)
    clients = make_clients(train, cfg)
    model = make_model()
    w = flat(model.parameters()).detach()
    spec = spec_of(model)
    feedback = ErrorFeedback(enabled=cfg.error_feedback)
    dense_bytes = encoded_size(DensePayload(w.numpy()))
    total_bytes = 0
    total_dense_bytes = 0
    log.info(f"FedProx baseline | clients={cfg.num_clients} per_round={cfg.clients_per_round} "
             f"rounds={cfg.rounds} mu={cfg.mu} lr={cfg.lr} params={w.numel():,}")

    metrics = evaluate(model, w, test, cfg.eval_batch_size)
    log.info(f"round 0/{cfg.rounds} | initial model | acc={metrics['acc']:.4f} loss={metrics['loss']:.4f}")
    rounds_with_updates = 0
    scores = []

    for t in range(cfg.rounds):
        chosen = random.sample(range(cfg.num_clients), cfg.clients_per_round)
        log.info(f"round {t + 1}/{cfg.rounds} | selected {len(chosen)}/{cfg.num_clients} clients: {sorted(chosen)}")
        updates = []
        for k in chosen:
            try:
                delta, lb, la = local_train(model, w, clients[k], cfg)
            except Exception as e:
                log.warning(f"  client={k} FAILED ({type(e).__name__}: {e}) - skipped")
                continue
            n = len(clients[k].train)
            u = utility(lb, la, n, label_counts(clients[k].train), cfg)
            update_tier = tier(u.score if u else None, cfg)
            if update_tier.status == "rejected":
                log.info(f"  client={k} n={n} rejected (u={u.score if u else None})")
                continue
            ratio = update_tier.ratio if cfg.compression else 1.0
            blob = encode(feedback.compress(str(k), delta.numpy(), ratio), spec.digest)
            received, _ = decode(blob, expected_digest=spec.digest, expected_length=spec.size)
            up = ClientUpdate(client_id=str(k), payload=("fxw1", torch.from_numpy(received.to_dense())), num_samples=n,
                              loss_before=lb, loss_after=la, utility=u.score if u else 0.0,
                              ratio=ratio, bytes_sent=len(blob))
            updates.append(up)
            if u:
                scores.append(u.score)
                log.info(f"  client={k} n={n} val_loss {lb:.3f}->{la:.3f} "
                         f"u={u.score:.3f} (q={u.quality:.3f} s={u.size:.3f} r={u.diversity:.3f}) "
                         f"tier={update_tier.status}/{update_tier.level} ratio={update_tier.ratio} bytes={up.bytes_sent:,}")
            else:
                log.warning(f"  client={k} n={n} utility could not be computed from val_loss {lb}->{la}")
        if not updates:
            log.warning(f"round {t + 1}/{cfg.rounds} | no client updates - global model unchanged")
            continue
        weights = sample_weights([u.num_samples for u in updates])
        w = aggregate(w, [u.payload[1] for u in updates], weights)
        total_bytes += sum(u.bytes_sent for u in updates)
        total_dense_bytes += dense_bytes * len(updates)
        rounds_with_updates += 1
        metrics = evaluate(model, w, test, cfg.eval_batch_size)
        log.info(f"round {t + 1}/{cfg.rounds} | updated {len(updates)}/{len(chosen)} | "
                 f"acc={metrics['acc']:.4f} loss={metrics['loss']:.4f} | cum_MB={total_bytes / 1e6:.2f}")

    mean_utility = sum(scores) / len(scores) if scores else 0.0
    return {**metrics, "MB": total_bytes / 1e6, "dense_MB": total_dense_bytes / 1e6,
            "rounds_with_updates": rounds_with_updates, "mean_utility": mean_utility}


def parse_args(argv):
    p = argparse.ArgumentParser(description="Run the FedProx baseline on MNIST.")
    p.add_argument("--config", help="TOML file with settings")
    p.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="override one setting (repeatable)")
    p.add_argument("--rounds", type=int, help="shortcut for --set rounds=N")
    p.add_argument("--mu", type=float, help="shortcut for --set mu=X")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    overrides = list(args.set)
    if args.rounds is not None:
        overrides.append(f"rounds={args.rounds}")
    if args.mu is not None:
        overrides.append(f"mu={args.mu}")
    try:
        cfg = Config.load(path=args.config, overrides=overrides)
    except ConfigError as err:
        print(err, file=sys.stderr)
        return 2
    print(run(cfg))
    return 0


if __name__ == "__main__":
    sys.exit(main())
