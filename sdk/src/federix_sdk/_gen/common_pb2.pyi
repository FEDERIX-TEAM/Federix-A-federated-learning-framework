from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class Role(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROLE_UNSPECIFIED: _ClassVar[Role]
    ROLE_SUPER_ADMIN: _ClassVar[Role]
    ROLE_ADMIN: _ClassVar[Role]
    ROLE_FL_ENGINEER: _ClassVar[Role]
    ROLE_VIEWER: _ClassVar[Role]
    ROLE_SDK_CLIENT: _ClassVar[Role]

class RoundStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROUND_STATUS_UNSPECIFIED: _ClassVar[RoundStatus]
    ROUND_STATUS_PENDING: _ClassVar[RoundStatus]
    ROUND_STATUS_ACTIVE: _ClassVar[RoundStatus]
    ROUND_STATUS_AGGREGATING: _ClassVar[RoundStatus]
    ROUND_STATUS_COMPLETE: _ClassVar[RoundStatus]
    ROUND_STATUS_FAILED: _ClassVar[RoundStatus]
    ROUND_STATUS_ABORTED: _ClassVar[RoundStatus]

class UpdateStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    UPDATE_STATUS_UNSPECIFIED: _ClassVar[UpdateStatus]
    UPDATE_STATUS_PENDING: _ClassVar[UpdateStatus]
    UPDATE_STATUS_ACCEPTED: _ClassVar[UpdateStatus]
    UPDATE_STATUS_COMPRESSED: _ClassVar[UpdateStatus]
    UPDATE_STATUS_REJECTED: _ClassVar[UpdateStatus]

class CompressionLevel(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    COMPRESSION_LEVEL_UNSPECIFIED: _ClassVar[CompressionLevel]
    COMPRESSION_LEVEL_NONE: _ClassVar[CompressionLevel]
    COMPRESSION_LEVEL_PARTIAL: _ClassVar[CompressionLevel]
    COMPRESSION_LEVEL_FULL: _ClassVar[CompressionLevel]

class RoundReadyReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROUND_READY_REASON_UNSPECIFIED: _ClassVar[RoundReadyReason]
    ROUND_READY_REASON_DEADLINE: _ClassVar[RoundReadyReason]
    ROUND_READY_REASON_ALL_SUBMITTED: _ClassVar[RoundReadyReason]
    ROUND_READY_REASON_MAX_UPDATES: _ClassVar[RoundReadyReason]
    ROUND_READY_REASON_KEEPALIVE: _ClassVar[RoundReadyReason]
    ROUND_READY_REASON_RESUMED: _ClassVar[RoundReadyReason]

class FlServerState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FL_SERVER_STATE_UNSPECIFIED: _ClassVar[FlServerState]
    FL_SERVER_STATE_STARTING: _ClassVar[FlServerState]
    FL_SERVER_STATE_IDLE: _ClassVar[FlServerState]
    FL_SERVER_STATE_AGGREGATING: _ClassVar[FlServerState]
    FL_SERVER_STATE_ERROR: _ClassVar[FlServerState]
ROLE_UNSPECIFIED: Role
ROLE_SUPER_ADMIN: Role
ROLE_ADMIN: Role
ROLE_FL_ENGINEER: Role
ROLE_VIEWER: Role
ROLE_SDK_CLIENT: Role
ROUND_STATUS_UNSPECIFIED: RoundStatus
ROUND_STATUS_PENDING: RoundStatus
ROUND_STATUS_ACTIVE: RoundStatus
ROUND_STATUS_AGGREGATING: RoundStatus
ROUND_STATUS_COMPLETE: RoundStatus
ROUND_STATUS_FAILED: RoundStatus
ROUND_STATUS_ABORTED: RoundStatus
UPDATE_STATUS_UNSPECIFIED: UpdateStatus
UPDATE_STATUS_PENDING: UpdateStatus
UPDATE_STATUS_ACCEPTED: UpdateStatus
UPDATE_STATUS_COMPRESSED: UpdateStatus
UPDATE_STATUS_REJECTED: UpdateStatus
COMPRESSION_LEVEL_UNSPECIFIED: CompressionLevel
COMPRESSION_LEVEL_NONE: CompressionLevel
COMPRESSION_LEVEL_PARTIAL: CompressionLevel
COMPRESSION_LEVEL_FULL: CompressionLevel
ROUND_READY_REASON_UNSPECIFIED: RoundReadyReason
ROUND_READY_REASON_DEADLINE: RoundReadyReason
ROUND_READY_REASON_ALL_SUBMITTED: RoundReadyReason
ROUND_READY_REASON_MAX_UPDATES: RoundReadyReason
ROUND_READY_REASON_KEEPALIVE: RoundReadyReason
ROUND_READY_REASON_RESUMED: RoundReadyReason
FL_SERVER_STATE_UNSPECIFIED: FlServerState
FL_SERVER_STATE_STARTING: FlServerState
FL_SERVER_STATE_IDLE: FlServerState
FL_SERVER_STATE_AGGREGATING: FlServerState
FL_SERVER_STATE_ERROR: FlServerState

class Empty(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class LabelDistribution(_message.Message):
    __slots__ = ("counts",)
    class CountsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: float
        def __init__(self, key: _Optional[str] = ..., value: _Optional[float] = ...) -> None: ...
    COUNTS_FIELD_NUMBER: _ClassVar[int]
    counts: _containers.ScalarMap[str, float]
    def __init__(self, counts: _Optional[_Mapping[str, float]] = ...) -> None: ...

class StringMap(_message.Message):
    __slots__ = ("entries",)
    class EntriesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.ScalarMap[str, str]
    def __init__(self, entries: _Optional[_Mapping[str, str]] = ...) -> None: ...

class StatusResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class SignedUrl(_message.Message):
    __slots__ = ("url", "expires_at", "refresh_until", "max_bytes")
    URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    REFRESH_UNTIL_FIELD_NUMBER: _ClassVar[int]
    MAX_BYTES_FIELD_NUMBER: _ClassVar[int]
    url: str
    expires_at: str
    refresh_until: str
    max_bytes: int
    def __init__(self, url: _Optional[str] = ..., expires_at: _Optional[str] = ..., refresh_until: _Optional[str] = ..., max_bytes: _Optional[int] = ...) -> None: ...

class UtilityConfig(_message.Message):
    __slots__ = ("weight_quality", "weight_size", "weight_diversity", "size_saturation", "num_classes", "temperature", "threshold_high", "threshold_low", "ratio_high", "ratio_medium", "ratio_low", "reject_below")
    WEIGHT_QUALITY_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_SIZE_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_DIVERSITY_FIELD_NUMBER: _ClassVar[int]
    SIZE_SATURATION_FIELD_NUMBER: _ClassVar[int]
    NUM_CLASSES_FIELD_NUMBER: _ClassVar[int]
    TEMPERATURE_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_HIGH_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_LOW_FIELD_NUMBER: _ClassVar[int]
    RATIO_HIGH_FIELD_NUMBER: _ClassVar[int]
    RATIO_MEDIUM_FIELD_NUMBER: _ClassVar[int]
    RATIO_LOW_FIELD_NUMBER: _ClassVar[int]
    REJECT_BELOW_FIELD_NUMBER: _ClassVar[int]
    weight_quality: float
    weight_size: float
    weight_diversity: float
    size_saturation: float
    num_classes: int
    temperature: float
    threshold_high: float
    threshold_low: float
    ratio_high: float
    ratio_medium: float
    ratio_low: float
    reject_below: float
    def __init__(self, weight_quality: _Optional[float] = ..., weight_size: _Optional[float] = ..., weight_diversity: _Optional[float] = ..., size_saturation: _Optional[float] = ..., num_classes: _Optional[int] = ..., temperature: _Optional[float] = ..., threshold_high: _Optional[float] = ..., threshold_low: _Optional[float] = ..., ratio_high: _Optional[float] = ..., ratio_medium: _Optional[float] = ..., ratio_low: _Optional[float] = ..., reject_below: _Optional[float] = ...) -> None: ...

class UtilityConfigUpdate(_message.Message):
    __slots__ = ("weight_quality", "weight_size", "weight_diversity", "size_saturation", "num_classes", "temperature", "ratio_high", "ratio_medium", "ratio_low", "reject_below")
    WEIGHT_QUALITY_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_SIZE_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_DIVERSITY_FIELD_NUMBER: _ClassVar[int]
    SIZE_SATURATION_FIELD_NUMBER: _ClassVar[int]
    NUM_CLASSES_FIELD_NUMBER: _ClassVar[int]
    TEMPERATURE_FIELD_NUMBER: _ClassVar[int]
    RATIO_HIGH_FIELD_NUMBER: _ClassVar[int]
    RATIO_MEDIUM_FIELD_NUMBER: _ClassVar[int]
    RATIO_LOW_FIELD_NUMBER: _ClassVar[int]
    REJECT_BELOW_FIELD_NUMBER: _ClassVar[int]
    weight_quality: float
    weight_size: float
    weight_diversity: float
    size_saturation: float
    num_classes: int
    temperature: float
    ratio_high: float
    ratio_medium: float
    ratio_low: float
    reject_below: float
    def __init__(self, weight_quality: _Optional[float] = ..., weight_size: _Optional[float] = ..., weight_diversity: _Optional[float] = ..., size_saturation: _Optional[float] = ..., num_classes: _Optional[int] = ..., temperature: _Optional[float] = ..., ratio_high: _Optional[float] = ..., ratio_medium: _Optional[float] = ..., ratio_low: _Optional[float] = ..., reject_below: _Optional[float] = ...) -> None: ...
