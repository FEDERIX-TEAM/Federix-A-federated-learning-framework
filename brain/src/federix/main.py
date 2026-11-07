import argparse
import random
import sys

import numpy as np
import torch

from federix.adapters.pytorch import holdout_loss_fn, spec_of, to_vector
from federix.aggregation import aggregate, sample_weights, utility_weights
from federix.codec import DensePayload, decode, encode, encoded_size
from federix.compression import ErrorFeedback
from federix.config import Config, ConfigError, setup_cpu
from federix.data import load_mnist, make_clients_and_holdout
from federix.evaluation import evaluate
from federix.fedprox import local_train
from federix.interfaces import ClientUpdate
from federix.logger import get_logger
from federix.model import make_model
from federix.utility import label_counts, tier, utility
from federix.validation import validate_updates


def attack_delta(delta, kind, scale, rng):
    if kind == "scale":
        return delta * scale
    if kind == "sign_flip":
        return -delta * scale
    return (rng.normal(size=delta.shape) * scale * (np.linalg.norm(delta) / np.sqrt(delta.size) + 1e-6)).astype(np.float32)


def run(cfg, datasets=None, log=None):
    log = log or get_logger("federix", cfg.log_dir, cfg.log_level)
    setup_cpu(cfg)
    train, test = datasets if datasets is not None else load_mnist(cfg.data_dir)
    clients, holdout = make_clients_and_holdout(train, cfg)
    model = make_model()
    w = to_vector(model)
    spec = spec_of(model)
    eval_model = make_model()
    server_loss = holdout_loss_fn(eval_model, holdout, cfg.eval_batch_size) if holdout is not None else None
    feedback = ErrorFeedback(enabled=cfg.error_feedback)
    attackers = set(random.Random(cfg.seed + 3).sample(range(cfg.num_clients), cfg.attackers))
    attack_rng = np.random.default_rng(cfg.seed + 4)
    dense_bytes = encoded_size(DensePayload(w))
    total_bytes = 0
    total_dense_bytes = 0
    rejected_total = 0
    log.info(f"Federix | aggregation={cfg.aggregation} compression={cfg.compression} error_feedback={cfg.error_feedback} "
             f"validate={cfg.validate_updates} clients={cfg.num_clients} per_round={cfg.clients_per_round} rounds={cfg.rounds} "
             f"mu={cfg.mu} params={spec.size:,} attackers={sorted(attackers)}")

    metrics = evaluate(model, torch.from_numpy(w), test, cfg.eval_batch_size)
    log.info(f"round 0/{cfg.rounds} | initial model | acc={metrics['acc']:.4f} loss={metrics['loss']:.4f}")
    history = [{"round": 0, "acc": metrics["acc"], "loss": metrics["loss"], "cum_mb": 0.0, "updates": 0, "rejected": 0}]
    rounds_with_updates = 0
    scores = []

    for t in range(cfg.rounds):
        chosen = random.sample(range(cfg.num_clients), cfg.clients_per_round)
        log.info(f"round {t + 1}/{cfg.rounds} | selected {len(chosen)}/{cfg.num_clients} clients: {sorted(chosen)}")
        updates = []
        for k in chosen:
            try:
                delta, lb, la = local_train(model, torch.from_numpy(w), clients[k], cfg)
            except Exception as e:
                log.warning(f"  client={k} FAILED ({type(e).__name__}: {e}) - skipped")
                continue
            d = delta.numpy()
            if k in attackers:
                d = attack_delta(d, cfg.attack, cfg.attack_scale, attack_rng)
                lb, la = max(lb, 2.5), 0.0
            n = len(clients[k].train)
            u = utility(lb, la, n, label_counts(clients[k].train), cfg)
            update_tier = tier(u.score if u else None, cfg)
            if update_tier.status == "rejected":
                log.info(f"  client={k} n={n} rejected at scoring (u={u.score if u else None})")
                rejected_total += 1
                continue
            ratio = update_tier.ratio if cfg.compression else 1.0
            blob = encode(feedback.compress(str(k), d, ratio), spec.digest)
            received, _ = decode(blob, expected_digest=spec.digest, expected_length=spec.size)
            updates.append(ClientUpdate(client_id=str(k), payload=("fxw1", received.to_dense()), num_samples=n,
                                        loss_before=lb, loss_after=la, utility=u.score, ratio=ratio, bytes_sent=len(blob)))
            scores.append(u.score)
            log.info(f"  client={k}{' (attacker)' if k in attackers else ''} n={n} val_loss {lb:.3f}->{la:.3f} "
                     f"u={u.score:.3f} (q={u.quality:.3f} s={u.size:.3f} r={u.diversity:.3f}) "
                     f"tier={update_tier.status}/{update_tier.level} ratio={ratio} bytes={len(blob):,}")

        total_bytes += sum(u.bytes_sent for u in updates)
        total_dense_bytes += dense_bytes * len(updates)
        round_rejected = 0
        if updates and cfg.validate_updates:
            verdicts = validate_updates(w, [u.payload[1] for u in updates], cfg, server_loss)
            kept = []
            for up, verdict in zip(updates, verdicts):
                if verdict.accepted:
                    kept.append(up)
                else:
                    round_rejected += 1
                    log.warning(f"  client={up.client_id} rejected by the server: {verdict.reason}")
            updates = kept
        rejected_total += round_rejected

        if not updates:
            log.warning(f"round {t + 1}/{cfg.rounds} | no usable updates - global model unchanged")
            history.append({"round": t + 1, "acc": metrics["acc"], "loss": metrics["loss"], "cum_mb": total_bytes / 1e6,
                            "updates": 0, "rejected": round_rejected})
            continue

        n_k = [u.num_samples for u in updates]
        weights = utility_weights(n_k, [u.utility for u in updates], cfg.temperature) if cfg.aggregation == "utility" else sample_weights(n_k)
        w = aggregate(w, [u.payload[1] for u in updates], weights)
        rounds_with_updates += 1
        metrics = evaluate(model, torch.from_numpy(w), test, cfg.eval_batch_size)
        history.append({"round": t + 1, "acc": metrics["acc"], "loss": metrics["loss"], "cum_mb": total_bytes / 1e6,
                        "updates": len(updates), "rejected": round_rejected})
        log.info(f"round {t + 1}/{cfg.rounds} | aggregated {len(updates)} (rejected {round_rejected}) | "
                 f"acc={metrics['acc']:.4f} loss={metrics['loss']:.4f} | cum_MB={total_bytes / 1e6:.2f}")

    mean_utility = sum(scores) / len(scores) if scores else 0.0
    return {**metrics, "MB": total_bytes / 1e6, "dense_MB": total_dense_bytes / 1e6,
            "rounds_with_updates": rounds_with_updates, "mean_utility": mean_utility,
            "rejected": rejected_total, "history": history}


def parse_args(argv):
    p = argparse.ArgumentParser(description="Run one Federix simulation on MNIST.")
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
    result = run(cfg)
    print({k: v for k, v in result.items() if k != "history"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
