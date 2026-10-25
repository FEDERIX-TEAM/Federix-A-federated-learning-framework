# Federix (CPU-only)

Utility-aware, communication-efficient federated learning built on FedProx.

## Setup
    uv sync
    uv run python tests/test_step1.py
    uv run python -m federix.check_setup

## Layout
    src/federix/   config.py  interfaces.py  logger.py  check_setup.py
    tests/         test_step1.py
