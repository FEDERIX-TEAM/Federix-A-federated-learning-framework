"""FedProx baseline: uv run python -m federix.main [--rounds 20] [--mu 0.01]"""
import argparse, random
from torch.nn.utils import parameters_to_vector as flat
from federix.config import Config, setup_cpu
from federix.interfaces import ClientUpdate
from federix.logger import get_logger
from federix.data import load_mnist, make_clients
from federix.model import make_model
from federix.fedprox import local_train
from federix.aggregation import sample_weights, aggregate
from federix.evaluation import evaluate

def run(cfg):
    log = get_logger("fedprox", cfg.log_dir)
    setup_cpu(cfg)
    train, test = load_mnist(cfg.data_dir)
    clients = make_clients(train, cfg)
    model = make_model()
    w = flat(model.parameters()).detach()
    total_bytes = 0
    log.info(f"FedProx baseline | clients={cfg.num_clients} per_round={cfg.clients_per_round} "
             f"rounds={cfg.rounds} mu={cfg.mu} lr={cfg.lr} params={w.numel():,}")

    for t in range(cfg.rounds):
        chosen = random.sample(range(cfg.num_clients), cfg.clients_per_round)
        log.info(f"round {t+1}/{cfg.rounds} | selected {len(chosen)}/{cfg.num_clients} clients: {sorted(chosen)}")
        updates = []
        for k in chosen:                                              # --- client side ---
            try:
                delta, lb, la = local_train(model, w, clients[k], cfg)
            except Exception as e:                                    # a failed client must not stop the round
                log.warning(f"  client={k} FAILED ({type(e).__name__}: {e}) - skipped")
                continue
            up = ClientUpdate(client_id=k, payload=("dense", delta), num_samples=len(clients[k]),
                              loss_before=lb, loss_after=la, bytes_sent=delta.numel() * 4)
            updates.append(up)
            log.info(f"  client={k} n={up.num_samples} loss {lb:.3f}->{la:.3f} bytes={up.bytes_sent:,}")
        if not updates:
            log.warning("  no client updates this round - global model unchanged")
            continue
        weights = sample_weights([u.num_samples for u in updates])    # --- server side ---
        w = aggregate(w, [u.payload[1] for u in updates], weights)
        total_bytes += sum(u.bytes_sent for u in updates)
        m = evaluate(model, w, test)
        log.info(f"round {t+1}/{cfg.rounds} | updated {len(updates)}/{len(chosen)} | "
                 f"acc={m['acc']:.4f} | cum_MB={total_bytes/1e6:.2f}")
    return {**m, "MB": total_bytes / 1e6}

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--rounds", type=int, default=Config.rounds)
    p.add_argument("--mu", type=float, default=Config.mu)
    a = p.parse_args()
    print(run(Config(rounds=a.rounds, mu=a.mu)))