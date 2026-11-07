# Federix brain (CPU-only)

Utility-aware, communication-efficient federated learning built on FedProx. This package is the research
engine: it runs offline experiments on MNIST and will become the FL server that talks to the central server.

## Setup
    uv sync
    uv run pytest
    uv run python -m federix.check_setup

## Run the FedProx baseline
    uv run python -m federix.main                          # defaults
    uv run python -m federix.main --set rounds=5 --set mu=0.1
    uv run python -m federix.main --config federix.toml    # settings from a file
    uv run python -m federix.inspect_data                  # how the non-IID split looks

## Run experiments
    uv run python -m federix.experiment --rounds 20 --seeds 0,1,2
    uv run python -m federix.experiment --variants fedprox,federix,federix_no_validation --attackers 2 --set attack=sign_flip

Variants: `fedprox` (sample-weighted, dense, no checks), `federix` (all defaults), `federix_no_ef`,
`federix_no_validation`. `--set` applies to every variant. Each experiment writes to `results/<timestamp>/`
(git-ignored): `rounds.csv` (accuracy, loss, cumulative MB, updates and rejections per round, per seed),
`summary.csv` and `summary.md` (mean ± std over seeds, MB sent and saved), `config.json` and one log per run.

MNIST is downloaded to `data/` on first use. Each run logs to the console and to its own file,
`logs/<name>-<timestamp>-<pid>.log`; earlier logs are never overwritten.

## Configuration
Every setting in `src/federix/config.py` can be changed without editing code. Later sources win:

1. defaults in `Config`
2. a TOML file: `--config path` or `FEDERIX_CONFIG=path`
3. environment variables: `FEDERIX_<SETTING>` (e.g. `FEDERIX_ROUNDS=5`, `FEDERIX_RATIOS=1,0.5,0.1`)
4. command-line overrides: `--set setting=value` (repeatable; `--rounds` and `--mu` are shortcuts)

All values are checked when they are loaded; if anything is wrong the run stops and lists every problem.
Unknown setting names are refused. Defaults match the central server's `SystemConfig`.

| Setting | Default | What it controls |
|---|---|---|
| `num_clients` / `clients_per_round` / `rounds` | 10 / 5 / 20 | Simulation size (`clients_per_round ≤ num_clients`, `rounds ≥ 0`) |
| `local_epochs` / `batch_size` / `lr` | 3 / 32 / 0.05 | Local training |
| `mu` | 0.01 | FedProx proximal weight |
| `dirichlet_alpha` / `min_client_samples` / `split_max_attempts` | 0.1 / 10 / 1000 | Non-IID label split; smaller alpha = more skew |
| `val_fraction` | 0.2 | Share of each client's data held out; losses before and after training are measured on it |
| `a` / `b` / `c` / `eps` | 1.0 / 0.5 / 0.3 / 1e-8 | Utility weights for quality, size, diversity |
| `size_saturation` / `num_classes` | 500 / 10 | n₀ in the size score, and the class count diversity is normalised by |
| `reject_below` | 0 | Updates with utility below this are rejected; 0 never rejects (the paper's behaviour) |
| `tau_high` / `tau_low` / `ratios` | 0.8 / 0.2 / (1.0, 0.5, 0.1) | Compression tiers |
| `temperature` | 1.0 | Utility-weighted aggregation |
| `compression` / `error_feedback` | true / true | Top-k compression at each tier's ratio, and carrying what was not sent into the next round |
| `aggregation` | utility | `utility`: ω ∝ n·exp(u/T); `fedprox`: ω ∝ n |
| `validate_updates` | true | Server-side checks on every update before aggregation |
| `max_update_norm_factor` | 5.0 | Reject an update whose norm is above this × the round median (0 = off; needs 3+ updates) |
| `holdout_check` / `holdout_loss_tolerance` / `server_holdout_size` | true / 0.5 / 1000 | Reject an update whose loss on a server-only holdout is above (1 + tolerance) × the round's median (with fewer than 3 updates: × the current model's loss); the holdout is taken out before clients are split |
| `attackers` / `attack` / `attack_scale` | 0 / scale / 20.0 | Simulated malicious clients for experiments (`scale`, `sign_flip`, `noise`); they also lie about their losses |
| `num_threads` / `eval_batch_size` / `seed` | 4 / 1024 / 0 | Runtime and reproducibility |
| `data_dir` / `log_dir` / `log_level` | data / logs / INFO | Paths and logging |

## Layout
    src/federix/   config.py  data.py  model.py  fedprox.py  aggregation.py  evaluation.py
                   utility.py  compression.py  codec.py  spec.py  interfaces.py  logger.py
                   main.py  check_setup.py  inspect_data.py
    src/federix/adapters/pytorch.py   the only framework-specific code: model <-> vector + spec
    tests/         pytest suite (runs on in-memory data, no download needed)

## Framework-neutral weights
Utility, compression, the codec and the model spec use only Python and NumPy, so any training framework can
produce and consume updates. A model travels as a flat float32 vector plus a `ModelSpec` (ordered
`(name, shape, dtype)` with a sha256), encoded in the FXW1 format (`codec.py`, see `spec/codec_vectors.json`).
Only `adapters/` knows about a framework; PyTorch is the first adapter.
