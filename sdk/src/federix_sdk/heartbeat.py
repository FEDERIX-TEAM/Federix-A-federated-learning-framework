import logging
import threading

from federix_sdk.errors import Code, ConnectError

log = logging.getLogger("federix_sdk")


class Heartbeat:
    def __init__(self, session, round_id, interval=None, on_error=None):
        self.session = session
        self.round_id = round_id
        self.interval = interval if interval is not None else session.settings.heartbeat_interval
        if self.interval <= 0:
            raise ValueError("heartbeat interval must be > 0")
        self.on_error = on_error
        self.sent = 0
        self.failures = 0
        self.consecutive_failures = 0
        self.last_error = None
        self.stopped_reason = None
        self._stop = threading.Event()
        self._thread = None

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    def start(self):
        if self.running:
            return self
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name=f"federix-heartbeat-{self.round_id[:8]}", daemon=True)
        self._thread.start()
        return self

    def stop(self, timeout=5.0):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)
        if self.stopped_reason is None:
            self.stopped_reason = "stopped"

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()

    def beat(self):
        try:
            self.session.api.client.heartbeat(round_id=self.round_id)
        except ConnectError as err:
            self.failures += 1
            self.consecutive_failures += 1
            self.last_error = err
            log.warning("heartbeat for round %s failed: %s", self.round_id, err)
            if self.on_error:
                self.on_error(err)
            if err.code is Code.PERMISSION_DENIED:
                self.stopped_reason = f"refused by the server: {err.message}"
                self._stop.set()
            return False
        except Exception as err:
            self.failures += 1
            self.consecutive_failures += 1
            self.last_error = err
            log.exception("heartbeat for round %s failed", self.round_id)
            return False
        self.sent += 1
        self.consecutive_failures = 0
        return True

    def _run(self):
        self.beat()
        while not self._stop.wait(self.interval):
            self.beat()
