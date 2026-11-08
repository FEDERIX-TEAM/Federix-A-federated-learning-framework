import hashlib
import logging
from urllib.parse import urlsplit

import httpx

log = logging.getLogger("federix_sdk")


class TransferError(Exception):
    pass


def refresh_url(client, url):
    parts = urlsplit(url)
    if not parts.path.startswith("/storage/"):
        raise TransferError(f"cannot refresh a URL outside /storage: {url}")
    endpoint = f"{parts.scheme}://{parts.netloc}/storage/refresh{parts.path[len('/storage'):]}?{parts.query}"
    res = client.post(endpoint)
    if res.status_code == 410:
        raise TransferError("the transfer URL can no longer be refreshed; request a new one")
    if res.status_code != 200:
        raise TransferError(f"refreshing the transfer URL failed with HTTP {res.status_code}: {res.text}")
    return res.json()["url"]


class Transfers:
    def __init__(self, timeout=60.0, retries=5, chunk_size=1024 * 1024, client=None):
        self._owns = client is None
        self.client = client or httpx.Client(timeout=timeout)
        self.retries = retries
        self.chunk_size = chunk_size
        self.refreshes = 0
        self.resumes = 0

    def close(self):
        if self._owns:
            self.client.close()

    def _refresh(self, url):
        self.refreshes += 1
        return refresh_url(self.client, url)

    def download(self, url, partial=b""):
        data = bytearray(partial)
        total = None
        attempts = 0
        while True:
            headers = {"range": f"bytes={len(data)}-"} if data else {}
            try:
                with self.client.stream("GET", url, headers=headers) as res:
                    if res.status_code == 403:
                        url = self._refresh(url)
                        continue
                    if res.status_code == 416 and total is not None and len(data) == total:
                        return bytes(data)
                    if res.status_code not in (200, 206):
                        raise TransferError(f"download failed with HTTP {res.status_code}: {res.read().decode(errors='replace')}")
                    if res.status_code == 200:
                        data.clear()
                        total = int(res.headers.get("content-length", -1))
                    else:
                        total = int(res.headers["content-range"].rsplit("/", 1)[1])
                    for chunk in res.iter_bytes():
                        data.extend(chunk)
                if total in (None, -1) or len(data) >= total:
                    return bytes(data)
            except httpx.TransportError as err:
                attempts += 1
                if attempts > self.retries:
                    raise TransferError(f"download failed after {self.retries} retries: {err}") from err
                self.resumes += 1
                log.warning("download interrupted at %d bytes (%s); resuming", len(data), err)

    def upload_status(self, url):
        res = self.client.head(url)
        if res.status_code == 403:
            return None
        if res.status_code != 200:
            raise TransferError(f"upload status failed with HTTP {res.status_code}")
        return int(res.headers.get("upload-offset", 0)), res.headers.get("upload-complete") == "true"

    def upload(self, url, data):
        total = len(data)
        digest = hashlib.sha256(data).hexdigest()
        attempts = 0
        while True:
            try:
                status = self.upload_status(url)
                if status is None:
                    url = self._refresh(url)
                    continue
                offset, complete = status
                if complete:
                    if offset != total:
                        raise TransferError(f"the server already holds a different file ({offset} bytes)")
                    return {"bytes": total, "sha256": digest, "url": url}
                if offset:
                    self.resumes += 1
                while offset < total:
                    end = min(offset + self.chunk_size, total) - 1
                    res = self.client.put(url, content=data[offset:end + 1], headers={"content-range": f"bytes {offset}-{end}/{total}"})
                    if res.status_code == 403:
                        url = self._refresh(url)
                        break
                    if res.status_code == 409 and "upload-offset" in res.headers:
                        offset = int(res.headers["upload-offset"])
                        continue
                    if res.status_code == 202:
                        offset = int(res.headers["upload-offset"])
                        continue
                    if res.status_code == 201:
                        body = res.json()
                        if body.get("sha256") != digest or body.get("bytes") != total:
                            raise TransferError("the server stored a different file than the one sent")
                        return {"bytes": total, "sha256": digest, "url": url}
                    raise TransferError(f"upload failed with HTTP {res.status_code}: {res.text}")
            except httpx.TransportError as err:
                attempts += 1
                if attempts > self.retries:
                    raise TransferError(f"upload failed after {self.retries} retries: {err}") from err
                log.warning("upload interrupted (%s); resuming", err)

