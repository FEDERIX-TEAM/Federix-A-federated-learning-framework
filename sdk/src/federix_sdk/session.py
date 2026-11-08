import base64
import json
import logging
import threading
import time

from federix_sdk.client import FederixApi
from federix_sdk.credentials import Credentials, CredentialStore
from federix_sdk.errors import Code, ConnectError
from federix_sdk.settings import ClientSettings
from federix_sdk.version import SDK_VERSION

log = logging.getLogger("federix_sdk")

UNAUTHENTICATED_RPCS = {
    "federix.v1.AuthService/Register",
    "federix.v1.AuthService/ClientLogin",
    "federix.v1.AuthService/RefreshToken",
}


class CredentialsRejected(Exception):
    pass


class EnrollmentRequired(Exception):
    pass


def token_expiry(token):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return float(json.loads(base64.urlsafe_b64decode(payload))["exp"])
    except (IndexError, KeyError, ValueError, TypeError):
        return 0.0


class Session:
    def __init__(self, settings=None, store=None, api=None, clock=time.time):
        self.settings = settings or ClientSettings.load()
        self.store = store or CredentialStore(self.settings.credentials_path)
        self.api = api or FederixApi(
            self.settings.server_url, timeout=self.settings.request_timeout, connect_timeout=self.settings.connect_timeout
        )
        self.api.call_hook = self._hook
        self.credentials = None
        self.stats = {"registrations": 0, "logins": 0, "refreshes": 0, "retries": 0}
        self._clock = clock
        self._lock = threading.RLock()
        self._refresh_token = None
        self._expires_at = 0.0

    @property
    def client_id(self):
        return self.credentials.client_id if self.credentials else None

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.close()

    def start(self):
        with self._lock:
            self.ensure_credentials()
            if not self.api.access_token:
                self.login()
        return self

    def close(self):
        self.api.close()

    def ensure_credentials(self):
        with self._lock:
            if self.credentials:
                return self.credentials
            stored = self.store.load(self.settings.server_url)
            if stored:
                self.credentials = stored
                return stored
            reg = self.api.auth.register(
                name=self.settings.client_name,
                sdk_version=SDK_VERSION,
                platform=self.settings.platform,
                enrollment_token=self.settings.enrollment_token,
            ) if self.settings.enrollment_token else self._register_without_token()
            self.credentials = Credentials(self.settings.server_url, reg.client_id, reg.api_key)
            self.store.save(self.credentials)
            self.stats["registrations"] += 1
            log.info("registered as client %s; credentials saved to %s", reg.client_id, self.store.path)
            return self.credentials

    def _register_without_token(self):
        try:
            return self.api.auth.register(name=self.settings.client_name, sdk_version=SDK_VERSION, platform=self.settings.platform)
        except ConnectError as err:
            if err.code is Code.UNAUTHENTICATED:
                raise EnrollmentRequired(
                    "this server needs an enrollment token to register; ask an admin for one and set "
                    "FEDERIX_SDK_ENROLLMENT_TOKEN (or ClientSettings.enrollment_token)"
                ) from err
            raise

    def login(self):
        with self._lock:
            creds = self.ensure_credentials()
            try:
                res = self.api.auth.client_login(client_id=creds.client_id, api_key=creds.api_key)
            except ConnectError as err:
                if err.code is Code.UNAUTHENTICATED:
                    raise CredentialsRejected(
                        f"the server rejected the stored API key for client {creds.client_id} (it may have been rotated "
                        f"or the client deleted); remove its entry from {self.store.path} and enroll again"
                    ) from err
                raise
            self._set_tokens(res.access_token, res.refresh_token)
            self.stats["logins"] += 1

    def refresh(self, seen_token=None):
        with self._lock:
            if seen_token is not None and self.api.access_token != seen_token:
                return
            if not self._refresh_token:
                self.login()
                return
            try:
                res = self.api.auth.refresh_token(refresh_token=self._refresh_token)
            except ConnectError as err:
                if err.code is not Code.UNAUTHENTICATED:
                    raise
                log.info("session could not be refreshed (%s); logging in again", err.message)
                self.login()
                return
            self._set_tokens(res.access_token, res.refresh_token)
            self.stats["refreshes"] += 1

    def _set_tokens(self, access, refresh):
        self.api.access_token = access
        self._refresh_token = refresh or self._refresh_token
        self._expires_at = token_expiry(access)

    def _ensure_fresh(self):
        token = self.api.access_token
        if not token:
            self.start()
        elif self._expires_at - self._clock() <= self.settings.refresh_margin:
            self.refresh(seen_token=token)

    def _hook(self, invoke, rpc, streaming):
        if rpc in UNAUTHENTICATED_RPCS:
            return invoke()
        self._ensure_fresh()
        token = self.api.access_token
        if streaming:
            return invoke()
        try:
            return invoke()
        except ConnectError as err:
            if err.code is not Code.UNAUTHENTICATED:
                raise
            self.stats["retries"] += 1
            self.refresh(seen_token=token)
            return invoke()
