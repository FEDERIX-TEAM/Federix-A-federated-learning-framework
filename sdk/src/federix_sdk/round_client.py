import logging
import threading
import time
from dataclasses import dataclass, field

import numpy as np

from federix_sdk.codec import CodecError, DensePayload, decode, encode, encoded_size
from federix_sdk.compression import ErrorFeedback
from federix_sdk.errors import Code, ConnectError
from federix_sdk.heartbeat import Heartbeat
from federix_sdk.trainer import RoundConfig
from federix_sdk.transfer import Transfers

log = logging.getLogger("federix_sdk")


class ModelMismatch(Exception):
    pass


@dataclass
class RoundOutcome:
    round_id: str
    status: str
    reason: str = ""
    update_id: str = ""
    utility: float = 0.0
    compression_ratio: float = 0.0
    bytes_sent: int = 0
    dense_bytes: int = 0
    loss_before: float = 0.0
    loss_after: float = 0.0
    training_time_ms: int = 0
    timings: dict = field(default_factory=dict)


class FederixClient:
    def __init__(self, session, trainer, transfers=None):
        self.session = session
        self.trainer = trainer
        self.adapter = trainer.adapter
        s = session.settings
        self.transfers = transfers or Transfers(
            timeout=s.transfer_timeout, retries=int(s.transfer_retries), chunk_size=int(s.chunk_size_bytes)
        )
        self.feedback = ErrorFeedback()
        self.completed = []

    @property
    def api(self):
        return self.session.api

    def close(self):
        self.transfers.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _load_global_model(self, round_id):
        res = self.api.client.get_model_download(round_id=round_id)
        blob = self.transfers.download(res.download_url)
        spec = self.adapter.spec()
        try:
            payload, digest = decode(blob)
        except CodecError as err:
            raise ModelMismatch(f"the global model for round {round_id} is not a valid FXW1 file: {err}") from err
        if digest != spec.digest:
            raise ModelMismatch(
                f"the global model was built for a different architecture (spec {digest.hex()[:12]}, "
                f"this client has {spec.hash[:12]}); the client's model must match the federation's model"
            )
        if payload.length != spec.size:
            raise ModelMismatch(f"the global model has {payload.length} values, this client's model has {spec.size}")
        weights = payload.to_dense()
        self.adapter.set_weights(weights)
        return weights, res.model_version

    def run_round(self, round_id):
        timings = {}
        t0 = time.perf_counter()
        join = self.api.client.join_round(round_id=round_id, local_data_size=self.trainer.num_samples())
        if not join.accepted:
            return RoundOutcome(round_id, "skipped", join.instructions)

        heartbeat = Heartbeat(self.session, round_id).start()
        try:
            config = RoundConfig.from_response(self.api.client.get_config())
            global_weights, version = self._load_global_model(round_id)
            timings["download_s"] = time.perf_counter() - t0

            t1 = time.perf_counter()
            result = self.trainer.train(config)
            training_ms = int((time.perf_counter() - t1) * 1000)
            delta = self.adapter.get_weights() - global_weights
            if not np.all(np.isfinite(delta)):
                raise ValueError("training produced non-finite weights")

            prepared = self.api.client.prepare_update(
                round_id=round_id,
                local_loss_before=result.loss_before,
                local_loss_after=result.loss_after,
                label_distribution={"counts": self.trainer.label_counts()},
                data_size=self.trainer.num_samples(),
                training_time_ms=training_ms,
            )
            outcome = RoundOutcome(
                round_id, "rejected", prepared.reason, prepared.update_id, prepared.utility_score,
                prepared.compression_ratio, 0, encoded_size(DensePayload(delta)),
                result.loss_before, result.loss_after, training_ms, timings,
            )
            if not prepared.accepted:
                return outcome

            t2 = time.perf_counter()
            blob = encode(self.feedback.compress("global", delta, prepared.compression_ratio), self.adapter.spec().digest)
            uploaded = self.transfers.upload(prepared.upload.url, blob)
            timings["upload_s"] = time.perf_counter() - t2
            self.api.client.submit_update(round_id=round_id, update_id=prepared.update_id, sha256=uploaded["sha256"])
            outcome.status = "submitted"
            outcome.bytes_sent = len(blob)
            log.info("round %s: submitted %d bytes (ratio %.2f, utility %.3f, model v%s)",
                     round_id, len(blob), prepared.compression_ratio, prepared.utility_score, version)
            self.completed.append(round_id)
            return outcome
        finally:
            heartbeat.stop()

    def current_round(self):
        try:
            return self.api.client.get_current_round()
        except ConnectError as err:
            if err.code is Code.NOT_FOUND:
                return None
            raise

    def run(self, max_rounds=None, stop_event=None, poll_interval=None):
        stop = stop_event or threading.Event()
        interval = poll_interval if poll_interval is not None else self.session.settings.round_poll_interval
        outcomes = []
        while not stop.is_set() and (max_rounds is None or len(outcomes) < max_rounds):
            current = self.current_round()
            if current is None or current.round_id in self.completed or current.round_id in {o.round_id for o in outcomes}:
                stop.wait(interval)
                continue
            outcome = self.run_round(current.round_id)
            log.info("round %s finished: %s %s", current.round_id, outcome.status, outcome.reason)
            outcomes.append(outcome)
        return outcomes
