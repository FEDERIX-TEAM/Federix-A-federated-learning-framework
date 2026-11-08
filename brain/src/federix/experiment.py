import argparse
import csv
import json
import logging
import os
import statistics
import sys
from datetime import datetime
from pathlib import Path

from federix.config import Config, ConfigError
from federix.data import load_mnist
from federix.main import run

VARIANTS = {
    "fedprox": {"aggregation": "fedprox", "compression": "false", "error_feedback": "false", "validate_updates": "false"},
    "federix": {},
    "federix_no_ef": {"error_feedback": "false"},
    "federix_no_validation": {"validate_updates": "false"},
}

ROUND_FIELDS = ["variant", "seed", "round", "acc", "loss", "cum_mb", "updates", "rejected"]
SUMMARY_FIELDS = ["variant", "seeds", "final_acc_mean", "final_acc_std", "final_loss_mean", "final_loss_std",
                  "mb_mean", "dense_mb_mean", "saved_pct", "rejected_mean"]


def file_logger(path, name):
    log = logging.getLogger(name)
    log.handlers.clear()
    log.propagate = False
    log.setLevel(logging.INFO)
    handler = logging.FileHandler(path, mode="a")
    handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", "%H:%M:%S"))
    log.addHandler(handler)
    return log


def std(xs):
    return statistics.stdev(xs) if len(xs) > 1 else 0.0


def summarize(variant, results):
    accs = [r["acc"] for r in results]
    losses = [r["loss"] for r in results]
    mb = statistics.mean(r["MB"] for r in results)
    dense = statistics.mean(r["dense_MB"] for r in results)
    return {
        "variant": variant,
        "seeds": len(results),
        "final_acc_mean": statistics.mean(accs),
        "final_acc_std": std(accs),
        "final_loss_mean": statistics.mean(losses),
        "final_loss_std": std(losses),
        "mb_mean": mb,
        "dense_mb_mean": dense,
        "saved_pct": 100 * (1 - mb / dense) if dense else 0.0,
        "rejected_mean": statistics.mean(r["rejected"] for r in results),
    }


def table(rows):
    lines = ["| variant | final acc | final loss | MB sent | saved | rejected |", "|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['variant']} | {r['final_acc_mean']:.4f} ± {r['final_acc_std']:.4f} | "
                     f"{r['final_loss_mean']:.4f} ± {r['final_loss_std']:.4f} | {r['mb_mean']:.2f} | "
                     f"{r['saved_pct']:.1f}% | {r['rejected_mean']:.1f} |")
    return "\n".join(lines)


def run_experiment(variants, seeds, base_overrides, out_dir, config_path=None, datasets=None, env=None, progress=print):
    unknown = [v for v in variants if v not in VARIANTS]
    if unknown:
        raise ConfigError([f"unknown variant {v!r}; choose from {', '.join(VARIANTS)}" for v in unknown])
    configs = {}
    for v in variants:
        for s in seeds:
            overrides = list(base_overrides) + [f"{k}={val}" for k, val in VARIANTS[v].items()] + [f"seed={s}"]
            configs[(v, s)] = Config.load(path=config_path, env={} if env is None else env, overrides=overrides)

    out = Path(out_dir)
    (out / "logs").mkdir(parents=True, exist_ok=True)
    first = next(iter(configs.values()))
    data = datasets if datasets is not None else load_mnist(first.data_dir)
    (out / "config.json").write_text(json.dumps(
        {f"{v}/seed={s}": cfg.as_dict(redact=True) for (v, s), cfg in configs.items()}, indent=2, default=list))

    summaries = []
    with (out / "rounds.csv").open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=ROUND_FIELDS)
        writer.writeheader()
        for v in variants:
            results = []
            for s in seeds:
                cfg = configs[(v, s)]
                log = file_logger(out / "logs" / f"{v}-seed{s}.log", f"federix.experiment.{v}.{s}")
                result = run(cfg, datasets=data, log=log)
                for h in result["history"]:
                    writer.writerow({"variant": v, "seed": s, **h})
                results.append(result)
                progress(f"{v} seed={s}: acc={result['acc']:.4f} loss={result['loss']:.4f} MB={result['MB']:.2f} rejected={result['rejected']}")
            summaries.append(summarize(v, results))

    with (out / "summary.csv").open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=SUMMARY_FIELDS)
        writer.writeheader()
        writer.writerows(summaries)
    (out / "summary.md").write_text(table(summaries) + "\n")
    return summaries


def parse_args(argv):
    p = argparse.ArgumentParser(description="Compare FedProx and Federix variants over several seeds.")
    p.add_argument("--variants", default="fedprox,federix,federix_no_ef", help=f"comma list from: {', '.join(VARIANTS)}")
    p.add_argument("--seeds", default="0,1,2", help="comma list of seeds")
    p.add_argument("--rounds", type=int, help="shortcut for --set rounds=N")
    p.add_argument("--attackers", type=int, help="shortcut for --set attackers=N (applies to every variant)")
    p.add_argument("--config", help="TOML file with base settings")
    p.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="base override (repeatable)")
    p.add_argument("--out", help="output folder (default results/<timestamp>)")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    overrides = list(args.set)
    if args.rounds is not None:
        overrides.append(f"rounds={args.rounds}")
    if args.attackers is not None:
        overrides.append(f"attackers={args.attackers}")
    try:
        seeds = [int(s) for s in args.seeds.split(",") if s.strip()]
    except ValueError:
        print(f"--seeds must be a comma list of integers (got {args.seeds!r})", file=sys.stderr)
        return 2
    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    out = args.out or f"results/{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    try:
        summaries = run_experiment(variants, seeds, overrides, out, config_path=args.config, env=os.environ)
    except ConfigError as err:
        print(err, file=sys.stderr)
        return 2
    print()
    print(table(summaries))
    print(f"\nResults written to {out}/ (rounds.csv, summary.csv, summary.md, config.json, logs/)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
