import argparse
import hashlib
import logging
import signal
import sys
import threading
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, version

import numpy as np
import torch
from torch.utils.data import Subset

from federix_sdk import Code, CodecError, ConnectError, DensePayload, FederixApi, TransferError, Transfers, decode, encode
from federix_sdk._gen import common_pb2

from federix.adapters.pytorch import holdout_loss_fn, spec_of, to_vector
from federix.aggregation import aggregate, sample_weights, utility_weights
from federix.config import Config, ConfigError, setup_cpu
from federix.data import load_mnist
from federix.evaluation import evaluate
from federix.logger import get_logger
from federix.model import make_model
from federix.validation import validate_updates

STARTING = common_pb2.FL_SERVER_STATE_STARTING
IDLE = common_pb2.FL_SERVER_STATE_IDLE
AGGREGATING = common_pb2.FL_SERVER_STATE_AGGREGATING
ERROR = common_pb2.FL_SERVER_STATE_ERROR
KEEPALIVE = common_pb2.ROUND_READY_REASON_KEEPALIVE
RESUMED = common_pb2.ROUND_READY_REASON_RESUMED
RETRYABLE = (Code.UNAVAILABLE, Code.DEADLINE_EXCEEDED)

try:
    BRAIN_VERSION = version("federix")
except PackageNotFoundError:
    BRAIN_VERSION = "dev"


class ModelError(Exception):
    pass


@dataclass
class RoundResult:
    round_id: str
    status: str
    reason: str = ""
    model_version: int = 0
    used: list = field(default_factory=list)
    rejected: dict = field(default_factory=dict)
    loss: float = 0.0
    accuracy: float = 0.0


def server_datasets(cfg, test=None):
    if test is None:
        _, test = load_mnist(cfg.data_dir)
    order = np.random.default_rng(cfg.seed + 3).permutation(len(test))
    size = cfg.server_holdout_size if cfg.holdout_check else 0
    if size >= len(test):
        raise ConfigError([f"server_holdout_size ({size}) must be smaller than the test set ({len(test)})"])
    holdout = Subset(test, np.sort(order[:size]).tolist()) if size else None
    rest = order[size:]
    if cfg.eval_size:
        rest = rest[:cfg.eval_size]
    return holdout, Subset(test, np.sort(rest).tolist())


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class FlServer:
    def __init__(self, cfg, model=None, holdout=None, test=None, api=None, transfers=None, log=None):
        if not cfg.internal_token:
            raise ConfigError(["internal_token is required to talk to the backend (set FEDERIX_INTERNAL_TOKEN)"])
        self.cfg = cfg
        self.log = log or logging.getLogger("federix")
        self.model = model if model is not None else make_model()
        self.spec = spec_of(self.model)
        if test is None:
            holdout, test = server_datasets(cfg)
        self.holdout = holdout
        self.test = test
        self.api = api or FederixApi(cfg.backend_url, internal_token=cfg.internal_token, timeout=cfg.request_timeout)
        self.watch_api = api or FederixApi(cfg.backend_url, internal_token=cfg.internal_token, timeout=cfg.request_timeout)
        self.transfers = transfers or Transfers(timeout=cfg.request_timeout, retries=cfg.transfer_retries)
        self.state = STARTING
        self.current_round = ""
        self.message = ""
        self.last_error = ""
        self.global_vec = None
        self.model_version = 0
        self.results = []
        self.done = set()
        self.stop_event = threading.Event()
        self._report_lock = threading.Lock()

    def close(self):
        self.transfers.close()
        self.watch_api.close()
        self.api.close()

    def report(self, state=None, round_id=None, message=None, error=None):
        with self._report_lock:
            if state is not None:
                self.state = state
            if round_id is not None:
                self.current_round = round_id
            if message is not None:
                self.message = message
            if error is not None:
                self.last_error = error
            try:
                self.api.fl.report_fl_status(
                    worker_id=self.cfg.worker_id, state=self.state, current_round_id=self.current_round,
                    version=BRAIN_VERSION, message=self.message, last_error=self.last_error,
                )
                return True
            except Exception as err:
                self.log.warning("could not report status to the backend: %s", err)
                return False

    def evaluate(self, vec):
        return evaluate(self.model, torch.from_numpy(np.asarray(vec, dtype=np.float32)), self.test, self.cfg.eval_batch_size)

    def download_model(self, model_version=None):
        res = self.api.fl.get_model_download_url(model_version=model_version) if model_version else self.api.fl.get_model_download_url()
        blob = self.transfers.download(res.download_url)
        if res.sha256 and sha256(blob) != res.sha256:
            raise ModelError(f"model v{res.model_version} does not match the sha256 the backend recorded")
        try:
            payload, digest = decode(blob)
        except CodecError as err:
            raise ModelError(f"model v{res.model_version} is not a valid FXW1 file: {err}") from err
        if digest != self.spec.digest:
            raise ModelError(
                f"model v{res.model_version} was built for a different architecture (spec {digest.hex()[:12]}, "
                f"this server has {self.spec.hash[:12]}); the brain's model must match the federation's model"
            )
        return payload.to_dense(), res.model_version

    def upload_model(self, vec, model_version):
        blob = encode(DensePayload(np.asarray(vec, dtype=np.float32)), self.spec.digest)
        res = self.api.fl.get_model_upload_url(model_version=model_version)
        self.transfers.upload(res.upload.url, blob)
        return res.resource_path

    def ensure_model(self):
        try:
            vec, model_version = self.download_model()
            self.log.info("using the active global model v%d", model_version)
        except ConnectError as err:
            if err.code is not Code.NOT_FOUND:
                raise
            vec, model_version = to_vector(self.model), 1
            metrics = self.evaluate(vec)
            path = self.upload_model(vec, model_version)
            self.api.fl.push_model(model_version=model_version, weights_url=path,
                                   metrics={"global_loss": metrics["loss"], "global_accuracy": metrics["acc"]})
            self.log.info("pushed the initial global model v1 (spec %s, acc=%.4f)", self.spec.hash[:12], metrics["acc"])
        self.global_vec, self.model_version = vec, model_version
        return model_version

    def _trigger(self, event):
        if event.reason == RESUMED:
            self.log.info("round %s was already being aggregated; resuming", event.round_id)
            return True
        try:
            self.api.fl.trigger_round(round_id=event.round_id)
            return True
        except ConnectError as err:
            if err.code is Code.FAILED_PRECONDITION and "already started" in err.message:
                return True
            if err.code in (Code.FAILED_PRECONDITION, Code.NOT_FOUND):
                self.log.info("skipping round %s: %s", event.round_id, err.message)
                return False
            raise

    def _read_updates(self, entries):
        deltas, kept, rejected = [], [], {}
        for e in entries:
            try:
                blob = self.transfers.download(e.download_url)
                if e.sha256 and sha256(blob) != e.sha256:
                    rejected[e.update_id] = "the uploaded file does not match its sha256"
                    continue
                payload, _ = decode(blob, expected_digest=self.spec.digest)
            except (CodecError, TransferError) as err:
                rejected[e.update_id] = f"the update could not be read: {err}"
                continue
            deltas.append(payload.to_dense())
            kept.append(e)
        return deltas, kept, rejected

    def handle_round(self, event):
        rid = event.round_id
        self.report(AGGREGATING, rid, f"aggregating round {event.round_number}", "")
        if not self._trigger(event):
            return RoundResult(rid, "skipped", "the round is no longer active")

        entries = list(self.api.fl.get_round_updates(round_id=rid))
        base_vec, base_version = self.download_model(event.model_version_before or None)
        deltas, kept, rejected = self._read_updates(entries)

        if self.cfg.validate_updates and deltas:
            loss_fn = holdout_loss_fn(self.model, self.holdout, self.cfg.eval_batch_size) if self.holdout is not None else None
            verdicts = validate_updates(base_vec, deltas, self.cfg, loss_fn)
            pairs = [(d, e) for d, e, v in zip(deltas, kept, verdicts) if v.accepted]
            for e, v in zip(kept, verdicts):
                if not v.accepted:
                    rejected[e.update_id] = v.reason
                    self.log.warning("round %s: update %s from %s rejected: %s", rid, e.update_id, e.client_id, v.reason)
            deltas, kept = [d for d, _ in pairs], [e for _, e in pairs]

        if not kept:
            reason = f"no update passed validation ({len(rejected)} rejected)" if rejected else "the round has no usable updates"
            self.api.fl.fail_round(round_id=rid, reason=reason, rejection_reasons=rejected)
            self.log.warning("round %s failed: %s", rid, reason)
            return RoundResult(rid, "failed", reason, rejected=rejected)

        n = [max(1, e.data_size) for e in kept]
        weights = utility_weights(n, [e.utility_score for e in kept], self.cfg.temperature) if self.cfg.aggregation == "utility" else sample_weights(n)
        new_vec = aggregate(base_vec, deltas, weights)
        metrics = self.evaluate(new_vec)

        active = self.api.fl.get_model_download_url().model_version
        new_version = max(active, base_version) + 1
        path = self.upload_model(new_vec, new_version)
        used = [e.update_id for e in kept]
        self.api.fl.complete_round(
            round_id=rid, new_model_version=new_version, model_url=path, global_loss=metrics["loss"],
            global_accuracy=metrics["acc"], used_update_ids=used, rejection_reasons=rejected,
        )
        self.global_vec, self.model_version = new_vec, new_version
        self.log.info("round %s complete: %d used, %d rejected, model v%d, acc=%.4f loss=%.4f",
                      rid, len(used), len(rejected), new_version, metrics["acc"], metrics["loss"])
        return RoundResult(rid, "completed", "", new_version, used, rejected, metrics["loss"], metrics["acc"])

    def _handle(self, event):
        try:
            result = self.handle_round(event)
        except ConnectError as err:
            if err.code in RETRYABLE:
                raise
            result = self._give_up(event, err)
        except (ModelError, TransferError, ValueError) as err:
            result = self._give_up(event, err)
        self.done.add(event.round_id)
        self.results.append(result)
        if result.status == "failed":
            self.report(IDLE, "", f"round {event.round_number} failed: {result.reason}")
        else:
            self.report(IDLE, "", f"round {event.round_number} {result.status}; model v{self.model_version}", "")
        return result

    def _give_up(self, event, err):
        reason = f"aggregation error: {err}"
        self.log.error("round %s: %s", event.round_id, reason)
        self.report(ERROR, event.round_id, None, reason)
        try:
            self.api.fl.fail_round(round_id=event.round_id, reason=reason)
        except ConnectError as fail_err:
            self.log.warning("could not mark round %s as failed: %s", event.round_id, fail_err)
        return RoundResult(event.round_id, "failed", reason)

    def _status_loop(self):
        while not self.stop_event.wait(self.cfg.status_interval):
            self.report()

    def _wait_for_backend(self):
        delay = self.cfg.reconnect_delay
        while not self.stop_event.is_set():
            try:
                return self.ensure_model()
            except ConnectError as err:
                if err.code not in RETRYABLE:
                    raise
                self.log.warning("backend not reachable (%s); retrying in %.1fs", err.message, delay)
                self.stop_event.wait(delay)
                delay = min(delay * 2, self.cfg.reconnect_max_delay)
        return None

    def stop(self):
        self.stop_event.set()

    def interrupt(self):
        self.stop_event.set()
        if self.watch_api is not self.api:
            self.watch_api.close()

    def run(self, max_rounds=None):
        stop = self.stop_event
        self.report(STARTING, "", "starting")
        try:
            if self._wait_for_backend() is None:
                return self.results
        except (ModelError, ConnectError) as err:
            self.report(ERROR, "", "could not load the global model", str(err))
            raise
        self.report(IDLE, "", f"waiting for rounds; model v{self.model_version}")
        threading.Thread(target=self._status_loop, name="federix-status", daemon=True).start()

        delay = self.cfg.reconnect_delay
        while not stop.is_set():
            try:
                for event in self.watch_api.fl.watch_rounds(worker_id=self.cfg.worker_id, timeout=self.cfg.watch_timeout):
                    delay = self.cfg.reconnect_delay
                    if stop.is_set():
                        break
                    if event.reason == KEEPALIVE or not event.round_id or event.round_id in self.done:
                        continue
                    self._handle(event)
                    if max_rounds is not None and len(self.results) >= max_rounds:
                        stop.set()
                        break
            except Exception as err:
                if stop.is_set():
                    break
                if not isinstance(err, ConnectError):
                    raise
                if err.code is Code.DEADLINE_EXCEEDED:
                    continue
                self.log.warning("lost the round stream (%s: %s); reconnecting in %.1fs", err.code.value, err.message, delay)
                self.report(None, None, None, f"lost the round stream: {err.message}")
                stop.wait(delay)
                delay = min(delay * 2, self.cfg.reconnect_max_delay)
        self.report(IDLE, "", "stopped")
        return self.results


def parse_args(argv):
    p = argparse.ArgumentParser(description="Run the Federix FL server. It connects to the backend and listens on no port.")
    p.add_argument("--config", help="TOML file with settings")
    p.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="override one setting (repeatable)")
    p.add_argument("--max-rounds", type=int, help="exit after aggregating this many rounds")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        cfg = Config.load(path=args.config, overrides=args.set)
        setup_cpu(cfg)
        log = get_logger("federix", cfg.log_dir, cfg.log_level)
        server = FlServer(cfg, log=log)
    except ConfigError as err:
        print(err, file=sys.stderr)
        return 2

    def on_signal(signum, _frame):
        log.info("received signal %d; stopping", signum)
        server.interrupt()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    log.info("FL server %s (worker %s) connecting to %s", BRAIN_VERSION, cfg.worker_id, cfg.backend_url)
    try:
        server.run(max_rounds=args.max_rounds)
    except (ModelError, ConnectError) as err:
        log.error("FL server stopped: %s", err)
        return 1
    finally:
        server.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
