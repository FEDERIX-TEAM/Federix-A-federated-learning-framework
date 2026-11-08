import json
import struct

import httpx

from federix_sdk.errors import Code, ConnectError

ENVELOPE = struct.Struct(">BI")
FLAG_COMPRESSED = 0x01
FLAG_END_STREAM = 0x02


def _error_from_json(body, status):
    try:
        data = json.loads(body or b"{}")
    except ValueError:
        return ConnectError.from_http_status(status)
    error = data.get("error", data) if isinstance(data, dict) else {}
    if not isinstance(error, dict) or "code" not in error:
        return ConnectError.from_http_status(status)
    return ConnectError(error.get("code"), error.get("message", ""), http_status=status, metadata=data.get("metadata", {}))


class Transport:
    def __init__(self, base_url, timeout=30.0, connect_timeout=10.0, http_client=None):
        self.base_url = base_url.rstrip("/")
        self._owns_client = http_client is None
        self._client = http_client or httpx.Client(timeout=httpx.Timeout(timeout, connect=connect_timeout))

    def close(self):
        if self._owns_client:
            self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _url(self, service, method):
        return f"{self.base_url}/{service}/{method}"

    @staticmethod
    def _headers(content_type, headers, timeout):
        h = {"content-type": content_type, "connect-protocol-version": "1", **(headers or {})}
        if timeout is not None:
            h["connect-timeout-ms"] = str(max(1, int(timeout * 1000)))
        return h

    def unary(self, service, method, request, response_type, headers=None, timeout=None):
        try:
            res = self._client.post(
                self._url(service, method),
                content=request.SerializeToString(),
                headers=self._headers("application/proto", headers, timeout),
                timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
            )
        except httpx.TimeoutException as err:
            raise ConnectError(Code.DEADLINE_EXCEEDED, f"{service}/{method} timed out") from err
        except httpx.TransportError as err:
            raise ConnectError(Code.UNAVAILABLE, f"could not reach {self.base_url}: {err}") from err

        content_type = res.headers.get("content-type", "")
        if res.status_code == 200 and content_type.startswith("application/proto"):
            out = response_type()
            out.ParseFromString(res.content)
            return out
        if content_type.startswith("application/json"):
            raise _error_from_json(res.content, res.status_code)
        raise ConnectError.from_http_status(res.status_code, f"unexpected response ({content_type or 'no content type'})")

    def server_stream(self, service, method, request, response_type, headers=None, timeout=None):
        body = request.SerializeToString()
        payload = ENVELOPE.pack(0, len(body)) + body
        try:
            with self._client.stream(
                "POST",
                self._url(service, method),
                content=payload,
                headers=self._headers("application/connect+proto", headers, timeout),
                timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
            ) as res:
                content_type = res.headers.get("content-type", "")
                if res.status_code != 200 or not content_type.startswith("application/connect+proto"):
                    raw = res.read()
                    if content_type.startswith("application/json"):
                        raise _error_from_json(raw, res.status_code)
                    raise ConnectError.from_http_status(res.status_code, f"unexpected response ({content_type or 'no content type'})")
                yield from self._read_envelopes(res, response_type)
        except httpx.TimeoutException as err:
            raise ConnectError(Code.DEADLINE_EXCEEDED, f"{service}/{method} timed out") from err
        except httpx.TransportError as err:
            raise ConnectError(Code.UNAVAILABLE, f"stream to {self.base_url} failed: {err}") from err

    @staticmethod
    def _read_envelopes(res, response_type):
        buf = b""
        ended = False
        for chunk in res.iter_bytes():
            buf += chunk
            while len(buf) >= ENVELOPE.size:
                flags, length = ENVELOPE.unpack_from(buf)
                if len(buf) < ENVELOPE.size + length:
                    break
                data = buf[ENVELOPE.size:ENVELOPE.size + length]
                buf = buf[ENVELOPE.size + length:]
                if flags & FLAG_COMPRESSED:
                    raise ConnectError(Code.INTERNAL, "compressed stream messages are not supported")
                if flags & FLAG_END_STREAM:
                    end = json.loads(data or b"{}")
                    if isinstance(end, dict) and end.get("error"):
                        err = end["error"]
                        raise ConnectError(err.get("code", "unknown"), err.get("message", ""), metadata=end.get("metadata", {}))
                    ended = True
                    break
                msg = response_type()
                msg.ParseFromString(data)
                yield msg
            if ended:
                return
        if not ended:
            raise ConnectError(Code.UNAVAILABLE, "stream ended without an end-of-stream message")
