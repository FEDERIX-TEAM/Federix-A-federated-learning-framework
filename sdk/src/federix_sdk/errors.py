from enum import Enum


class Code(str, Enum):
    CANCELED = "canceled"
    UNKNOWN = "unknown"
    INVALID_ARGUMENT = "invalid_argument"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    NOT_FOUND = "not_found"
    ALREADY_EXISTS = "already_exists"
    PERMISSION_DENIED = "permission_denied"
    RESOURCE_EXHAUSTED = "resource_exhausted"
    FAILED_PRECONDITION = "failed_precondition"
    ABORTED = "aborted"
    OUT_OF_RANGE = "out_of_range"
    UNIMPLEMENTED = "unimplemented"
    INTERNAL = "internal"
    UNAVAILABLE = "unavailable"
    DATA_LOSS = "data_loss"
    UNAUTHENTICATED = "unauthenticated"

    @classmethod
    def parse(cls, value):
        try:
            return cls(value)
        except ValueError:
            return cls.UNKNOWN


HTTP_TO_CODE = {
    400: Code.INTERNAL,
    401: Code.UNAUTHENTICATED,
    403: Code.PERMISSION_DENIED,
    404: Code.UNIMPLEMENTED,
    429: Code.UNAVAILABLE,
    502: Code.UNAVAILABLE,
    503: Code.UNAVAILABLE,
    504: Code.UNAVAILABLE,
}


class ConnectError(Exception):
    def __init__(self, code, message="", http_status=None, metadata=None):
        self.code = code if isinstance(code, Code) else Code.parse(code)
        self.message = message
        self.http_status = http_status
        self.metadata = metadata or {}
        super().__init__(f"[{self.code.value}] {message}" if message else f"[{self.code.value}]")

    @classmethod
    def from_http_status(cls, status, message=""):
        return cls(HTTP_TO_CODE.get(status, Code.UNKNOWN), message or f"HTTP {status}", http_status=status)
