from . import common_pb2 as _common_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ClientStatusResponse(_message.Message):
    __slots__ = ("client_id", "status", "last_seen", "round_count")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    LAST_SEEN_FIELD_NUMBER: _ClassVar[int]
    ROUND_COUNT_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    status: str
    last_seen: str
    round_count: int
    def __init__(self, client_id: _Optional[str] = ..., status: _Optional[str] = ..., last_seen: _Optional[str] = ..., round_count: _Optional[int] = ...) -> None: ...

class RoundSummary(_message.Message):
    __slots__ = ("round_id", "round_number", "model_version", "deadline", "participants")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    ROUND_NUMBER_FIELD_NUMBER: _ClassVar[int]
    MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    DEADLINE_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANTS_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    round_number: int
    model_version: int
    deadline: str
    participants: int
    def __init__(self, round_id: _Optional[str] = ..., round_number: _Optional[int] = ..., model_version: _Optional[int] = ..., deadline: _Optional[str] = ..., participants: _Optional[int] = ...) -> None: ...

class JoinRoundRequest(_message.Message):
    __slots__ = ("round_id", "local_data_size", "device_info")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    LOCAL_DATA_SIZE_FIELD_NUMBER: _ClassVar[int]
    DEVICE_INFO_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    local_data_size: int
    device_info: _common_pb2.StringMap
    def __init__(self, round_id: _Optional[str] = ..., local_data_size: _Optional[int] = ..., device_info: _Optional[_Union[_common_pb2.StringMap, _Mapping]] = ...) -> None: ...

class JoinRoundResponse(_message.Message):
    __slots__ = ("accepted", "model_download_url", "instructions")
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    MODEL_DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    accepted: bool
    model_download_url: str
    instructions: str
    def __init__(self, accepted: _Optional[bool] = ..., model_download_url: _Optional[str] = ..., instructions: _Optional[str] = ...) -> None: ...

class LeaveRoundRequest(_message.Message):
    __slots__ = ("round_id", "reason")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    reason: str
    def __init__(self, round_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class LeaveRoundResponse(_message.Message):
    __slots__ = ("success", "remaining_participants")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    REMAINING_PARTICIPANTS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    remaining_participants: int
    def __init__(self, success: _Optional[bool] = ..., remaining_participants: _Optional[int] = ...) -> None: ...

class ModelDownloadRequest(_message.Message):
    __slots__ = ("round_id", "model_version")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    model_version: int
    def __init__(self, round_id: _Optional[str] = ..., model_version: _Optional[int] = ...) -> None: ...

class ModelDownloadResponse(_message.Message):
    __slots__ = ("download_url", "model_version", "format", "expires_at")
    DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    FORMAT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    download_url: str
    model_version: int
    format: str
    expires_at: str
    def __init__(self, download_url: _Optional[str] = ..., model_version: _Optional[int] = ..., format: _Optional[str] = ..., expires_at: _Optional[str] = ...) -> None: ...

class SubmitUpdateRequest(_message.Message):
    __slots__ = ("round_id", "delta_weights_url", "local_loss_before", "local_loss_after", "label_distribution", "data_size", "training_time_ms", "update_id", "sha256")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    DELTA_WEIGHTS_URL_FIELD_NUMBER: _ClassVar[int]
    LOCAL_LOSS_BEFORE_FIELD_NUMBER: _ClassVar[int]
    LOCAL_LOSS_AFTER_FIELD_NUMBER: _ClassVar[int]
    LABEL_DISTRIBUTION_FIELD_NUMBER: _ClassVar[int]
    DATA_SIZE_FIELD_NUMBER: _ClassVar[int]
    TRAINING_TIME_MS_FIELD_NUMBER: _ClassVar[int]
    UPDATE_ID_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    delta_weights_url: str
    local_loss_before: float
    local_loss_after: float
    label_distribution: _common_pb2.LabelDistribution
    data_size: int
    training_time_ms: int
    update_id: str
    sha256: str
    def __init__(self, round_id: _Optional[str] = ..., delta_weights_url: _Optional[str] = ..., local_loss_before: _Optional[float] = ..., local_loss_after: _Optional[float] = ..., label_distribution: _Optional[_Union[_common_pb2.LabelDistribution, _Mapping]] = ..., data_size: _Optional[int] = ..., training_time_ms: _Optional[int] = ..., update_id: _Optional[str] = ..., sha256: _Optional[str] = ...) -> None: ...

class SubmitUpdateResponse(_message.Message):
    __slots__ = ("update_id", "accepted", "compression_required")
    UPDATE_ID_FIELD_NUMBER: _ClassVar[int]
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    update_id: str
    accepted: bool
    compression_required: bool
    def __init__(self, update_id: _Optional[str] = ..., accepted: _Optional[bool] = ..., compression_required: _Optional[bool] = ...) -> None: ...

class UpdateStatusRequest(_message.Message):
    __slots__ = ("round_id",)
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    def __init__(self, round_id: _Optional[str] = ...) -> None: ...

class UpdateStatusResponse(_message.Message):
    __slots__ = ("update_id", "status", "utility_score", "reason")
    UPDATE_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    UTILITY_SCORE_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    update_id: str
    status: _common_pb2.UpdateStatus
    utility_score: float
    reason: str
    def __init__(self, update_id: _Optional[str] = ..., status: _Optional[_Union[_common_pb2.UpdateStatus, str]] = ..., utility_score: _Optional[float] = ..., reason: _Optional[str] = ...) -> None: ...

class SelfMetricsRequest(_message.Message):
    __slots__ = ("limit",)
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    limit: int
    def __init__(self, limit: _Optional[int] = ...) -> None: ...

class SelfMetricEntry(_message.Message):
    __slots__ = ("round_id", "utility_score", "status", "loss_improvement")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    UTILITY_SCORE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    LOSS_IMPROVEMENT_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    utility_score: float
    status: _common_pb2.UpdateStatus
    loss_improvement: float
    def __init__(self, round_id: _Optional[str] = ..., utility_score: _Optional[float] = ..., status: _Optional[_Union[_common_pb2.UpdateStatus, str]] = ..., loss_improvement: _Optional[float] = ...) -> None: ...

class HeartbeatRequest(_message.Message):
    __slots__ = ("round_id",)
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    def __init__(self, round_id: _Optional[str] = ...) -> None: ...

class HeartbeatResponse(_message.Message):
    __slots__ = ("ok", "server_time")
    OK_FIELD_NUMBER: _ClassVar[int]
    SERVER_TIME_FIELD_NUMBER: _ClassVar[int]
    ok: bool
    server_time: str
    def __init__(self, ok: _Optional[bool] = ..., server_time: _Optional[str] = ...) -> None: ...

class ClientConfigResponse(_message.Message):
    __slots__ = ("mu", "local_epochs", "batch_size", "compression_threshold", "utility")
    MU_FIELD_NUMBER: _ClassVar[int]
    LOCAL_EPOCHS_FIELD_NUMBER: _ClassVar[int]
    BATCH_SIZE_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    UTILITY_FIELD_NUMBER: _ClassVar[int]
    mu: float
    local_epochs: int
    batch_size: int
    compression_threshold: float
    utility: _common_pb2.UtilityConfig
    def __init__(self, mu: _Optional[float] = ..., local_epochs: _Optional[int] = ..., batch_size: _Optional[int] = ..., compression_threshold: _Optional[float] = ..., utility: _Optional[_Union[_common_pb2.UtilityConfig, _Mapping]] = ...) -> None: ...

class PrepareUpdateRequest(_message.Message):
    __slots__ = ("round_id", "local_loss_before", "local_loss_after", "label_distribution", "data_size", "training_time_ms")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    LOCAL_LOSS_BEFORE_FIELD_NUMBER: _ClassVar[int]
    LOCAL_LOSS_AFTER_FIELD_NUMBER: _ClassVar[int]
    LABEL_DISTRIBUTION_FIELD_NUMBER: _ClassVar[int]
    DATA_SIZE_FIELD_NUMBER: _ClassVar[int]
    TRAINING_TIME_MS_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    local_loss_before: float
    local_loss_after: float
    label_distribution: _common_pb2.LabelDistribution
    data_size: int
    training_time_ms: int
    def __init__(self, round_id: _Optional[str] = ..., local_loss_before: _Optional[float] = ..., local_loss_after: _Optional[float] = ..., label_distribution: _Optional[_Union[_common_pb2.LabelDistribution, _Mapping]] = ..., data_size: _Optional[int] = ..., training_time_ms: _Optional[int] = ...) -> None: ...

class PrepareUpdateResponse(_message.Message):
    __slots__ = ("update_id", "accepted", "utility_score", "compression_level", "compression_ratio", "upload", "reason")
    UPDATE_ID_FIELD_NUMBER: _ClassVar[int]
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    UTILITY_SCORE_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_RATIO_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    update_id: str
    accepted: bool
    utility_score: float
    compression_level: _common_pb2.CompressionLevel
    compression_ratio: float
    upload: _common_pb2.SignedUrl
    reason: str
    def __init__(self, update_id: _Optional[str] = ..., accepted: _Optional[bool] = ..., utility_score: _Optional[float] = ..., compression_level: _Optional[_Union[_common_pb2.CompressionLevel, str]] = ..., compression_ratio: _Optional[float] = ..., upload: _Optional[_Union[_common_pb2.SignedUrl, _Mapping]] = ..., reason: _Optional[str] = ...) -> None: ...
