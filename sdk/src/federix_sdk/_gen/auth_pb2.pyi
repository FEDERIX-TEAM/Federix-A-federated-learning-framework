from . import common_pb2 as _common_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RegisterRequest(_message.Message):
    __slots__ = ("name", "description", "sdk_version", "platform", "enrollment_token")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    SDK_VERSION_FIELD_NUMBER: _ClassVar[int]
    PLATFORM_FIELD_NUMBER: _ClassVar[int]
    ENROLLMENT_TOKEN_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    sdk_version: str
    platform: str
    enrollment_token: str
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., sdk_version: _Optional[str] = ..., platform: _Optional[str] = ..., enrollment_token: _Optional[str] = ...) -> None: ...

class RegisterResponse(_message.Message):
    __slots__ = ("client_id", "api_key", "created_at")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    API_KEY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    api_key: str
    created_at: str
    def __init__(self, client_id: _Optional[str] = ..., api_key: _Optional[str] = ..., created_at: _Optional[str] = ...) -> None: ...

class ClientLoginRequest(_message.Message):
    __slots__ = ("client_id", "api_key")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    API_KEY_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    api_key: str
    def __init__(self, client_id: _Optional[str] = ..., api_key: _Optional[str] = ...) -> None: ...

class TokenResponse(_message.Message):
    __slots__ = ("access_token", "refresh_token", "expires_in")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_IN_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    expires_in: int
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., expires_in: _Optional[int] = ...) -> None: ...

class AdminLoginRequest(_message.Message):
    __slots__ = ("email", "password")
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    email: str
    password: str
    def __init__(self, email: _Optional[str] = ..., password: _Optional[str] = ...) -> None: ...

class AdminTokenResponse(_message.Message):
    __slots__ = ("access_token", "refresh_token", "role", "user_id")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    role: _common_pb2.Role
    user_id: str
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.Role, str]] = ..., user_id: _Optional[str] = ...) -> None: ...

class RefreshRequest(_message.Message):
    __slots__ = ("refresh_token",)
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    refresh_token: str
    def __init__(self, refresh_token: _Optional[str] = ...) -> None: ...

class AccessTokenResponse(_message.Message):
    __slots__ = ("access_token", "expires_in", "refresh_token")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_IN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    expires_in: int
    refresh_token: str
    def __init__(self, access_token: _Optional[str] = ..., expires_in: _Optional[int] = ..., refresh_token: _Optional[str] = ...) -> None: ...

class RotateKeyRequest(_message.Message):
    __slots__ = ("client_id",)
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    def __init__(self, client_id: _Optional[str] = ...) -> None: ...

class RotateKeyResponse(_message.Message):
    __slots__ = ("new_api_key",)
    NEW_API_KEY_FIELD_NUMBER: _ClassVar[int]
    new_api_key: str
    def __init__(self, new_api_key: _Optional[str] = ...) -> None: ...

class CreateAdminRequest(_message.Message):
    __slots__ = ("email", "password", "role", "name")
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    email: str
    password: str
    role: _common_pb2.Role
    name: str
    def __init__(self, email: _Optional[str] = ..., password: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.Role, str]] = ..., name: _Optional[str] = ...) -> None: ...

class CreateAdminResponse(_message.Message):
    __slots__ = ("user_id", "role", "created_at")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    role: _common_pb2.Role
    created_at: str
    def __init__(self, user_id: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.Role, str]] = ..., created_at: _Optional[str] = ...) -> None: ...

class ProfileResponse(_message.Message):
    __slots__ = ("id", "name", "role", "created_at", "last_login")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_LOGIN_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    role: _common_pb2.Role
    created_at: str
    last_login: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.Role, str]] = ..., created_at: _Optional[str] = ..., last_login: _Optional[str] = ...) -> None: ...
