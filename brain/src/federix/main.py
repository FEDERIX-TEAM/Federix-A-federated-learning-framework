import argparse
import random
import sys

from torch.nn.utils import parameters_to_vector as flat

from federix.aggregation import aggregate, sample_weights
from federix.config import Config, ConfigError, setup_cpu
from federix.data import load_mnist, make_clients
from federix.evaluation import evaluate
from federix.fedprox import local_train
from federix.interfaces import ClientUpdate
from federix.logger import get_logger
from federix.model import make_model


def run(cfg, datasets=None, log=None):
    log = log or get_logger("fedprox", cfg.log_dir, cfg.log_level)
    setup_cpu(cfg)
    train, test = datasets if datasets is not None else load_mnist(cfg.data_dir)
    clients = make_clients(train, cfg)
    model = make_model()
    w = flat(model.parameters()).detach()
    total_bytes = 0
    log.info(f"FedProx baseline | clients={cfg.num_clients} per_round={cfg.clients_per_round} "
             f"rounds={cfg.rounds} mu={cfg.mu} lr={cfg.lr} params={w.numel():,}")

    metrics = evaluate(model, w, test, cfg.eval_batch_size)
    log.info(f"round 0/{cfg.rounds} | initial model | acc={metrics['acc']:.4f} loss={metrics['loss']:.4f}")
    rounds_with_updates = 0

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
            up = ClientUpdate(client_id=str(k), payload=("dense", delta), num_samples=len(clients[k].train),
                              loss_before=lb, loss_after=la, bytes_sent=delta.numel() * 4)
            updates.append(up)
            log.info(f"  client={k} n={up.num_samples} val_loss {lb:.3f}->{la:.3f} bytes={up.bytes_sent:,}")
        if not updates:
            log.warning(f"round {t + 1}/{cfg.rounds} | no client updates - global model unchanged")
            continue
        weights = sample_weights([u.num_samples for u in updates])
        w = aggregate(w, [u.payload[1] for u in updates], weights)
        total_bytes += sum(u.bytes_sent for u in updates)
        rounds_with_updates += 1
        metrics = evaluate(model, w, test, cfg.eval_batch_size)
        log.info(f"round {t + 1}/{cfg.rounds} | updated {len(updates)}/{len(chosen)} | "
                 f"acc={metrics['acc']:.4f} loss={metrics['loss']:.4f} | cum_MB={total_bytes / 1e6:.2f}")

    return {**metrics, "MB": total_bytes / 1e6, "rounds_with_updates": rounds_with_updates}


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
