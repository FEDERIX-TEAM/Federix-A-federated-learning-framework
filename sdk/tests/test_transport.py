import secrets

import pytest

from federix_sdk import Code, ConnectError, FederixApi
from federix_sdk._gen import common_pb2, system_pb2


@pytest.fixture
def api(backend):
    with FederixApi(backend.base_url) as a:
        yield a


@pytest.fixture
def admin(backend):
    with FederixApi(backend.base_url) as a:
        a.access_token = a.auth.admin_login(email=backend.admin_email, password=backend.admin_password).access_token
        yield a


def new_client(backend, admin):
    token = admin.admin.create_enrollment_token(label="sdk-test", max_uses=1, ttl_hours=1).token
    a = FederixApi(backend.base_url)
    reg = a.auth.register(name="sdk", sdk_version="1.0.0", platform="test", enrollment_token=token)
    a.access_token = a.auth.client_login(client_id=reg.client_id, api_key=reg.api_key).access_token
    return a, reg


def test_unary_calls_reach_the_real_backend(api):
    health = api.system.health_check()
    assert isinstance(health, system_pb2.HealthResponse)
    assert (health.status, health.db, health.redis) == ("ok", "connected", "connected")
    assert api.system.get_version().api_version == "v1"


def test_snake_case_and_proto_names_are_the_same_method(api):
    assert api.system.HealthCheck().status == api.system.health_check().status
    assert "HealthCheck" in api.system.methods()
    with pytest.raises(AttributeError, match="has no method 'nope'"):
        api.system.nope
    with pytest.raises(TypeError, match="not both"):
        api.system.health_check(common_pb2.Empty(), x=1)


def test_server_errors_become_connect_errors_with_the_right_code(api, backend):
    with pytest.raises(ConnectError) as info:
        api.auth.admin_login(email=backend.admin_email, password="wrong")
    assert info.value.code is Code.UNAUTHENTICATED
    assert "Invalid email or password" in info.value.message
    with pytest.raises(ConnectError) as info:
        api.auth.admin_login(email="", password="")
    assert info.value.code is Code.INVALID_ARGUMENT


def test_signed_in_calls_send_the_bearer_token(admin):
    me = admin.auth.get_me()
    assert me.role == common_pb2.ROLE_SUPER_ADMIN


def test_nested_messages_can_be_given_as_dicts(admin):
    res = admin.admin.update_config(utility={"weight_quality": 2.0, "temperature": 0.5})
    assert res.updated_config.utility.weight_quality == 2.0
    assert res.updated_config.utility.temperature == 0.5


def test_server_streams_yield_every_message(admin, backend):
    for _ in range(2):
        admin.auth.create_admin_user(email=f"u_{secrets.token_hex(4)}@federix.test", password="long-password-123",
                                     role=common_pb2.ROLE_VIEWER, name="viewer")
    users = list(admin.admin.list_users())
    assert len(users) >= 3
    assert any(u.email == backend.admin_email for u in users)


def test_an_error_inside_a_stream_is_raised(admin, backend):
    client, _ = new_client(backend, admin)
    with pytest.raises(ConnectError) as info:
        list(client.admin.list_users())
    assert info.value.code is Code.PERMISSION_DENIED


def test_internal_token_calls(backend):
    with FederixApi(backend.base_url, internal_token=backend.internal_token) as fl:
        assert fl.fl.get_fl_config().min_clients >= 1
    with FederixApi(backend.base_url, internal_token="wrong") as fl:
        with pytest.raises(ConnectError) as info:
            fl.fl.get_fl_config()
        assert info.value.code is Code.UNAUTHENTICATED


def test_an_unknown_rpc_is_unimplemented(api):
    with pytest.raises(ConnectError) as info:
        api.transport.unary("federix.v1.SystemService", "Nope", common_pb2.Empty(), common_pb2.Empty)
    assert info.value.code is Code.UNIMPLEMENTED


def test_an_unreachable_server_is_unavailable():
    with FederixApi("http://127.0.0.1:1", connect_timeout=1) as a:
        with pytest.raises(ConnectError) as info:
            a.system.health_check()
        assert info.value.code is Code.UNAVAILABLE


def test_a_long_stream_respects_the_timeout(admin):
    received = []
    with pytest.raises(ConnectError) as info:
        for event in admin.events.subscribe(timeout=1.0):
            received.append(event.type)
    assert info.value.code is Code.DEADLINE_EXCEEDED
    assert received[:1] == ["connected"]


def test_stopping_a_stream_early_closes_it(admin):
    stream = admin.events.subscribe()
    first = next(stream)
    stream.close()
    assert first.type == "connected"
    assert admin.system.health_check().status == "ok"
