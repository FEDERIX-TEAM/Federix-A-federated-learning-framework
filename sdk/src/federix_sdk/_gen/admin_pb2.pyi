from . import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OverviewResponse(_message.Message):
    __slots__ = ("total_clients", "active_clients", "current_round_id", "current_round_status", "latest_model_version", "health")
    TOTAL_CLIENTS_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_CLIENTS_FIELD_NUMBER: _ClassVar[int]
    CURRENT_ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    CURRENT_ROUND_STATUS_FIELD_NUMBER: _ClassVar[int]
    LATEST_MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    HEALTH_FIELD_NUMBER: _ClassVar[int]
    total_clients: int
    active_clients: int
    current_round_id: str
    current_round_status: str
    latest_model_version: int
    health: str
    def __init__(self, total_clients: _Optional[int] = ..., active_clients: _Optional[int] = ..., current_round_id: _Optional[str] = ..., current_round_status: _Optional[str] = ..., latest_model_version: _Optional[int] = ..., health: _Optional[str] = ...) -> None: ...

class ListClientsRequest(_message.Message):
    __slots__ = ("page", "limit", "status", "sort_by")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    SORT_BY_FIELD_NUMBER: _ClassVar[int]
    page: int
    limit: int
    status: str
    sort_by: str
    def __init__(self, page: _Optional[int] = ..., limit: _Optional[int] = ..., status: _Optional[str] = ..., sort_by: _Optional[str] = ...) -> None: ...

class ClientSummary(_message.Message):
    __slots__ = ("client_id", "name", "status", "last_seen", "rounds_participated", "utility_avg")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    LAST_SEEN_FIELD_NUMBER: _ClassVar[int]
    ROUNDS_PARTICIPATED_FIELD_NUMBER: _ClassVar[int]
    UTILITY_AVG_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    name: str
    status: str
    last_seen: str
    rounds_participated: int
    utility_avg: float
    def __init__(self, client_id: _Optional[str] = ..., name: _Optional[str] = ..., status: _Optional[str] = ..., last_seen: _Optional[str] = ..., rounds_participated: _Optional[int] = ..., utility_avg: _Optional[float] = ...) -> None: ...

class ClientIdRequest(_message.Message):
    __slots__ = ("client_id",)
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    def __init__(self, client_id: _Optional[str] = ...) -> None: ...

class ClientHistoryEntry(_message.Message):
    __slots__ = ("round_id", "status", "submitted_at")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    SUBMITTED_AT_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    status: str
    submitted_at: str
    def __init__(self, round_id: _Optional[str] = ..., status: _Optional[str] = ..., submitted_at: _Optional[str] = ...) -> None: ...

class ClientUtilityEntry(_message.Message):
    __slots__ = ("round_id", "score")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    score: float
    def __init__(self, round_id: _Optional[str] = ..., score: _Optional[float] = ...) -> None: ...

class ClientDetailResponse(_message.Message):
    __slots__ = ("client_id", "name", "history", "utility_scores", "label_entropy_avg")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    HISTORY_FIELD_NUMBER: _ClassVar[int]
    UTILITY_SCORES_FIELD_NUMBER: _ClassVar[int]
    LABEL_ENTROPY_AVG_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    name: str
    history: _containers.RepeatedCompositeFieldContainer[ClientHistoryEntry]
    utility_scores: _containers.RepeatedCompositeFieldContainer[ClientUtilityEntry]
    label_entropy_avg: float
    def __init__(self, client_id: _Optional[str] = ..., name: _Optional[str] = ..., history: _Optional[_Iterable[_Union[ClientHistoryEntry, _Mapping]]] = ..., utility_scores: _Optional[_Iterable[_Union[ClientUtilityEntry, _Mapping]]] = ..., label_entropy_avg: _Optional[float] = ...) -> None: ...

class BanClientRequest(_message.Message):
    __slots__ = ("client_id", "reason", "duration_hours")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    DURATION_HOURS_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    reason: str
    duration_hours: int
    def __init__(self, client_id: _Optional[str] = ..., reason: _Optional[str] = ..., duration_hours: _Optional[int] = ...) -> None: ...

class BanClientResponse(_message.Message):
    __slots__ = ("success", "banned_until")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    BANNED_UNTIL_FIELD_NUMBER: _ClassVar[int]
    success: bool
    banned_until: str
    def __init__(self, success: _Optional[bool] = ..., banned_until: _Optional[str] = ...) -> None: ...

class UnbanClientResponse(_message.Message):
    __slots__ = ("success", "client_status")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    CLIENT_STATUS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    client_status: str
    def __init__(self, success: _Optional[bool] = ..., client_status: _Optional[str] = ...) -> None: ...

class DeleteClientResponse(_message.Message):
    __slots__ = ("deleted", "purged_records")
    DELETED_FIELD_NUMBER: _ClassVar[int]
    PURGED_RECORDS_FIELD_NUMBER: _ClassVar[int]
    deleted: bool
    purged_records: int
    def __init__(self, deleted: _Optional[bool] = ..., purged_records: _Optional[int] = ...) -> None: ...

class ListRoundsRequest(_message.Message):
    __slots__ = ("page", "limit", "status")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    page: int
    limit: int
    status: str
    def __init__(self, page: _Optional[int] = ..., limit: _Optional[int] = ..., status: _Optional[str] = ...) -> None: ...

class RoundListEntry(_message.Message):
    __slots__ = ("round_id", "round_number", "status", "participant_count", "accuracy", "started_at", "completed_at")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    ROUND_NUMBER_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANT_COUNT_FIELD_NUMBER: _ClassVar[int]
    ACCURACY_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    round_number: int
    status: _common_pb2.RoundStatus
    participant_count: int
    accuracy: float
    started_at: str
    completed_at: str
    def __init__(self, round_id: _Optional[str] = ..., round_number: _Optional[int] = ..., status: _Optional[_Union[_common_pb2.RoundStatus, str]] = ..., participant_count: _Optional[int] = ..., accuracy: _Optional[float] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ...) -> None: ...

class RoundIdRequest(_message.Message):
    __slots__ = ("round_id",)
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    def __init__(self, round_id: _Optional[str] = ...) -> None: ...

class RoundUpdateSummary(_message.Message):
    __slots__ = ("update_id", "client_id", "status")
    UPDATE_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    update_id: str
    client_id: str
    status: _common_pb2.UpdateStatus
    def __init__(self, update_id: _Optional[str] = ..., client_id: _Optional[str] = ..., status: _Optional[_Union[_common_pb2.UpdateStatus, str]] = ...) -> None: ...

class RoundUtilityEntry(_message.Message):
    __slots__ = ("client_id", "score")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    score: float
    def __init__(self, client_id: _Optional[str] = ..., score: _Optional[float] = ...) -> None: ...

class RoundDetailResponse(_message.Message):
    __slots__ = ("round_id", "updates", "utility_scores", "global_loss", "global_accuracy", "started_at", "completed_at", "status")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    UPDATES_FIELD_NUMBER: _ClassVar[int]
    UTILITY_SCORES_FIELD_NUMBER: _ClassVar[int]
    GLOBAL_LOSS_FIELD_NUMBER: _ClassVar[int]
    GLOBAL_ACCURACY_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    updates: _containers.RepeatedCompositeFieldContainer[RoundUpdateSummary]
    utility_scores: _containers.RepeatedCompositeFieldContainer[RoundUtilityEntry]
    global_loss: float
    global_accuracy: float
    started_at: str
    completed_at: str
    status: _common_pb2.RoundStatus
    def __init__(self, round_id: _Optional[str] = ..., updates: _Optional[_Iterable[_Union[RoundUpdateSummary, _Mapping]]] = ..., utility_scores: _Optional[_Iterable[_Union[RoundUtilityEntry, _Mapping]]] = ..., global_loss: _Optional[float] = ..., global_accuracy: _Optional[float] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., status: _Optional[_Union[_common_pb2.RoundStatus, str]] = ...) -> None: ...

class StartRoundRequest(_message.Message):
    __slots__ = ("max_clients", "deadline_seconds", "notes")
    MAX_CLIENTS_FIELD_NUMBER: _ClassVar[int]
    DEADLINE_SECONDS_FIELD_NUMBER: _ClassVar[int]
    NOTES_FIELD_NUMBER: _ClassVar[int]
    max_clients: int
    deadline_seconds: int
    notes: str
    def __init__(self, max_clients: _Optional[int] = ..., deadline_seconds: _Optional[int] = ..., notes: _Optional[str] = ...) -> None: ...

class StartRoundResponse(_message.Message):
    __slots__ = ("round_id", "round_number", "started_at")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    ROUND_NUMBER_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    round_number: int
    started_at: str
    def __init__(self, round_id: _Optional[str] = ..., round_number: _Optional[int] = ..., started_at: _Optional[str] = ...) -> None: ...

class StopRoundRequest(_message.Message):
    __slots__ = ("round_id", "reason")
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    round_id: str
    reason: str
    def __init__(self, round_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class StopRoundResponse(_message.Message):
    __slots__ = ("success", "round_status")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    ROUND_STATUS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    round_status: _common_pb2.RoundStatus
    def __init__(self, success: _Optional[bool] = ..., round_status: _Optional[_Union[_common_pb2.RoundStatus, str]] = ...) -> None: ...

class AdminUpdateEntry(_message.Message):
    __slots__ = ("update_id", "client_id", "utility_score", "status", "compression_level", "submitted_at")
    UPDATE_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    UTILITY_SCORE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    SUBMITTED_AT_FIELD_NUMBER: _ClassVar[int]
    update_id: str
    client_id: str
    utility_score: float
    status: _common_pb2.UpdateStatus
    compression_level: _common_pb2.CompressionLevel
    submitted_at: str
    def __init__(self, update_id: _Optional[str] = ..., client_id: _Optional[str] = ..., utility_score: _Optional[float] = ..., status: _Optional[_Union[_common_pb2.UpdateStatus, str]] = ..., compression_level: _Optional[_Union[_common_pb2.CompressionLevel, str]] = ..., submitted_at: _Optional[str] = ...) -> None: ...

class MetricsRequest(_message.Message):
    __slots__ = ("last_n_rounds",)
    LAST_N_ROUNDS_FIELD_NUMBER: _ClassVar[int]
    last_n_rounds: int
    def __init__(self, last_n_rounds: _Optional[int] = ...) -> None: ...

class ConvergencePoint(_message.Message):
    __slots__ = ("round_number", "global_loss", "global_accuracy", "delta_loss")
    ROUND_NUMBER_FIELD_NUMBER: _ClassVar[int]
    GLOBAL_LOSS_FIELD_NUMBER: _ClassVar[int]
    GLOBAL_ACCURACY_FIELD_NUMBER: _ClassVar[int]
    DELTA_LOSS_FIELD_NUMBER: _ClassVar[int]
    round_number: int
    global_loss: float
    global_accuracy: float
    delta_loss: float
    def __init__(self, round_number: _Optional[int] = ..., global_loss: _Optional[float] = ..., global_accuracy: _Optional[float] = ..., delta_loss: _Optional[float] = ...) -> None: ...

class ClientMetricsRequest(_message.Message):
    __slots__ = ("client_id", "last_n_rounds")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    LAST_N_ROUNDS_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    last_n_rounds: int
    def __init__(self, client_id: _Optional[str] = ..., last_n_rounds: _Optional[int] = ...) -> None: ...

class ClientMetricEntry(_message.Message):
    __slots__ = ("client_id", "round_scores", "avg_utility")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    ROUND_SCORES_FIELD_NUMBER: _ClassVar[int]
    AVG_UTILITY_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    round_scores: _containers.RepeatedCompositeFieldContainer[RoundUtilityEntry]
    avg_utility: float
    def __init__(self, client_id: _Optional[str] = ..., round_scores: _Optional[_Iterable[_Union[RoundUtilityEntry, _Mapping]]] = ..., avg_utility: _Optional[float] = ...) -> None: ...

class CommunicationPoint(_message.Message):
    __slots__ = ("round_number", "bytes_received", "bytes_saved", "full_count", "compressed_count", "skipped_count", "bytes_measured")
    ROUND_NUMBER_FIELD_NUMBER: _ClassVar[int]
    BYTES_RECEIVED_FIELD_NUMBER: _ClassVar[int]
    BYTES_SAVED_FIELD_NUMBER: _ClassVar[int]
    FULL_COUNT_FIELD_NUMBER: _ClassVar[int]
    COMPRESSED_COUNT_FIELD_NUMBER: _ClassVar[int]
    SKIPPED_COUNT_FIELD_NUMBER: _ClassVar[int]
    BYTES_MEASURED_FIELD_NUMBER: _ClassVar[int]
    round_number: int
    bytes_received: int
    bytes_saved: int
    full_count: int
    compressed_count: int
    skipped_count: int
    bytes_measured: int
    def __init__(self, round_number: _Optional[int] = ..., bytes_received: _Optional[int] = ..., bytes_saved: _Optional[int] = ..., full_count: _Optional[int] = ..., compressed_count: _Optional[int] = ..., skipped_count: _Optional[int] = ..., bytes_measured: _Optional[int] = ...) -> None: ...

class FairnessPoint(_message.Message):
    __slots__ = ("round_number", "minority_participation_rate", "gini_coefficient", "utility_distribution")
    ROUND_NUMBER_FIELD_NUMBER: _ClassVar[int]
    MINORITY_PARTICIPATION_RATE_FIELD_NUMBER: _ClassVar[int]
    GINI_COEFFICIENT_FIELD_NUMBER: _ClassVar[int]
    UTILITY_DISTRIBUTION_FIELD_NUMBER: _ClassVar[int]
    round_number: int
    minority_participation_rate: float
    gini_coefficient: float
    utility_distribution: _containers.RepeatedScalarFieldContainer[float]
    def __init__(self, round_number: _Optional[int] = ..., minority_participation_rate: _Optional[float] = ..., gini_coefficient: _Optional[float] = ..., utility_distribution: _Optional[_Iterable[float]] = ...) -> None: ...

class ConfigResponse(_message.Message):
    __slots__ = ("mu", "min_clients_per_round", "max_round_duration_seconds", "utility_threshold_high", "utility_threshold_low", "compression_ratio", "max_clients_per_round", "local_epochs", "batch_size", "utility")
    MU_FIELD_NUMBER: _ClassVar[int]
    MIN_CLIENTS_PER_ROUND_FIELD_NUMBER: _ClassVar[int]
    MAX_ROUND_DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    UTILITY_THRESHOLD_HIGH_FIELD_NUMBER: _ClassVar[int]
    UTILITY_THRESHOLD_LOW_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_RATIO_FIELD_NUMBER: _ClassVar[int]
    MAX_CLIENTS_PER_ROUND_FIELD_NUMBER: _ClassVar[int]
    LOCAL_EPOCHS_FIELD_NUMBER: _ClassVar[int]
    BATCH_SIZE_FIELD_NUMBER: _ClassVar[int]
    UTILITY_FIELD_NUMBER: _ClassVar[int]
    mu: float
    min_clients_per_round: int
    max_round_duration_seconds: int
    utility_threshold_high: float
    utility_threshold_low: float
    compression_ratio: float
    max_clients_per_round: int
    local_epochs: int
    batch_size: int
    utility: _common_pb2.UtilityConfig
    def __init__(self, mu: _Optional[float] = ..., min_clients_per_round: _Optional[int] = ..., max_round_duration_seconds: _Optional[int] = ..., utility_threshold_high: _Optional[float] = ..., utility_threshold_low: _Optional[float] = ..., compression_ratio: _Optional[float] = ..., max_clients_per_round: _Optional[int] = ..., local_epochs: _Optional[int] = ..., batch_size: _Optional[int] = ..., utility: _Optional[_Union[_common_pb2.UtilityConfig, _Mapping]] = ...) -> None: ...

class UpdateConfigRequest(_message.Message):
    __slots__ = ("mu", "min_clients_per_round", "max_clients_per_round", "max_round_duration_seconds", "utility_threshold_high", "utility_threshold_low", "compression_ratio", "local_epochs", "batch_size", "utility")
    MU_FIELD_NUMBER: _ClassVar[int]
    MIN_CLIENTS_PER_ROUND_FIELD_NUMBER: _ClassVar[int]
    MAX_CLIENTS_PER_ROUND_FIELD_NUMBER: _ClassVar[int]
    MAX_ROUND_DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    UTILITY_THRESHOLD_HIGH_FIELD_NUMBER: _ClassVar[int]
    UTILITY_THRESHOLD_LOW_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_RATIO_FIELD_NUMBER: _ClassVar[int]
    LOCAL_EPOCHS_FIELD_NUMBER: _ClassVar[int]
    BATCH_SIZE_FIELD_NUMBER: _ClassVar[int]
    UTILITY_FIELD_NUMBER: _ClassVar[int]
    mu: float
    min_clients_per_round: int
    max_clients_per_round: int
    max_round_duration_seconds: int
    utility_threshold_high: float
    utility_threshold_low: float
    compression_ratio: float
    local_epochs: int
    batch_size: int
    utility: _common_pb2.UtilityConfigUpdate
    def __init__(self, mu: _Optional[float] = ..., min_clients_per_round: _Optional[int] = ..., max_clients_per_round: _Optional[int] = ..., max_round_duration_seconds: _Optional[int] = ..., utility_threshold_high: _Optional[float] = ..., utility_threshold_low: _Optional[float] = ..., compression_ratio: _Optional[float] = ..., local_epochs: _Optional[int] = ..., batch_size: _Optional[int] = ..., utility: _Optional[_Union[_common_pb2.UtilityConfigUpdate, _Mapping]] = ...) -> None: ...

class UpdateConfigResponse(_message.Message):
    __slots__ = ("updated_config", "effective_from_round")
    UPDATED_CONFIG_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_FROM_ROUND_FIELD_NUMBER: _ClassVar[int]
    updated_config: ConfigResponse
    effective_from_round: int
    def __init__(self, updated_config: _Optional[_Union[ConfigResponse, _Mapping]] = ..., effective_from_round: _Optional[int] = ...) -> None: ...

class ConfigHistoryEntry(_message.Message):
    __slots__ = ("changed_at", "changed_by", "diff_json", "round_number_applied")
    CHANGED_AT_FIELD_NUMBER: _ClassVar[int]
    CHANGED_BY_FIELD_NUMBER: _ClassVar[int]
    DIFF_JSON_FIELD_NUMBER: _ClassVar[int]
    ROUND_NUMBER_APPLIED_FIELD_NUMBER: _ClassVar[int]
    changed_at: str
    changed_by: str
    diff_json: str
    round_number_applied: int
    def __init__(self, changed_at: _Optional[str] = ..., changed_by: _Optional[str] = ..., diff_json: _Optional[str] = ..., round_number_applied: _Optional[int] = ...) -> None: ...

class ModelEntry(_message.Message):
    __slots__ = ("model_id", "model_version", "round_id", "accuracy", "size_bytes", "created_at", "sha256", "format")
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    ACCURACY_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    FORMAT_FIELD_NUMBER: _ClassVar[int]
    model_id: str
    model_version: int
    round_id: str
    accuracy: float
    size_bytes: int
    created_at: str
    sha256: str
    format: str
    def __init__(self, model_id: _Optional[str] = ..., model_version: _Optional[int] = ..., round_id: _Optional[str] = ..., accuracy: _Optional[float] = ..., size_bytes: _Optional[int] = ..., created_at: _Optional[str] = ..., sha256: _Optional[str] = ..., format: _Optional[str] = ...) -> None: ...

class ModelIdRequest(_message.Message):
    __slots__ = ("model_id",)
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    model_id: str
    def __init__(self, model_id: _Optional[str] = ...) -> None: ...

class AdminModelDownloadResponse(_message.Message):
    __slots__ = ("download_url", "expires_at", "model_version")
    DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    MODEL_VERSION_FIELD_NUMBER: _ClassVar[int]
    download_url: str
    expires_at: str
    model_version: int
    def __init__(self, download_url: _Optional[str] = ..., expires_at: _Optional[str] = ..., model_version: _Optional[int] = ...) -> None: ...

class DeleteModelResponse(_message.Message):
    __slots__ = ("deleted",)
    DELETED_FIELD_NUMBER: _ClassVar[int]
    deleted: bool
    def __init__(self, deleted: _Optional[bool] = ...) -> None: ...

class LogsRequest(_message.Message):
    __slots__ = ("level", "actor", "event_type", "from_date", "to_date", "limit")
    LEVEL_FIELD_NUMBER: _ClassVar[int]
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    FROM_DATE_FIELD_NUMBER: _ClassVar[int]
    TO_DATE_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    level: str
    actor: str
    event_type: str
    from_date: str
    to_date: str
    limit: int
    def __init__(self, level: _Optional[str] = ..., actor: _Optional[str] = ..., event_type: _Optional[str] = ..., from_date: _Optional[str] = ..., to_date: _Optional[str] = ..., limit: _Optional[int] = ...) -> None: ...

class LogEntry(_message.Message):
    __slots__ = ("timestamp", "level", "actor", "event_type", "details_json")
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    LEVEL_FIELD_NUMBER: _ClassVar[int]
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    DETAILS_JSON_FIELD_NUMBER: _ClassVar[int]
    timestamp: str
    level: str
    actor: str
    event_type: str
    details_json: str
    def __init__(self, timestamp: _Optional[str] = ..., level: _Optional[str] = ..., actor: _Optional[str] = ..., event_type: _Optional[str] = ..., details_json: _Optional[str] = ...) -> None: ...

class AdminUserEntry(_message.Message):
    __slots__ = ("user_id", "name", "email", "role", "created_at", "last_login")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_LOGIN_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    name: str
    email: str
    role: _common_pb2.Role
    created_at: str
    last_login: str
    def __init__(self, user_id: _Optional[str] = ..., name: _Optional[str] = ..., email: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.Role, str]] = ..., created_at: _Optional[str] = ..., last_login: _Optional[str] = ...) -> None: ...

class UpdateUserRoleRequest(_message.Message):
    __slots__ = ("user_id", "role")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    role: _common_pb2.Role
    def __init__(self, user_id: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.Role, str]] = ...) -> None: ...

class UpdateUserRoleResponse(_message.Message):
    __slots__ = ("user_id", "new_role")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    NEW_ROLE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    new_role: _common_pb2.Role
    def __init__(self, user_id: _Optional[str] = ..., new_role: _Optional[_Union[_common_pb2.Role, str]] = ...) -> None: ...

class UserIdRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class DeleteUserResponse(_message.Message):
    __slots__ = ("deleted",)
    DELETED_FIELD_NUMBER: _ClassVar[int]
    deleted: bool
    def __init__(self, deleted: _Optional[bool] = ...) -> None: ...

class FlServerStatusResponse(_message.Message):
    __slots__ = ("online", "state", "worker_id", "current_round_id", "version", "message", "last_error", "last_report_at")
    ONLINE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    WORKER_ID_FIELD_NUMBER: _ClassVar[int]
    CURRENT_ROUND_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    LAST_ERROR_FIELD_NUMBER: _ClassVar[int]
    LAST_REPORT_AT_FIELD_NUMBER: _ClassVar[int]
    online: bool
    state: _common_pb2.FlServerState
    worker_id: str
    current_round_id: str
    version: str
    message: str
    last_error: str
    last_report_at: str
    def __init__(self, online: _Optional[bool] = ..., state: _Optional[_Union[_common_pb2.FlServerState, str]] = ..., worker_id: _Optional[str] = ..., current_round_id: _Optional[str] = ..., version: _Optional[str] = ..., message: _Optional[str] = ..., last_error: _Optional[str] = ..., last_report_at: _Optional[str] = ...) -> None: ...

class CreateEnrollmentTokenRequest(_message.Message):
    __slots__ = ("label", "max_uses", "ttl_hours")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    MAX_USES_FIELD_NUMBER: _ClassVar[int]
    TTL_HOURS_FIELD_NUMBER: _ClassVar[int]
    label: str
    max_uses: int
    ttl_hours: int
    def __init__(self, label: _Optional[str] = ..., max_uses: _Optional[int] = ..., ttl_hours: _Optional[int] = ...) -> None: ...

class CreateEnrollmentTokenResponse(_message.Message):
    __slots__ = ("token_id", "token", "label", "max_uses", "expires_at")
    TOKEN_ID_FIELD_NUMBER: _ClassVar[int]
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    MAX_USES_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    token_id: str
    token: str
    label: str
    max_uses: int
    expires_at: str
    def __init__(self, token_id: _Optional[str] = ..., token: _Optional[str] = ..., label: _Optional[str] = ..., max_uses: _Optional[int] = ..., expires_at: _Optional[str] = ...) -> None: ...

class ListEnrollmentTokensRequest(_message.Message):
    __slots__ = ("include_inactive",)
    INCLUDE_INACTIVE_FIELD_NUMBER: _ClassVar[int]
    include_inactive: bool
    def __init__(self, include_inactive: _Optional[bool] = ...) -> None: ...

class EnrollmentTokenEntry(_message.Message):
    __slots__ = ("token_id", "label", "max_uses", "uses", "expires_at", "revoked", "active", "created_by", "created_at", "last_used_at")
    TOKEN_ID_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    MAX_USES_FIELD_NUMBER: _ClassVar[int]
    USES_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    REVOKED_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_USED_AT_FIELD_NUMBER: _ClassVar[int]
    token_id: str
    label: str
    max_uses: int
    uses: int
    expires_at: str
    revoked: bool
    active: bool
    created_by: str
    created_at: str
    last_used_at: str
    def __init__(self, token_id: _Optional[str] = ..., label: _Optional[str] = ..., max_uses: _Optional[int] = ..., uses: _Optional[int] = ..., expires_at: _Optional[str] = ..., revoked: _Optional[bool] = ..., active: _Optional[bool] = ..., created_by: _Optional[str] = ..., created_at: _Optional[str] = ..., last_used_at: _Optional[str] = ...) -> None: ...

class EnrollmentTokenIdRequest(_message.Message):
    __slots__ = ("token_id",)
    TOKEN_ID_FIELD_NUMBER: _ClassVar[int]
    token_id: str
    def __init__(self, token_id: _Optional[str] = ...) -> None: ...

class RevokeEnrollmentTokenResponse(_message.Message):
    __slots__ = ("revoked",)
    REVOKED_FIELD_NUMBER: _ClassVar[int]
    revoked: bool
    def __init__(self, revoked: _Optional[bool] = ...) -> None: ...
