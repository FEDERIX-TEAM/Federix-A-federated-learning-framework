from . import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TriggerRoundRequest(_message.Message):
    __slots__ = ("round_id", "update_ids")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    UPDATE_IDS_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    update_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, round_id: _Optional[str] = ..., update_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class TriggerRoundResponse(_message.Message):
    __slots__ = ("accepted", "estimated_duration_ms")
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    accepted: bool
    estimated_duration_ms: int
    def __init__(self, accepted: _Optional[bool] = ..., estimated_duration_ms: _Optional[int] = ...) -> None: ...

class ModelMetrics(_message.Message):
    __slots__ = ("global_loss", "global_accuracy")
    GLOBAL_LOSS_FIELD_NUMBER: _ClassVar[int]
    GLOBAL_ACCURACY_FIELD_NUMBER: _ClassVar[int]
    global_loss: float
    global_accuracy: float
    def __init__(self, global_loss: _Optional[float] = ..., global_accuracy: _Optional[float] = ...) -> None: ...

class CompleteRoundRequest(_message.Message):
    __slots__ = ("round_id", "new_model_version", "model_url", "global_loss", "global_accuracy", "used_update_ids", "rejection_reasons")
    class RejectionReasonsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    NEW_MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    MODEL_URL_FIELD_NUMBER: _ClassVar[int]
    GLOBAL_LOSS_FIELD_NUMBER: _ClassVar[int]
    GLOBAL_ACCURACY_FIELD_NUMBER: _ClassVar[int]
    USED_UPDATE_IDS_FIELD_NUMBER: _ClassVar[int]
    REJECTION_REASONS_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    new_model_version: int
    model_url: str
    global_loss: float
    global_accuracy: float
    used_update_ids: _containers.RepeatedScalarFieldContainer[str]
    rejection_reasons: _containers.ScalarMap[str, str]
    def __init__(self, round_id: _Optional[str] = ..., new_model_version: _Optional[int] = ..., model_url: _Optional[str] = ..., global_loss: _Optional[float] = ..., global_accuracy: _Optional[float] = ..., used_update_ids: _Optional[_Iterable[str]] = ..., rejection_reasons: _Optional[_Mapping[str, str]] = ...) -> None: ...

class CompleteRoundResponse(_message.Message):
    __slots__ = ("success", "next_round_scheduled", "model_id")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    NEXT_ROUND_SCHEDULED_FIELD_NUMBER: _ClassVar[int]
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    success: bool
    next_round_scheduled: bool
    model_id: str
    def __init__(self, success: _Optional[bool] = ..., next_round_scheduled: _Optional[bool] = ..., model_id: _Optional[str] = ...) -> None: ...

class RoundUpdatesRequest(_message.Message):
    __slots__ = ("round_id",)
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    def __init__(self, round_id: _Optional[str] = ...) -> None: ...

class RoundUpdateEntry(_message.Message):
    __slots__ = ("update_id", "client_id", "download_url", "utility_score", "label_distribution", "sha256", "bytes", "compression_ratio", "data_size", "compression_level")
    UPDATE_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    UTILITY_SCORE_FIELD_NUMBER: _ClassVar[int]
    LABEL_DISTRIBUTION_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    BYTES_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_RATIO_FIELD_NUMBER: _ClassVar[int]
    DATA_SIZE_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    update_id: str
    client_id: str
    download_url: str
    utility_score: float
    label_distribution: _common_pb2.LabelDistribution
    sha256: str
    bytes: int
    compression_ratio: float
    data_size: int
    compression_level: _common_pb2.CompressionLevel
    def __init__(self, update_id: _Optional[str] = ..., client_id: _Optional[str] = ..., download_url: _Optional[str] = ..., utility_score: _Optional[float] = ..., label_distribution: _Optional[_Union[_common_pb2.LabelDistribution, _Mapping]] = ..., sha256: _Optional[str] = ..., bytes: _Optional[int] = ..., compression_ratio: _Optional[float] = ..., data_size: _Optional[int] = ..., compression_level: _Optional[_Union[_common_pb2.CompressionLevel, str]] = ...) -> None: ...

class PushModelRequest(_message.Message):
    __slots__ = ("round_id", "model_version", "weights_url", "metrics")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    WEIGHTS_URL_FIELD_NUMBER: _ClassVar[int]
    METRICS_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    model_version: int
    weights_url: str
    metrics: ModelMetrics
    def __init__(self, round_id: _Optional[str] = ..., model_version: _Optional[int] = ..., weights_url: _Optional[str] = ..., metrics: _Optional[_Union[ModelMetrics, _Mapping]] = ...) -> None: ...

class PushModelResponse(_message.Message):
    __slots__ = ("stored", "model_id")
    STORED_FIELD_NUMBER: _ClassVar[int]
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    stored: bool
    model_id: str
    def __init__(self, stored: _Optional[bool] = ..., model_id: _Optional[str] = ...) -> None: ...

class FlStatusResponse(_message.Message):
    __slots__ = ("status", "version", "last_round_id", "uptime_ms")
    STATUS_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    LAST_ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    UPTIME_MS_FIELD_NUMBER: _ClassVar[int]
    status: str
    version: str
    last_round_id: str
    uptime_ms: int
    def __init__(self, status: _Optional[str] = ..., version: _Optional[str] = ..., last_round_id: _Optional[str] = ..., uptime_ms: _Optional[int] = ...) -> None: ...

class ComputeUtilityRequest(_message.Message):
    __slots__ = ("round_id", "update_ids")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    UPDATE_IDS_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    update_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, round_id: _Optional[str] = ..., update_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class UtilityResult(_message.Message):
    __slots__ = ("update_id", "utility_score", "compression_level")
    UPDATE_ID_FIELD_NUMBER: _ClassVar[int]
    UTILITY_SCORE_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    update_id: str
    utility_score: float
    compression_level: _common_pb2.CompressionLevel
    def __init__(self, update_id: _Optional[str] = ..., utility_score: _Optional[float] = ..., compression_level: _Optional[_Union[_common_pb2.CompressionLevel, str]] = ...) -> None: ...

class FlConfigResponse(_message.Message):
    __slots__ = ("mu", "utility_threshold_high", "utility_threshold_low", "compression_ratio", "min_clients", "local_epochs", "batch_size", "utility", "max_clients")
    MU_FIELD_NUMBER: _ClassVar[int]
    UTILITY_THRESHOLD_HIGH_FIELD_NUMBER: _ClassVar[int]
    UTILITY_THRESHOLD_LOW_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_RATIO_FIELD_NUMBER: _ClassVar[int]
    MIN_CLIENTS_FIELD_NUMBER: _ClassVar[int]
    LOCAL_EPOCHS_FIELD_NUMBER: _ClassVar[int]
    BATCH_SIZE_FIELD_NUMBER: _ClassVar[int]
    UTILITY_FIELD_NUMBER: _ClassVar[int]
    MAX_CLIENTS_FIELD_NUMBER: _ClassVar[int]
    mu: float
    utility_threshold_high: float
    utility_threshold_low: float
    compression_ratio: float
    min_clients: int
    local_epochs: int
    batch_size: int
    utility: _common_pb2.UtilityConfig
    max_clients: int
    def __init__(self, mu: _Optional[float] = ..., utility_threshold_high: _Optional[float] = ..., utility_threshold_low: _Optional[float] = ..., compression_ratio: _Optional[float] = ..., min_clients: _Optional[int] = ..., local_epochs: _Optional[int] = ..., batch_size: _Optional[int] = ..., utility: _Optional[_Union[_common_pb2.UtilityConfig, _Mapping]] = ..., max_clients: _Optional[int] = ...) -> None: ...

class WatchRoundsRequest(_message.Message):
    __slots__ = ("worker_id",)
    WORKER_ID_FIELD_NUMBER: _ClassVar[int]
    worker_id: str
    def __init__(self, worker_id: _Optional[str] = ...) -> None: ...

class RoundReadyEvent(_message.Message):
    __slots__ = ("round_id", "round_number", "reason", "update_count", "model_version_before", "ready_at")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    ROUND_NUMBER_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    UPDATE_COUNT_FIELD_NUMBER: _ClassVar[int]
    MODEL_VERSION_BEFORE_FIELD_NUMBER: _ClassVar[int]
    READY_AT_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    round_number: int
    reason: _common_pb2.RoundReadyReason
    update_count: int
    model_version_before: int
    ready_at: str
    def __init__(self, round_id: _Optional[str] = ..., round_number: _Optional[int] = ..., reason: _Optional[_Union[_common_pb2.RoundReadyReason, str]] = ..., update_count: _Optional[int] = ..., model_version_before: _Optional[int] = ..., ready_at: _Optional[str] = ...) -> None: ...

class ModelUploadUrlRequest(_message.Message):
    __slots__ = ("model_version",)
    MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    model_version: int
    def __init__(self, model_version: _Optional[int] = ...) -> None: ...

class ModelUploadUrlResponse(_message.Message):
    __slots__ = ("upload", "resource_path")
    UPLOAD_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_PATH_FIELD_NUMBER: _ClassVar[int]
    upload: _common_pb2.SignedUrl
    resource_path: str
    def __init__(self, upload: _Optional[_Union[_common_pb2.SignedUrl, _Mapping]] = ..., resource_path: _Optional[str] = ...) -> None: ...

class FlStatusReport(_message.Message):
    __slots__ = ("worker_id", "state", "current_round_id", "version", "message", "last_error")
    WORKER_ID_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    CURRENT_ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    LAST_ERROR_FIELD_NUMBER: _ClassVar[int]
    worker_id: str
    state: _common_pb2.FlServerState
    current_round_id: str
    version: str
    message: str
    last_error: str
    def __init__(self, worker_id: _Optional[str] = ..., state: _Optional[_Union[_common_pb2.FlServerState, str]] = ..., current_round_id: _Optional[str] = ..., version: _Optional[str] = ..., message: _Optional[str] = ..., last_error: _Optional[str] = ...) -> None: ...

class FlStatusReportAck(_message.Message):
    __slots__ = ("accepted", "server_time")
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    SERVER_TIME_FIELD_NUMBER: _ClassVar[int]
    accepted: bool
    server_time: str
    def __init__(self, accepted: _Optional[bool] = ..., server_time: _Optional[str] = ...) -> None: ...

class ModelDownloadUrlRequest(_message.Message):
    __slots__ = ("model_version",)
    MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    model_version: int
    def __init__(self, model_version: _Optional[int] = ...) -> None: ...

class ModelDownloadUrlResponse(_message.Message):
    __slots__ = ("download_url", "model_version", "sha256", "size_bytes", "expires_at", "refresh_until", "round_id")
    DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    REFRESH_UNTIL_FIELD_NUMBER: _ClassVar[int]
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    download_url: str
    model_version: int
    sha256: str
    size_bytes: int
    expires_at: str
    refresh_until: str
    round_id: str
    def __init__(self, download_url: _Optional[str] = ..., model_version: _Optional[int] = ..., sha256: _Optional[str] = ..., size_bytes: _Optional[int] = ..., expires_at: _Optional[str] = ..., refresh_until: _Optional[str] = ..., round_id: _Optional[str] = ...) -> None: ...

class FailRoundRequest(_message.Message):
    __slots__ = ("round_id", "reason", "rejection_reasons")
    class RejectionReasonsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    REJECTION_REASONS_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    reason: str
    rejection_reasons: _containers.ScalarMap[str, str]
    def __init__(self, round_id: _Optional[str] = ..., reason: _Optional[str] = ..., rejection_reasons: _Optional[_Mapping[str, str]] = ...) -> None: ...

class FailRoundResponse(_message.Message):
    __slots__ = ("failed",)
    FAILED_FIELD_NUMBER: _ClassVar[int]
    failed: bool
    def __init__(self, failed: _Optional[bool] = ...) -> None: ...
