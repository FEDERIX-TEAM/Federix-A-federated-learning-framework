import json
import os
import stat
import threading
import time

import pytest

from federix_sdk import (
    ClientSettings,
    Code,
    ConnectError,
    CredentialsError,
    CredentialsRejected,
    CredentialStore,
    EnrollmentRequired,
    FederixApi,
    Heartbeat,
    Session,
    SettingsError,
)


def admin_api(backend):
    api = FederixApi(backend.base_url)
    api.access_token = api.auth.admin_login(email=backend.admin_email, password=backend.admin_password).access_token
    return api


def enrollment_token(backend, uses=1):
    with admin_api(backend) as a:
        return a.admin.create_enrollment_token(label="session-test", max_uses=uses, ttl_hours=1).token


def settings(tmp_path, backend, token=None, **kw):
    values = {
        "server_url": backend.base_url,
        "credentials_path": str(tmp_path / "home" / ".federix" / "credentials.json"),
        "enrollment_token": token if token is not None else enrollment_token(backend),
        "client_name": "session-test",
        **kw,
    }
    return ClientSettings.load(env={}, **values)


def mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


def test_first_start_enrolls_and_saves_private_credentials(tmp_path, backend):
    s = settings(tmp_path, backend)
    with Session(s) as session:
        assert session.client_id
        assert session.api.client.get_status().client_id == session.client_id
        assert session.stats["registrations"] == 1 and session.stats["logins"] == 1
    path = tmp_path / "home" / ".federix" / "credentials.json"
    assert mode(path) == 0o600
    assert mode(path.parent) == 0o700
    saved = json.loads(path.read_text())[backend.base_url]
    assert saved["client_id"] == session.client_id and saved["api_key"].startswith("fdx_")


def test_a_second_start_reuses_the_saved_identity(tmp_path, backend):
    s = settings(tmp_path, backend)
    with Session(s) as first:
        client_id = first.client_id
    with Session(s) as second:
        assert second.client_id == client_id
        assert second.stats["registrations"] == 0
        assert second.api.client.get_status().client_id == client_id


def test_credentials_for_several_servers_live_side_by_side(tmp_path, backend):
    store = CredentialStore(tmp_path / "c.json")
    with Session(settings(tmp_path, backend, credentials_path=str(tmp_path / "c.json")), store=store) as s:
        mine = s.client_id
    from federix_sdk import Credentials
    store.save(Credentials("http://other.example:4000", "other-id", "fdx_other"))
    assert store.load(backend.base_url).client_id == mine
    assert store.load("http://other.example:4000").client_id == "other-id"
    store.forget("http://other.example:4000")
    assert store.load("http://other.example:4000") is None


def test_credentials_readable_by_others_are_refused(tmp_path):
    path = tmp_path / "creds.json"
    path.write_text("{}")
    os.chmod(path, 0o644)
    with pytest.raises(CredentialsError, match="chmod 600"):
        CredentialStore(path).load("http://x")


def test_enrolling_without_a_token_explains_what_to_do(tmp_path, backend):
    with pytest.raises(EnrollmentRequired, match="FEDERIX_SDK_ENROLLMENT_TOKEN"):
        Session(settings(tmp_path, backend, token="")).start()


def test_an_expired_access_token_is_refreshed_transparently(tmp_path, short_token_backend):
    with Session(settings(tmp_path, short_token_backend, refresh_margin=0)) as session:
        first = session.api.access_token
        session.api.client.get_status()
        time.sleep(2.3)
        assert session.api.client.get_status().client_id == session.client_id
        assert session.api.access_token != first
        assert session.stats["logins"] == 1
        assert session.stats["refreshes"] + session.stats["retries"] >= 1


def test_tokens_are_refreshed_before_they_expire(tmp_path, short_token_backend):
    with Session(settings(tmp_path, short_token_backend, refresh_margin=60)) as session:
        for _ in range(3):
            session.api.client.get_status()
        assert session.stats["refreshes"] >= 2
        assert session.stats["retries"] == 0


def test_concurrent_calls_after_expiry_refresh_once_and_never_trip_reuse_detection(tmp_path, short_token_backend):
    with Session(settings(tmp_path, short_token_backend, refresh_margin=0)) as session:
        session.api.client.get_status()
        time.sleep(2.3)
        results, errors = [], []

        def call():
            try:
                results.append(session.api.client.get_status().client_id)
            except Exception as err:
                errors.append(err)

        threads = [threading.Thread(target=call) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []
        assert results == [session.client_id] * 8
        assert session.stats["logins"] == 1
        assert session.stats["refreshes"] <= 2


def test_a_session_ended_elsewhere_logs_in_again_with_the_api_key(tmp_path, backend):
    with Session(settings(tmp_path, backend)) as session:
        session.api.auth.logout()
        assert session.api.client.get_status().client_id == session.client_id
        assert session.stats["logins"] == 2


def test_a_rotated_api_key_raises_credentials_rejected(tmp_path, backend):
    with Session(settings(tmp_path, backend)) as session:
        with admin_api(backend) as admin:
            admin.auth.rotate_client_key(client_id=session.client_id)
        session.api.auth.logout()
        with pytest.raises(CredentialsRejected, match="enroll again"):
            session.api.client.get_status()


def test_a_banned_client_gets_permission_denied(tmp_path, backend):
    with Session(settings(tmp_path, backend)) as session:
        with admin_api(backend) as admin:
            admin.admin.ban_client(client_id=session.client_id, reason="test", duration_hours=1)
        with pytest.raises(ConnectError) as info:
            session.api.client.get_status()
        assert info.value.code is Code.PERMISSION_DENIED


def start_round(backend):
    with admin_api(backend) as admin:
        admin.admin.update_config(min_clients_per_round=1)
        for r in admin.admin.list_rounds(status="active"):
            admin.admin.stop_round(round_id=r.round_id)
        return admin.admin.start_round(max_clients=5, deadline_seconds=600).round_id


def test_the_heartbeat_thread_beats_and_stops_promptly(tmp_path, backend):
    round_id = start_round(backend)
    with Session(settings(tmp_path, backend)) as session:
        session.api.client.join_round(round_id=round_id, local_data_size=100)
        before = session.api.client.get_status().last_seen
        hb = Heartbeat(session, round_id, interval=0.3).start()
        time.sleep(1.0)
        started = time.time()
        hb.stop()
        assert time.time() - started < 1.0
        assert not hb.running
        assert hb.sent >= 3 and hb.failures == 0
        assert hb.stopped_reason == "stopped"
        assert session.api.client.get_status().last_seen >= before


def test_the_heartbeat_keeps_going_across_token_expiry(tmp_path, short_token_backend):
    round_id = start_round(short_token_backend)
    with Session(settings(tmp_path, short_token_backend, refresh_margin=0)) as session:
        session.api.client.join_round(round_id=round_id, local_data_size=100)
        with Heartbeat(session, round_id, interval=0.4) as hb:
            time.sleep(3.0)
        assert hb.failures == 0
        assert hb.sent >= 6


def test_the_heartbeat_stops_itself_when_the_client_is_banned(tmp_path, backend):
    round_id = start_round(backend)
    with Session(settings(tmp_path, backend)) as session:
        session.api.client.join_round(round_id=round_id, local_data_size=100)
        seen = []
        hb = Heartbeat(session, round_id, interval=0.2, on_error=seen.append).start()
        time.sleep(0.4)
        with admin_api(backend) as admin:
            admin.admin.ban_client(client_id=session.client_id, reason="test", duration_hours=1)
        deadline = time.time() + 3
        while hb.running and time.time() < deadline:
            time.sleep(0.05)
        assert not hb.running
        assert hb.stopped_reason.startswith("refused by the server")
        assert seen and seen[-1].code is Code.PERMISSION_DENIED


def test_settings_come_from_the_environment_and_are_validated(tmp_path):
    s = ClientSettings.load(env={"FEDERIX_SDK_SERVER_URL": "https://fl.example.com/", "FEDERIX_SDK_HEARTBEAT_INTERVAL": "5"})
    assert s.server_url == "https://fl.example.com"
    assert s.heartbeat_interval == 5.0
    assert s.credentials_path.endswith(os.path.join(".federix", "credentials.json"))
    with pytest.raises(SettingsError) as info:
        ClientSettings.load(env={"FEDERIX_SDK_SERVER_URL": "ftp://x", "FEDERIX_SDK_HEARTBEAT_INTERVAL": "abc"})
    assert "heartbeat_interval: expected a number" in str(info.value)
    with pytest.raises(SettingsError) as info:
        ClientSettings.load(env={}, server_url="ftp://x", refresh_margin=-1)
    assert "server_url must start with http" in str(info.value) and "refresh_margin must be >= 0" in str(info.value)
    with pytest.raises(SettingsError, match="unknown setting"):
        ClientSettings.load(env={}, nope=1)
