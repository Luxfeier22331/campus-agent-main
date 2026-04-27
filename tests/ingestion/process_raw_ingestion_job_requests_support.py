from __future__ import annotations

from .process_raw_ingestion_job_base_support import *


class _FakeRequestsResponse:
    def __init__(
        self,
        *,
        status_code: int,
        json_payload: object | None = None,
        content: bytes = b"",
        text: str = "",
    ) -> None:
        self.status_code = status_code
        self._json_payload = json_payload
        self.content = content
        self.text = text

    def json(self) -> object:
        if self._json_payload is None:
            raise ValueError("json payload not configured")
        return self._json_payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")

    def iter_content(self, chunk_size: int = 1024 * 1024):  # type: ignore[no-untyped-def]
        del chunk_size
        if self.content:
            yield self.content


class _SequencedRequestsModule:
    def __init__(self) -> None:
        self.post_calls: list[tuple[str, dict[str, str], dict[str, str]]] = []
        self.get_calls: list[str] = []
        self._json_attempts = 0

    def post(self, url: str, *, headers, data, files, timeout):  # type: ignore[no-untyped-def]
        del files, timeout
        self.post_calls.append((url, headers, data))
        return _FakeRequestsResponse(
            status_code=200,
            json_payload={"data": {"jobId": "job-1"}},
        )

    def get(self, url: str, *, headers=None, timeout=None):  # type: ignore[no-untyped-def]
        del headers, timeout
        self.get_calls.append(url)
        if url.endswith("/job-1"):
            return _FakeRequestsResponse(
                status_code=200,
                json_payload={
                    "data": {
                        "jobId": "job-1",
                        "state": "done",
                        "resultUrl": {"jsonUrl": "https://example.test/result.jsonl"},
                    }
                },
            )
        if url == "https://example.test/result.jsonl":
            self._json_attempts += 1
            if self._json_attempts == 1:
                return _FakeRequestsResponse(
                    status_code=404,
                    text='{"code":"NoSuchKey"}',
                )
            return _FakeRequestsResponse(
                status_code=200,
                content=b'{"result":"ok"}\n',
            )
        raise AssertionError(f"unexpected GET url: {url}")


class _AlwaysMissingResultRequestsModule:
    def __init__(self) -> None:
        self.post_calls: list[tuple[str, dict[str, str], dict[str, str]]] = []
        self.get_calls: list[str] = []

    def post(self, url: str, *, headers, data, files, timeout):  # type: ignore[no-untyped-def]
        del files, timeout
        self.post_calls.append((url, headers, data))
        return _FakeRequestsResponse(
            status_code=200,
            json_payload={"data": {"jobId": "job-1"}},
        )

    def get(self, url: str, *, headers=None, timeout=None):  # type: ignore[no-untyped-def]
        del headers, timeout
        self.get_calls.append(url)
        if url.endswith("/job-1"):
            return _FakeRequestsResponse(
                status_code=200,
                json_payload={
                    "traceId": "trace-404",
                    "code": 0,
                    "msg": "Success",
                    "data": {
                        "jobId": "job-1",
                        "state": "done",
                        "resultUrl": {"jsonUrl": "https://example.test/result.jsonl"},
                    },
                },
            )
        if url == "https://example.test/result.jsonl":
            return _FakeRequestsResponse(
                status_code=404,
                text='{"code":"NoSuchKey"}',
            )
        raise AssertionError(f"unexpected GET url: {url}")


class _LayoutParsingServiceRequestsModule:
    def __init__(self) -> None:
        self.post_calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def post(self, url: str, *, headers=None, json=None, timeout=None):  # type: ignore[no-untyped-def]
        del timeout
        self.post_calls.append((url, headers or {}, json or {}))
        return _FakeRequestsResponse(
            status_code=200,
            json_payload={
                "result": {
                    "dataInfo": {"numPages": 1, "type": "image"},
                    "layoutParsingResults": [
                        {
                            "markdown": {
                                "text": "图片附件 OCR 正文 第一行\n图片附件 OCR 正文 第二行"
                            },
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "block_label": "paragraph_title",
                                        "block_content": "图片附件 OCR 正文 第一行",
                                        "block_order": 1,
                                    },
                                    {
                                        "block_label": "text",
                                        "block_content": "图片附件 OCR 正文 第二行",
                                        "block_order": 2,
                                    },
                                ]
                            },
                        }
                    ],
                }
            },
        )


class _MineruRequestsModule:
    def __init__(self) -> None:
        self.post_calls: list[tuple[str, dict[str, str], dict[str, object]]] = []
        self.put_calls: list[tuple[str, bytes]] = []
        self.get_calls: list[str] = []
        self._batch_status_attempts = 0

    def post(self, url: str, *, headers=None, json=None, timeout=None):  # type: ignore[no-untyped-def]
        del timeout
        self.post_calls.append((url, headers or {}, json or {}))
        return _FakeRequestsResponse(
            status_code=200,
            json_payload={
                "code": 0,
                "data": {
                    "batch_id": "batch-001",
                    "file_urls": ["https://upload.example.test/file-001"],
                },
            },
        )

    def put(self, url: str, *, data=None, timeout=None):  # type: ignore[no-untyped-def]
        del timeout
        if isinstance(data, bytes):
            payload = data
        else:
            assert hasattr(data, "read")
            payload = data.read()
        self.put_calls.append((url, payload))
        return _FakeRequestsResponse(status_code=200)

    def get(self, url: str, *, headers=None, timeout=None, stream=None):  # type: ignore[no-untyped-def]
        del headers, timeout, stream
        self.get_calls.append(url)
        if url.endswith("/extract-results/batch/batch-001"):
            self._batch_status_attempts += 1
            state = "running" if self._batch_status_attempts == 1 else "done"
            return _FakeRequestsResponse(
                status_code=200,
                json_payload={
                    "code": 0,
                    "data": {
                        "extract_result": [
                            {
                                "file_name": "sample.pdf",
                                "state": state,
                                "full_zip_url": (
                                    "https://download.example.test/sample.zip"
                                    if state == "done"
                                    else None
                                ),
                            }
                        ]
                    },
                },
            )
        if url == "https://download.example.test/sample.zip":
            return _FakeRequestsResponse(
                status_code=200,
                content=b"PK\x03\x04mineru-archive-bytes",
            )
        raise AssertionError(f"unexpected GET url: {url}")


__all__ = [name for name in globals() if not name.startswith("__")]
