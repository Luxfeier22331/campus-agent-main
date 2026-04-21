from __future__ import annotations

import hashlib
import json
import types
import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.handbook_cleanup import build_handbook_doc_id
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_processed_artifact_key,
    build_processed_asset_artifact_key,
)
from campus_ingestion_core.process import build_indexable_chunks_from_record
from campus_ingestion_core.raw_ingestion import (
    RawIngestionProcessSettings,
    RawIngestionRequest,
    build_online_ocr_client,
)
from campus_ingestion_core.raw_ingestion_online_ocr import (
    MineruApiClient,
    OnlineOcrProviderContractError,
    OnlineOcrSettings,
    PaddleOcrAsyncClient,
    PaddleOcrLayoutParsingServiceClient,
    parse_online_ocr_bytes,
)
from campus_ingestion_worker.process_raw_ingestion_job import (
    OnlineOcrProviderResult,
)
from campus_ingestion_worker.process_raw_ingestion_job import (
    process_raw_ingestion_job as _process_raw_ingestion_job,
)

from tests.ingestion._handbook_chunking_test_support import build_hermetic_handbook_v3_chunk_profile
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "student_handbook"
SOURCE_BUCKET = "campus-rag-source"
DERIVED_BUCKET = "campus-rag-derived"


def process_raw_ingestion_job(**kwargs):
    env = kwargs.get("env") or {}
    request = kwargs.pop("request", None)
    if request is None:
        request = RawIngestionRequest(
            raw_asset_id=(env.get("RAW_ASSET_ID") or "").strip(),
            raw_version_id=(env.get("RAW_VERSION_ID") or "").strip(),
            corpus=(env.get("INGESTION_CORPUS") or "").strip(),
            collection=(env.get("INGESTION_COLLECTION") or "").strip(),
            artifact_mode=(env.get("RAW_INGESTION_ARTIFACT_MODE") or "normalized").strip()
            or "normalized",
            split_manifest_path=(
                Path(env["INGESTION_SPLIT_MANIFEST_PATH"]).resolve()
                if (env.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
                else None
            ),
            report_dir=Path((env.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
            default_visibility_scope=(
                (
                    env.get("INGESTION_DEFAULT_VISIBILITY_SCOPE")
                    or env.get("INGESTION_DEFAULT_CAMPUS_SCOPE")
                    or ""
                ).strip()
                or None
            ),
        )
    return _process_raw_ingestion_job(request=request, **kwargs)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )
        self.objects[(bucket, key)] = data

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


class _FakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        provider_payload = {
            "result": {
                "dataInfo": {"numPages": 1},
                "layoutParsingResults": [
                    {
                        "markdown": {
                            "text": "remote ocr text",
                            "images": {},
                        }
                    }
                ],
            },
            "logId": "log-001",
        }
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode(
                "utf-8"
            ),
        )


class _VolatileFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.counter = 0

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.counter += 1
        provider_payload = {
            "result": {
                "dataInfo": {"numPages": 1},
                "layoutParsingResults": [
                    {
                        "markdown": {
                            "text": "same normalized text",
                            "images": {},
                        }
                    }
                ],
            },
            "logId": f"log-{self.counter:03d}",
        }
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode(
                "utf-8"
            ),
        )


class _CurriculumPlanFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        provider_lines = [
            {
                "pageNumber": 1,
                "result": {
                    "layoutParsingResults": [
                        {
                            "blockType": "paragraph",
                            "blockId": "p1-body",
                            "readingOrder": 1,
                            "markdown": {"text": "Plan one text"},
                        }
                    ]
                },
                "logId": "log-001",
            },
            {
                "pageNumber": 2,
                "result": {
                    "layoutParsingResults": [
                        {
                            "blockType": "paragraph",
                            "blockId": "p2-body",
                            "readingOrder": 1,
                            "markdown": {"text": "Plan two text"},
                        }
                    ]
                },
                "logId": "log-002",
            },
        ]
        return OnlineOcrProviderResult(
            provider_result_bytes=(
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8"),
        )


class _StudentHandbookNormalizedFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        provider_lines = [
            {
                "result": {
                    "dataInfo": {
                        "numPages": 3,
                        "pages": [
                            {"width": 828, "height": 1151},
                            {"width": 828, "height": 1151},
                            {"width": 828, "height": 1151},
                        ],
                        "type": "pdf",
                    },
                    "layoutParsingResults": [
                        {
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "blockType": "title",
                                        "blockId": "p1-title",
                                        "readingOrder": 1,
                                        "markdown": {"text": "中央民族大学奖学金评定办法"},
                                    },
                                    {
                                        "blockType": "paragraph",
                                        "blockId": "p1-body",
                                        "readingOrder": 2,
                                        "markdown": {
                                            "text": "第一条 奖学金评定坚持公开、公平、公正。"
                                        },
                                    },
                                ]
                            }
                        },
                        {
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "blockType": "paragraph",
                                        "blockId": "p2-body",
                                        "readingOrder": 1,
                                        "markdown": {"text": "第二条 评定程序按照学校通知执行。"},
                                    }
                                ]
                            }
                        },
                        {
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "blockType": "title",
                                        "blockId": "p3-title",
                                        "readingOrder": 1,
                                        "markdown": {"text": "中央民族大学学生违纪处分办法"},
                                    },
                                    {
                                        "blockType": "paragraph",
                                        "blockId": "p3-body",
                                        "readingOrder": 2,
                                        "markdown": {"text": "第一条 学生应当遵守校纪校规。"},
                                    },
                                ]
                            }
                        },
                    ],
                },
                "logId": "log-001",
            }
        ]
        return OnlineOcrProviderResult(
            provider_result_bytes=(
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8"),
        )


class _FixtureOnlineOcrClient:
    def __init__(self, fixture_name: str) -> None:
        self.calls: list[Path] = []
        self.fixture_name = fixture_name

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=(FIXTURE_DIR / self.fixture_name).read_bytes(),
        )


class _TrackingPaddleOnlineOcrClient(_FakeOnlineOcrClient):
    pass


class _SuccessfulMineruCanonicalClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_mineru_canonical_archive_bytes()
        )


class _FailingMineruCanonicalClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        raise RuntimeError("mineru failed")


class _SimpleTablePaddleImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_simple_table_paddle_provider_response_bytes(),
        )


class _WeakPaddleImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_weak_paddle_provider_response_bytes(),
        )


class _SparseMapPaddleImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_sparse_map_paddle_provider_response_bytes(),
        )


class _EmptyMineruImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_empty_mineru_image_archive_bytes(),
        )


class _ComplexTableMineruImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_complex_table_mineru_image_archive_bytes(),
        )


class _SpatialMineruImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_spatial_mineru_image_archive_bytes(),
        )


def _build_mineru_canonical_archive_bytes() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "sample_content_list.json",
            json.dumps(
                [
                    {
                        "type": "text",
                        "text": "中央民族大学奖学金评定办法",
                        "text_level": 1,
                        "bbox": [10, 20, 300, 80],
                        "page_idx": 0,
                    },
                    {
                        "type": "text",
                        "text": "第一条 奖学金评定坚持公开、公平、公正。",
                        "text_level": 0,
                        "bbox": [10, 100, 900, 180],
                        "page_idx": 0,
                    },
                ],
                ensure_ascii=False,
            ),
        )
        archive.writestr(
            "full.md",
            "# 中央民族大学奖学金评定办法\n\n第一条 奖学金评定坚持公开、公平、公正。\n",
        )
    return buffer.getvalue()


def _build_empty_mineru_image_archive_bytes() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("sample_content_list.json", json.dumps([], ensure_ascii=False))
        archive.writestr("full.md", "")
    return buffer.getvalue()


def _build_complex_table_mineru_image_archive_bytes() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "sample_content_list.json",
            json.dumps(
                [
                    {
                        "type": "text",
                        "text": "课程安排说明",
                        "text_level": 1,
                        "bbox": [10, 20, 300, 80],
                        "page_idx": 0,
                    },
                    {
                        "type": "table",
                        "table_body": (
                            "<table><tr><td>课程</td><td>周一</td><td>周二</td></tr>"
                            "<tr><td>民族学导论</td><td>1-2节</td><td>3-4节</td></tr>"
                            "<tr><td>语言学概论</td><td>5-6节</td><td>7-8节</td></tr>"
                            "<tr><td>田野调查方法</td><td>9-10节</td><td>11-12节</td></tr></table>"
                        ),
                        "bbox": [10, 100, 1400, 900],
                        "page_idx": 0,
                    },
                ],
                ensure_ascii=False,
            ),
        )
        archive.writestr(
            "full.md",
            (
                "# 课程安排说明\n\n"
                "<table><tr><td>课程</td><td>周一</td><td>周二</td></tr>"
                "<tr><td>民族学导论</td><td>1-2节</td><td>3-4节</td></tr>"
                "<tr><td>语言学概论</td><td>5-6节</td><td>7-8节</td></tr>"
                "<tr><td>田野调查方法</td><td>9-10节</td><td>11-12节</td></tr></table>\n"
            ),
        )
    return buffer.getvalue()


def _build_spatial_mineru_image_archive_bytes() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "sample_content_list.json",
            json.dumps(
                [
                    {
                        "type": "image",
                        "bbox": [0, 0, 1000, 800],
                        "page_idx": 0,
                    }
                ],
                ensure_ascii=False,
            ),
        )
        archive.writestr("full.md", "![campus-map](page-1.png)\n")
    return buffer.getvalue()


def _build_simple_table_paddle_provider_response_bytes() -> bytes:
    payload = {
        "result": {
            "dataInfo": {"numPages": 1},
            "layoutParsingResults": [
                {
                    "markdown": {
                        "text": (
                            "<table>"
                            "<tr><td>楼名</td><td>房间号</td><td>值班电话</td></tr>"
                            "<tr><td>综合楼</td><td>109室</td><td>83877535</td></tr>"
                            "<tr><td>日新楼</td><td>108室</td><td>83874831</td></tr>"
                            "</table>"
                        )
                    }
                }
            ],
        }
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _build_weak_paddle_provider_response_bytes() -> bytes:
    payload = {
        "result": {
            "dataInfo": {"numPages": 1},
            "layoutParsingResults": [{"markdown": {"text": "课程安排说明"}}],
        }
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _build_sparse_map_paddle_provider_response_bytes() -> bytes:
    payload = {
        "result": {
            "dataInfo": {"numPages": 1},
            "layoutParsingResults": [{"markdown": {"text": "综合楼\n理工楼\n学生食堂"}}],
        }
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


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
        assert isinstance(data, bytes)
        self.put_calls.append((url, data))
        return _FakeRequestsResponse(status_code=200)

    def get(self, url: str, *, headers=None, timeout=None):  # type: ignore[no-untyped-def]
        del headers, timeout
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


class PaddleOcrAsyncClientTest(unittest.TestCase):
    def test_parse_file_retries_result_url_when_done_state_races_object_publish(self) -> None:
        requests_module = _SequencedRequestsModule()
        client = PaddleOcrAsyncClient(
            OnlineOcrSettings(
                base_url="https://example.test/ocr",
                api_key="secret",
                poll_seconds=1,
                timeout_seconds=10,
            )
        )

        with TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / "sample.png"
            file_path.write_bytes(b"png-bytes")

            with (
                patch.dict("sys.modules", {"requests": requests_module}),
                patch("campus_ingestion_core.raw_ingestion_online_ocr.time.sleep"),
            ):
                result = client.parse_file(file_path)

        self.assertEqual(result.provider_result_bytes, b'{"result":"ok"}\n')
        self.assertEqual(
            requests_module.get_calls,
            [
                "https://example.test/ocr/job-1",
                "https://example.test/result.jsonl",
                "https://example.test/result.jsonl",
            ],
        )

    def test_parse_file_raises_contract_error_when_done_result_url_stays_missing(self) -> None:
        requests_module = _AlwaysMissingResultRequestsModule()
        client = PaddleOcrAsyncClient(
            OnlineOcrSettings(
                base_url="https://example.test/ocr",
                api_key="secret",
                poll_seconds=1,
                timeout_seconds=30,
                result_ready_grace_seconds=1,
            )
        )

        with TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / "sample.png"
            file_path.write_bytes(b"png-bytes")

            with (
                patch.dict("sys.modules", {"requests": requests_module}),
                patch("campus_ingestion_core.raw_ingestion_online_ocr.time.sleep"),
                patch(
                    "campus_ingestion_core.raw_ingestion_online_ocr.time.monotonic",
                    side_effect=(0.0, 0.0, 0.5, 1.5, 1.5),
                ),
            ):
                with self.assertRaises(OnlineOcrProviderContractError) as raised:
                    client.parse_file(file_path)

        self.assertIn("file=sample.png", str(raised.exception))
        self.assertIn("job_id=job-1", str(raised.exception))
        self.assertIn("status_code=404", str(raised.exception))
        self.assertIn('response_text={"code":"NoSuchKey"}', str(raised.exception))


class PaddleOcrLayoutParsingServiceClientTest(unittest.TestCase):
    def test_parse_file_posts_to_layout_parsing_endpoint_and_wraps_result(self) -> None:
        requests_module = _LayoutParsingServiceRequestsModule()
        client = PaddleOcrLayoutParsingServiceClient(
            OnlineOcrSettings(
                base_url="https://ocr.internal",
                api_key="secret",
                provider="paddleocr_vl_service",
            )
        )

        with TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / "sample.png"
            file_path.write_bytes(b"png-bytes")

            with patch.dict("sys.modules", {"requests": requests_module}):
                result = client.parse_file(file_path)

        self.assertEqual(
            requests_module.post_calls,
            [
                (
                    "https://ocr.internal/layout-parsing",
                    {"Authorization": "bearer secret"},
                    {
                        "file": unittest.mock.ANY,
                        "fileType": 1,
                        "restructurePages": False,
                        "visualize": False,
                        "useDocOrientationClassify": False,
                        "useDocUnwarping": False,
                        "useChartRecognition": False,
                    },
                )
            ],
        )
        decoded = result.provider_result_bytes.decode("utf-8")
        self.assertIn('"layoutParsingResults"', decoded)
        self.assertIn('"dataInfo"', decoded)

    def test_parse_file_fast_fails_when_layout_results_are_missing(self) -> None:
        requests_module = types.SimpleNamespace(
            post=lambda *args, **kwargs: _FakeRequestsResponse(
                status_code=200,
                json_payload={"result": {"dataInfo": {"numPages": 1}}},
            )
        )
        client = PaddleOcrLayoutParsingServiceClient(
            OnlineOcrSettings(
                base_url="https://ocr.internal",
                api_key="secret",
                provider="paddleocr_vl_service",
            )
        )

        with TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / "sample.png"
            file_path.write_bytes(b"png-bytes")

            with patch.dict("sys.modules", {"requests": requests_module}):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "online OCR layout-parsing response for sample.png is missing layoutParsingResults",
                ):
                    client.parse_file(file_path)

    def test_build_online_ocr_client_infers_service_provider_from_non_jobs_url(self) -> None:
        settings = OnlineOcrSettings.from_env(
            {
                "OCR_BASE_URL": "https://ocr.internal",
                "OCR_API_KEY": "secret",
            },
            required=True,
        )
        self.assertIsNotNone(settings)
        assert settings is not None
        self.assertEqual(settings.provider, "paddleocr_vl_service")
        self.assertIsInstance(
            build_online_ocr_client(settings), PaddleOcrLayoutParsingServiceClient
        )

    def test_build_online_ocr_client_supports_explicit_mineru_provider_mode(self) -> None:
        settings = OnlineOcrSettings.from_env(
            {
                "OCR_BASE_URL": "https://mineru.example",
                "OCR_API_KEY": "secret",
                "OCR_PROVIDER_MODE": "mineru_api",
            },
            required=True,
        )
        self.assertIsNotNone(settings)
        assert settings is not None
        self.assertEqual(settings.provider, "mineru_api")
        self.assertEqual(settings.model, "vlm")
        self.assertIsInstance(build_online_ocr_client(settings), MineruApiClient)


class MineruApiClientTest(unittest.TestCase):
    def test_parse_file_uploads_to_batch_api_and_downloads_result_archive(self) -> None:
        requests_module = _MineruRequestsModule()
        client = MineruApiClient(
            OnlineOcrSettings(
                base_url="https://mineru.example",
                api_key="secret",
                provider="mineru_api",
                model="vlm",
                poll_seconds=1,
                timeout_seconds=30,
            )
        )

        with TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / "sample.pdf"
            file_path.write_bytes(b"%PDF-1.4 mineru compare fixture")

            with (
                patch.dict("sys.modules", {"requests": requests_module}),
                patch("campus_ingestion_core.raw_ingestion_online_ocr.time.sleep"),
            ):
                result = client.parse_file(file_path)

        self.assertEqual(result.provider_result_bytes, b"PK\x03\x04mineru-archive-bytes")
        self.assertEqual(
            requests_module.post_calls,
            [
                (
                    "https://mineru.example/api/v4/file-urls/batch",
                    {"Authorization": "Bearer secret"},
                    {
                        "enable_formula": True,
                        "language": "ch",
                        "files": [
                            {"name": "sample.pdf", "is_ocr": True, "data_id": unittest.mock.ANY}
                        ],
                        "model_version": "vlm",
                    },
                )
            ],
        )
        self.assertEqual(
            requests_module.put_calls,
            [("https://upload.example.test/file-001", b"%PDF-1.4 mineru compare fixture")],
        )
        self.assertEqual(
            requests_module.get_calls,
            [
                "https://mineru.example/api/v4/extract-results/batch/batch-001",
                "https://mineru.example/api/v4/extract-results/batch/batch-001",
                "https://download.example.test/sample.zip",
            ],
        )
        self.assertEqual(
            result.metadata,
            {
                "provider": "mineru_api",
                "batch_id": "batch-001",
                "file_name": "sample.pdf",
                "state": "done",
                "full_zip_url": "https://download.example.test/sample.zip",
            },
        )


class ParseOnlineOcrBytesTest(unittest.TestCase):
    class _SpyOnlineOcrClient:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str, bytes]] = []

        def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
            self.calls.append(("pdf", pdf_path.name, pdf_path.read_bytes()))
            return OnlineOcrProviderResult(provider_result_bytes=b'{"provider":"pdf"}\n')

        def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
            self.calls.append(("file", file_path.name, file_path.read_bytes()))
            return OnlineOcrProviderResult(provider_result_bytes=b'{"provider":"file"}\n')

    def test_parse_online_ocr_bytes_routes_pdf_bytes_through_parse_pdf(self) -> None:
        client = self._SpyOnlineOcrClient()

        result = parse_online_ocr_bytes(
            ocr_client=client,
            file_bytes=b"%PDF-1.4 test fixture",
            filename="supplement.pdf",
        )

        self.assertEqual(result.provider_result_bytes, b'{"provider":"pdf"}\n')
        self.assertEqual(client.calls, [("pdf", "supplement.pdf", b"%PDF-1.4 test fixture")])

    def test_parse_online_ocr_bytes_routes_non_pdf_bytes_through_parse_file(self) -> None:
        client = self._SpyOnlineOcrClient()

        result = parse_online_ocr_bytes(
            ocr_client=client,
            file_bytes=b"png-bytes",
            filename="notice.png",
        )

        self.assertEqual(result.provider_result_bytes, b'{"provider":"file"}\n')
        self.assertEqual(client.calls, [("file", "notice.png", b"png-bytes")])


def _handbook_raw_asset_record(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    raw_source_uri: str,
    content_hash: str,
    source_filename: str,
    object_key: str,
    content_type: str | None = None,
    file_extension: str = "",
    page_count: int | None = None,
    image_width: int | None = None,
    image_height: int | None = None,
    asset_kind: str = "",
    asset_subkind: str = "",
    classification_confidence: float | None = None,
) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus="regulations",
        collection="student_handbook",
        raw_source_uri=raw_source_uri,
        content_hash=content_hash,
        source_filename=source_filename,
        object_key=object_key,
        content_type=content_type,
        file_extension=file_extension,
        page_count=page_count,
        image_width=image_width,
        image_height=image_height,
        ingestion_timestamp="2026-03-23T00:00:00+00:00",
        import_source="seed",
        asset_kind=asset_kind,
        asset_subkind=asset_subkind,
        classification_confidence=classification_confidence,
    )


def _curriculum_raw_asset_record(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    raw_source_uri: str,
    content_hash: str,
    source_filename: str,
    object_key: str,
) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri=raw_source_uri,
        content_hash=content_hash,
        source_filename=source_filename,
        object_key=object_key,
        ingestion_timestamp="2026-03-23T00:00:00+00:00",
        import_source="seed",
    )


def _student_handbook_manifest_payload(
    *, title: str = "中央民族大学奖学金评定办法"
) -> dict[str, object]:
    return {
        "manifest_version": "student_handbook_split_manifest_v1",
        "corpus": "regulations",
        "collection": "student_handbook",
        "raw_asset_id": "asset:student-handbook-master-pdf",
        "documents": [
            {
                "document_id": "manifest:scholarship-policy",
                "title": title,
                "handbook_section": "中央民族大学学生奖励管理规定",
                "page_start": 1,
                "page_end": 1,
                "source_uri": "https://campus.example/handbook/scholarship-policy",
            }
        ],
    }


class ProcessRawIngestionJobTest(unittest.TestCase):
    def _build_curriculum_source_locator(
        self,
        *,
        raw_hash: str,
        page_start: int,
        page_end: int,
    ) -> str:
        return (
            "campusrag://source/curriculum/"
            f"curriculum-plan-master-pdf/sha256/{raw_hash}/capture/pages/{page_start}-{page_end}"
        )

    def test_process_raw_ingestion_job_requires_registered_raw_asset_identity(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with self.assertRaisesRegex(ValueError, "raw_asset_id is required"):
                process_raw_ingestion_job(
                    env={
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=_FakeObjectStore(),
                    online_ocr=_FakeOnlineOcrClient(),
                )

    def test_raw_ingestion_process_settings_accepts_mineru_primary_provider(self) -> None:
        settings = RawIngestionProcessSettings.from_request(
            RawIngestionRequest(
                raw_asset_id="asset:test",
                raw_version_id="sha256:test",
                corpus="curriculum",
                collection="curriculum_plan",
                artifact_mode="source_truth_only",
            ),
            env={
                "OCR_BASE_URL": "https://mineru.example",
                "OCR_API_KEY": "secret",
                "OCR_PROVIDER_MODE": "mineru_api",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
        )

        self.assertEqual(settings.online_ocr.provider, "mineru_api")
        self.assertEqual(settings.parser_version, "mineru-vlm-adapted-v1")

    def test_process_raw_ingestion_job_emits_declared_handbook_downstream_projections(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook stable"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            projection_config_path = root / "configs" / "source-projections.v1.json"
            projection_config_path.write_text(
                json.dumps(
                    {
                        "schema_version": "student_handbook_source_projections_v1",
                        "source_corpus": "regulations",
                        "source_collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "projections": [
                            {
                                "projection_name": "student_handbook_primary_documents",
                                "target_corpus": "regulations",
                                "target_collection": "student_handbook",
                                "projection_family": "primary_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "derived_from_document_id": None,
                                "parent_document_id": None,
                                "attachment_kind": None,
                                "attachment_role": None,
                            },
                            {
                                "projection_name": "handbook_phone_directory",
                                "target_corpus": "campus_services",
                                "target_collection": "contact_directory",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "derived_from_document_id": None,
                                "parent_document_id": None,
                                "source_title": "中央民族大学奖学金评定办法",
                                "source_handbook_section": "中央民族大学学生奖励管理规定",
                                "source_page_start": 1,
                                "source_page_end": 1,
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_contact_directory",
                                "target_title": "中央民族大学奖学金评定办法（联系人投影）",
                                "migration_reason": "handbook_contact_projection_test",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "HANDBOOK_SOURCE_PROJECTIONS_PATH": str(projection_config_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 2)
            self.assertEqual(
                tuple(
                    sorted(
                        record.document_id
                        for record in registry.list_by_scope("campus_services", "contact_directory")
                    )
                ),
                ("campus_services:contact_directory:28eb517c07c83d26ca0c17d33ec46fcdf2eb5258",),
            )

    def test_process_raw_ingestion_job_source_truth_only_reads_registered_raw_asset_from_object_store(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
            )
            layout_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _FakeOnlineOcrClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.import_mode, "raw_ingestion")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.skipped_count, 0)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 1)
            self.assertEqual(report.document_ids, ())
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "student-handbook.pdf")
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads], [provider_key, layout_key]
            )
            self.assertFalse((root / "registry" / "student_handbook_documents.json").exists())

    def test_source_truth_only_routes_pdf_through_mineru_primary_and_persists_raw_zip_sidecar(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 mineru primary"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _TrackingPaddleOnlineOcrClient()
            mineru_client = _SuccessfulMineruCanonicalClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                    asset_kind="document",
                    asset_subkind="pdf",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "paddleocr_async_jobs",
                    "OCR_MINERU_BASE_URL": "https://mineru.example",
                    "OCR_MINERU_API_KEY": "mineru-token",
                    "OCR_MINERU_PROVIDER_MODE": "mineru_api",
                    "OCR_MINERU_MODEL": "vlm",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr_clients={
                    "paddleocr_async_jobs": paddle_client,
                    "mineru_api": mineru_client,
                },
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(len(mineru_client.calls), 1)
            self.assertEqual(len(paddle_client.calls), 0)
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertTrue(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            self.assertTrue(any(key.endswith("/layout-elements.jsonl") for key in uploaded_keys))
            layout_upload = next(
                upload
                for upload in object_store.uploads
                if str(upload["key"]).endswith("/layout-elements.jsonl")
            )
            layout_rows = [
                json.loads(line)
                for line in layout_upload["data"].decode("utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(layout_rows)
            self.assertTrue(all(row["ocr_provider"] == "mineru_api" for row in layout_rows))

    def test_source_truth_only_accepts_mineru_as_primary_config_for_pdf(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 mineru primary only"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            mineru_client = _SuccessfulMineruCanonicalClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                    asset_kind="document",
                    asset_subkind="pdf",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "mineru-token",
                    "OCR_PROVIDER_MODE": "mineru_api",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=mineru_client,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(len(mineru_client.calls), 1)
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertTrue(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            layout_upload = next(
                upload
                for upload in object_store.uploads
                if str(upload["key"]).endswith("/layout-elements.jsonl")
            )
            layout_rows = [
                json.loads(line)
                for line in layout_upload["data"].decode("utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(layout_rows)
            self.assertTrue(all(row["ocr_provider"] == "mineru_api" for row in layout_rows))

    def test_source_truth_only_falls_back_to_paddle_when_mineru_primary_fails_for_pdf(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 mineru fallback"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _TrackingPaddleOnlineOcrClient()
            mineru_client = _FailingMineruCanonicalClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                    asset_kind="document",
                    asset_subkind="pdf",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "paddleocr_async_jobs",
                    "OCR_MINERU_BASE_URL": "https://mineru.example",
                    "OCR_MINERU_API_KEY": "mineru-token",
                    "OCR_MINERU_PROVIDER_MODE": "mineru_api",
                    "OCR_MINERU_MODEL": "vlm",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr_clients={
                    "paddleocr_async_jobs": paddle_client,
                    "mineru_api": mineru_client,
                },
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(len(mineru_client.calls), 1)
            self.assertEqual(len(paddle_client.calls), 1)
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertFalse(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            layout_upload = next(
                upload
                for upload in object_store.uploads
                if str(upload["key"]).endswith("/layout-elements.jsonl")
            )
            layout_rows = [
                json.loads(line)
                for line in layout_upload["data"].decode("utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(layout_rows)
            self.assertTrue(all(row["ocr_provider"] == "paddleocr_async" for row in layout_rows))

    def test_source_truth_only_dual_runs_generic_image_and_promotes_simple_table_to_paddle(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"fake-simple-table-image"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = (
                f"official_pdf/notice-table/undated/sha256/{raw_hash}/capture/notice-table.png"
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _SimpleTablePaddleImageClient()
            mineru_client = _EmptyMineruImageClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:notice-table-png",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/notice-table/notice-table.png",
                    content_hash=raw_hash,
                    source_filename="notice-table.png",
                    object_key=raw_key,
                    content_type="image/png",
                    file_extension=".png",
                    page_count=1,
                    image_width=1200,
                    image_height=800,
                    asset_kind="image",
                    asset_subkind="generic_image",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:notice-table-png",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "paddleocr_async_jobs",
                    "OCR_MINERU_BASE_URL": "https://mineru.example",
                    "OCR_MINERU_API_KEY": "mineru-token",
                    "OCR_MINERU_PROVIDER_MODE": "mineru_api",
                    "OCR_MINERU_MODEL": "vlm",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr_clients={
                    "paddleocr_async_jobs": paddle_client,
                    "mineru_api": mineru_client,
                },
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(len(paddle_client.calls), 1)
            self.assertEqual(len(mineru_client.calls), 1)
            updated_record = raw_asset_registry.get("asset:notice-table-png", raw_version_id)
            self.assertIsNotNone(updated_record)
            self.assertEqual(updated_record.asset_subkind, "simple_table_image")
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertFalse(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            self.assertTrue(
                any(key.endswith("/ocr-routing-decision.json") for key in uploaded_keys)
            )

    def test_source_truth_only_dual_runs_generic_image_and_promotes_complex_table_to_mineru(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"fake-complex-table-image"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = (
                f"official_pdf/wide-schedule/undated/sha256/{raw_hash}/capture/wide-schedule.png"
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _WeakPaddleImageClient()
            mineru_client = _ComplexTableMineruImageClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:wide-schedule-png",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/wide-schedule/wide-schedule.png",
                    content_hash=raw_hash,
                    source_filename="wide-schedule.png",
                    object_key=raw_key,
                    content_type="image/png",
                    file_extension=".png",
                    page_count=1,
                    image_width=2200,
                    image_height=900,
                    asset_kind="image",
                    asset_subkind="generic_image",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:wide-schedule-png",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "paddleocr_async_jobs",
                    "OCR_MINERU_BASE_URL": "https://mineru.example",
                    "OCR_MINERU_API_KEY": "mineru-token",
                    "OCR_MINERU_PROVIDER_MODE": "mineru_api",
                    "OCR_MINERU_MODEL": "vlm",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr_clients={
                    "paddleocr_async_jobs": paddle_client,
                    "mineru_api": mineru_client,
                },
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(len(paddle_client.calls), 1)
            self.assertEqual(len(mineru_client.calls), 1)
            updated_record = raw_asset_registry.get("asset:wide-schedule-png", raw_version_id)
            self.assertIsNotNone(updated_record)
            self.assertEqual(updated_record.asset_subkind, "complex_table_image")
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertTrue(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            self.assertTrue(
                any(key.endswith("/ocr-routing-decision.json") for key in uploaded_keys)
            )
            layout_upload = next(
                upload
                for upload in object_store.uploads
                if str(upload["key"]).endswith("/layout-elements.jsonl")
            )
            layout_rows = [
                json.loads(line)
                for line in layout_upload["data"].decode("utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(layout_rows)
            self.assertTrue(all(row["ocr_provider"] == "mineru_api" for row in layout_rows))

    def test_source_truth_only_dual_runs_generic_image_and_fail_closes_spatial_image(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"fake-spatial-image"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/campus-map/undated/sha256/{raw_hash}/capture/campus-map.png"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _SparseMapPaddleImageClient()
            mineru_client = _SpatialMineruImageClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:campus-map-png",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/campus-map/campus-map.png",
                    content_hash=raw_hash,
                    source_filename="campus-map.png",
                    object_key=raw_key,
                    content_type="image/png",
                    file_extension=".png",
                    page_count=1,
                    image_width=1600,
                    image_height=1200,
                    asset_kind="image",
                    asset_subkind="generic_image",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:campus-map-png",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "paddleocr_async_jobs",
                    "OCR_MINERU_BASE_URL": "https://mineru.example",
                    "OCR_MINERU_API_KEY": "mineru-token",
                    "OCR_MINERU_PROVIDER_MODE": "mineru_api",
                    "OCR_MINERU_MODEL": "vlm",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr_clients={
                    "paddleocr_async_jobs": paddle_client,
                    "mineru_api": mineru_client,
                },
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 0)
            self.assertEqual(report.failed_count, 1)
            self.assertEqual(len(paddle_client.calls), 1)
            self.assertEqual(len(mineru_client.calls), 1)
            updated_record = raw_asset_registry.get("asset:campus-map-png", raw_version_id)
            self.assertIsNotNone(updated_record)
            self.assertEqual(updated_record.asset_subkind, "spatial_image")
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertFalse(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertFalse(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            self.assertFalse(any(key.endswith("/layout-elements.jsonl") for key in uploaded_keys))
            self.assertTrue(
                any(key.endswith("/ocr-routing-decision.json") for key in uploaded_keys)
            )

    def test_student_handbook_normalized_raw_ingestion_requires_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            with self.assertRaisesRegex(ValueError, "split_manifest_path is required"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_handbook",
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    },
                    object_store=object_store,
                    online_ocr=_FakeOnlineOcrClient(),
                    registry=InMemoryDocumentRegistry(
                        backing_path=root / "registry" / "student_handbook_documents.json"
                    ),
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_normalizes_student_handbook_provider_result_into_logical_documents(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "documents": [
                            {
                                "document_id": "manifest:scholarship-policy",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            },
                            {
                                "document_id": "manifest:discipline-policy",
                                "title": "中央民族大学学生违纪处分办法",
                                "handbook_section": "中央民族大学学生日常管理规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "https://campus.example/handbook/discipline-policy",
                                "entitlement_groups": ["students"],
                                "visibility_scope": "main",
                                "visibility_level": "restricted",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _StudentHandbookNormalizedFakeOnlineOcrClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-master-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
            )
            structured_full_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-master-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
            )
            scholarship_doc_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            discipline_doc_id = build_handbook_doc_id("中央民族大学学生违纪处分办法")

            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.document_ids, (scholarship_doc_id, discipline_doc_id))
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "student-handbook.pdf")

            upload_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertEqual(upload_keys[0:2], [provider_key, structured_full_key])
            self.assertEqual(
                len([key for key in upload_keys if key.endswith("/document-units.jsonl")]), 2
            )
            self.assertEqual(len([key for key in upload_keys if key.endswith("/canonical.md")]), 2)
            self.assertNotIn(raw_key, upload_keys)

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(registry_payload), 2)
            scholarship_record = next(
                payload
                for payload in registry_payload.values()
                if payload["document_id"] == scholarship_doc_id
            )
            discipline_record = next(
                payload
                for payload in registry_payload.values()
                if payload["document_id"] == discipline_doc_id
            )
            self.assertEqual(scholarship_record["provider_response_object_key"], provider_key)
            self.assertEqual(discipline_record["provider_response_object_key"], provider_key)
            self.assertIn(structured_full_key, scholarship_record["processed_object_keys"])
            self.assertIn(structured_full_key, discipline_record["processed_object_keys"])
            self.assertTrue(
                scholarship_record["canonical_markdown_object_key"].endswith("/canonical.md")
            )
            self.assertTrue(
                discipline_record["canonical_markdown_object_key"].endswith("/canonical.md")
            )
            self.assertEqual(scholarship_record["raw_asset"]["page_start"], 1)
            self.assertEqual(scholarship_record["raw_asset"]["page_end"], 2)
            self.assertEqual(discipline_record["raw_asset"]["page_start"], 3)
            self.assertEqual(discipline_record["raw_asset"]["page_end"], 3)
            self.assertEqual(
                scholarship_record["source_uri"],
                "https://campus.example/handbook/scholarship-policy",
            )
            self.assertEqual(
                discipline_record["source_uri"], "https://campus.example/handbook/discipline-policy"
            )
            self.assertEqual(discipline_record["entitlement_groups"], ["students"])
            self.assertEqual(discipline_record["visibility_scope"], "main")
            self.assertEqual(
                scholarship_record["cleaning_policy_version"], "student_handbook_cleaning_v1"
            )
            self.assertEqual(
                discipline_record["cleaning_policy_version"], "student_handbook_cleaning_v1"
            )
            self.assertEqual(scholarship_record["parser_version"], "paddleocr-vl-1.5")
            self.assertEqual(discipline_record["parser_version"], "paddleocr-vl-1.5")
            self.assertEqual(scholarship_record["embedding_model"], "Qwen3-Embedding-4B")
            self.assertEqual(discipline_record["embedding_model"], "Qwen3-Embedding-4B")

    def test_process_raw_ingestion_job_persists_handbook_document_artifact_keys_under_year_namespace(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook 2018"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_filename = "学生手册_2018.pdf"
            raw_key = f"official_pdf/student-handbook-master/2018/sha256/{raw_hash}/capture/{raw_filename}"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(_student_handbook_manifest_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/2018/学生手册_2018.pdf",
                    content_hash=raw_hash,
                    source_filename=raw_filename,
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            record = registry.list_by_scope("regulations", "student_handbook")[0]
            expected_document_units_key = build_processed_artifact_key(
                corpus="regulations",
                collection="student_handbook",
                document_id=record.document_id,
                revision_track=record.revision_track,
                version_id=record.version_id,
                title="中央民族大学奖学金评定办法",
                year="2018",
                filename="document-units.jsonl",
            )
            expected_canonical_key = build_processed_artifact_key(
                corpus="regulations",
                collection="student_handbook",
                document_id=record.document_id,
                revision_track=record.revision_track,
                version_id=record.version_id,
                title="中央民族大学奖学金评定办法",
                year="2018",
                filename="canonical.md",
            )
            self.assertEqual(record.document_units_object_key, expected_document_units_key)
            self.assertEqual(record.canonical_markdown_object_key, expected_canonical_key)
            self.assertIn(expected_document_units_key, record.processed_object_keys)
            self.assertIn(expected_canonical_key, record.processed_object_keys)
            self.assertIn((DERIVED_BUCKET, expected_document_units_key), object_store.objects)
            self.assertIn((DERIVED_BUCKET, expected_canonical_key), object_store.objects)

    def test_process_raw_ingestion_job_builds_handbook_chunks_from_persisted_document_units(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook stable"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(_student_handbook_manifest_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            record = registry.list_by_scope("regulations", "student_handbook")[0]
            chunks = build_indexable_chunks_from_record(
                record=record,
                object_store=object_store,
                bucket=DERIVED_BUCKET,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertGreaterEqual(len(chunks), 1)
            self.assertTrue(
                all(
                    chunk.chunk_id.startswith(
                        f"{record.document_id}:{record.revision_track}:{record.version_id}:chunk-"
                    )
                    for chunk in chunks
                )
            )
            self.assertTrue(all(chunk.source_chunk_id for chunk in chunks))
            self.assertTrue(all(chunk.metadata["root_unit_id"] for chunk in chunks))
            self.assertTrue(all(chunk.metadata["segment_index"] >= 1 for chunk in chunks))
            self.assertTrue(all(chunk.metadata["segment_total"] >= 1 for chunk in chunks))
            self.assertTrue(
                all(
                    chunk.metadata["chunk_policy_version"] == "student_handbook_semantic_v3"
                    for chunk in chunks
                )
            )
            self.assertTrue(
                all(
                    chunk.metadata["cleaning_policy_version"] == "student_handbook_cleaning_v1"
                    for chunk in chunks
                )
            )

    def test_process_raw_ingestion_job_rejects_split_manifest_with_mismatched_raw_asset_id(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:wrong-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "manifest:scholarship-policy",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            with self.assertRaisesRegex(ValueError, "split manifest raw_asset_id mismatch"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    },
                    object_store=object_store,
                    online_ocr=_StudentHandbookNormalizedFakeOnlineOcrClient(),
                    registry=InMemoryDocumentRegistry(
                        backing_path=root / "registry" / "student_handbook_documents.json"
                    ),
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_records_manifest_title_mismatch_without_persisting_document(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "documents": [
                            {
                                "document_id": "manifest:scholarship-policy",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            },
                            {
                                "document_id": "manifest:discipline-policy",
                                "title": "错误的标题",
                                "handbook_section": "中央民族大学学生日常管理规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "https://campus.example/handbook/discipline-policy",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=_StudentHandbookNormalizedFakeOnlineOcrClient(),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            scholarship_doc_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.failed_count, 1)
            self.assertEqual(report.document_ids, (scholarship_doc_id,))
            self.assertIn("manifest title mismatch", report.errors[0])
            self.assertIn("manifest:discipline-policy", report.errors[0])

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(registry_payload), 1)
            stored_record = next(iter(registry_payload.values()))
            self.assertEqual(stored_record["document_id"], scholarship_doc_id)

    def test_process_raw_ingestion_job_skips_unchanged_handbook_reingestion(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook stable"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(_student_handbook_manifest_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )
            env = {
                "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                "RAW_VERSION_ID": raw_version_id,
                "INGESTION_CORPUS": "regulations",
                "INGESTION_COLLECTION": "student_handbook",
                "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                "OCR_API_KEY": "token",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "IMPORT_REPORT_DIR": str(root / "reports"),
                "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }

            first = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            document_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            self.assertEqual(first.success_count, 1)
            self.assertEqual(first.created_document_ids, (document_id,))
            self.assertEqual(first.updated_document_ids, ())
            self.assertEqual(first.skipped_document_ids, ())
            self.assertEqual(second.success_count, 0)
            self.assertEqual(second.skipped_count, 1)
            self.assertEqual(second.created_document_ids, ())
            self.assertEqual(second.updated_document_ids, ())
            self.assertEqual(second.skipped_document_ids, (document_id,))
            self.assertEqual(second.document_ids, ())

            report_payload = json.loads(Path(second.report_path).read_text(encoding="utf-8"))
            self.assertEqual(report_payload["created_document_ids"], [])
            self.assertEqual(report_payload["updated_document_ids"], [])
            self.assertEqual(report_payload["skipped_document_ids"], [document_id])

    def test_process_raw_ingestion_job_records_updated_document_ids_for_changed_handbook_content(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            stable_bytes = b"%PDF-1.4 remote student handbook stable"
            updated_bytes = b"%PDF-1.4 remote student handbook updated"
            stable_hash = hashlib.sha256(stable_bytes).hexdigest()
            updated_hash = hashlib.sha256(updated_bytes).hexdigest()
            stable_version_id = f"sha256:{stable_hash}"
            updated_version_id = f"sha256:{updated_hash}"
            stable_key = f"official_pdf/student-handbook-master/undated/sha256/{stable_hash}/capture/student-handbook.pdf"
            updated_key = f"official_pdf/student-handbook-master/undated/sha256/{updated_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(_student_handbook_manifest_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, stable_key)] = stable_bytes
            object_store.objects[(SOURCE_BUCKET, updated_key)] = updated_bytes
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=stable_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=stable_hash,
                    source_filename="student-handbook.pdf",
                    object_key=stable_key,
                )
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=updated_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=updated_hash,
                    source_filename="student-handbook.pdf",
                    object_key=updated_key,
                )
            )

            first = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": stable_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": updated_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-updated.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            document_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            self.assertEqual(first.created_document_ids, (document_id,))
            self.assertEqual(second.success_count, 1)
            self.assertEqual(second.created_document_ids, ())
            self.assertEqual(second.updated_document_ids, (document_id,))
            self.assertEqual(second.skipped_document_ids, ())
            self.assertEqual(second.document_ids, (document_id,))

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            versions = [
                payload["version_id"]
                for payload in registry_payload.values()
                if payload["document_id"] == document_id
            ]
            self.assertEqual(len(versions), 2)
            self.assertEqual(len(set(versions)), 2)

            report_payload = json.loads(Path(second.report_path).read_text(encoding="utf-8"))
            self.assertEqual(report_payload["created_document_ids"], [])
            self.assertEqual(report_payload["updated_document_ids"], [document_id])
            self.assertEqual(report_payload["skipped_document_ids"], [])

    def test_source_truth_only_reuses_registered_raw_asset_but_rewrites_provider_result(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 volatile"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/volatile/undated/sha256/{raw_hash}/capture/volatile.pdf"
            provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:volatile-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
            )
            layout_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:volatile-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _VolatileFakeOnlineOcrClient()
            env = {
                "RAW_ASSET_ID": "asset:volatile-pdf",
                "RAW_VERSION_ID": raw_version_id,
                "INGESTION_CORPUS": "regulations",
                "INGESTION_COLLECTION": "student_handbook",
                "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                "OCR_API_KEY": "token",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "IMPORT_REPORT_DIR": str(root / "reports"),
                "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:volatile-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/volatile/volatile.pdf",
                    content_hash=raw_hash,
                    source_filename="volatile.pdf",
                    object_key=raw_key,
                )
            )

            first = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(first.success_count, 1)
            self.assertEqual(second.success_count, 1)
            self.assertEqual(second.skipped_count, 0)
            self.assertEqual(second.raw_uploaded_count, 0)
            self.assertEqual(second.raw_reused_count, 1)
            self.assertEqual(len(object_store.uploads), 4)
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads[-2:]], [provider_key, layout_key]
            )

    def test_source_truth_only_rejects_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            with self.assertRaisesRegex(
                ValueError, "source_truth_only does not support split manifest ingestion"
            ):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_handbook",
                        "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=object_store,
                    online_ocr=_FakeOnlineOcrClient(),
                    registry=InMemoryDocumentRegistry(
                        backing_path=root / "registry" / "student_handbook_documents.json"
                    ),
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_supports_curriculum_plan_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/curriculum-plan-master/undated/sha256/{raw_hash}/capture/curriculum-plan.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_payload = {
                "manifest_version": "curriculum_plan_split_manifest_v1",
                "corpus": "curriculum",
                "collection": "curriculum_plan",
                "raw_asset_id": "asset:curriculum-plan-master-pdf",
                "documents": [
                    {
                        "document_id": "curriculum:plan-001",
                        "title": "Plan 001",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    {
                        "document_id": "curriculum:plan-002",
                        "title": "Plan 002",
                        "page_start": 2,
                        "page_end": 2,
                        "entitlement_groups": ["students"],
                        "visibility_scope": "main",
                        "visibility_level": "restricted",
                    },
                ],
            }
            split_manifest_path.write_text(
                json.dumps(split_manifest_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _curriculum_raw_asset_record(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/curriculum-plan-master/curriculum-plan.pdf",
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:curriculum-plan-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            source_uri_1 = self._build_curriculum_source_locator(
                raw_hash=raw_hash, page_start=1, page_end=1
            )
            source_uri_2 = self._build_curriculum_source_locator(
                raw_hash=raw_hash, page_start=2, page_end=2
            )
            digest_1 = hashlib.sha256(
                "|".join(
                    [
                        raw_version_id,
                        "curriculum_plan_split_manifest_v1",
                        "curriculum:plan-001",
                        "1",
                        "1",
                    ]
                ).encode("utf-8")
            ).hexdigest()[:12]
            digest_2 = hashlib.sha256(
                "|".join(
                    [
                        raw_version_id,
                        "curriculum_plan_split_manifest_v1",
                        "curriculum:plan-002",
                        "2",
                        "2",
                    ]
                ).encode("utf-8")
            ).hexdigest()[:12]

            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.document_ids, ("curriculum:plan-001", "curriculum:plan-002"))
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "curriculum-plan.pdf")
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads],
                [
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="provider-response.jsonl",
                    ),
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="layout-elements.jsonl",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-001",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-001:{digest_1}",
                        title="Plan 001",
                        year=None,
                        filename="document-units.jsonl",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-002",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-002:{digest_2}",
                        title="Plan 002",
                        year=None,
                        filename="document-units.jsonl",
                    ),
                ],
            )

            registry_payload = json.loads(
                (root / "registry" / "curriculum_plan_documents.json").read_text(encoding="utf-8")
            )
            plan_001 = registry_payload[
                f"curriculum:plan-001::source-faithful::sha256:{raw_hash}:split:plan-001:{digest_1}"
            ]
            plan_002 = registry_payload[
                f"curriculum:plan-002::source-faithful::sha256:{raw_hash}:split:plan-002:{digest_2}"
            ]
            self.assertEqual(
                plan_001["provider_response_object_key"],
                build_processed_asset_artifact_key(
                    corpus="curriculum",
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    filename="provider-response.jsonl",
                ),
            )
            self.assertEqual(
                plan_002["processed_object_keys"],
                [
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="provider-response.jsonl",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-002",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-002:{digest_2}",
                        title="Plan 002",
                        year=None,
                        filename="document-units.jsonl",
                    ),
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="layout-elements.jsonl",
                    ),
                ],
            )
            self.assertEqual(plan_001["cleaning_policy_version"], "curriculum_plan_cleaning_v1")
            self.assertEqual(plan_002["cleaning_policy_version"], "curriculum_plan_cleaning_v1")
            self.assertEqual(plan_002["visibility_scope"], "main")
            self.assertEqual(plan_002["entitlement_groups"], ["students"])
            self.assertEqual(plan_001["revision_track"], "source-faithful")
            self.assertEqual(plan_001["source_channel"], "pdf_ocr")
            self.assertEqual(plan_001["source_uri"], source_uri_1)
            self.assertEqual(plan_002["source_uri"], source_uri_2)

    def test_process_raw_ingestion_job_supports_curriculum_plan_source_truth_only_presplit(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/curriculum-plan/undated/sha256/{raw_hash}/capture/curriculum-plan.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _curriculum_raw_asset_record(
                    raw_asset_id="asset:curriculum-plan-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/curriculum-plan/curriculum-plan.pdf",
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:curriculum-plan-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 1)
            self.assertEqual(report.document_ids, ())
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "curriculum-plan.pdf")
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads],
                [
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-pdf",
                        raw_version_id=raw_version_id,
                        filename="provider-response.jsonl",
                    ),
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-pdf",
                        raw_version_id=raw_version_id,
                        filename="layout-elements.jsonl",
                    ),
                ],
            )
            self.assertFalse((root / "registry" / "curriculum_plan_documents.json").exists())
            layout_key = build_processed_asset_artifact_key(
                corpus="curriculum",
                raw_asset_id="asset:curriculum-plan-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
            )
            layout_bytes = object_store.objects[(SOURCE_BUCKET, layout_key)]
            layout_rows = [
                json.loads(line)
                for line in layout_bytes.decode("utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(layout_rows)
            self.assertEqual(layout_rows[0]["schema_version"], "curriculum_layout_elements_v3")

            raw_asset_payload = json.loads(
                (root / "registry" / "curriculum_plan_raw_assets.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(raw_asset_payload), 1)

    def test_process_raw_ingestion_job_source_truth_only_uses_dedicated_raw_asset_registry_env(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/curriculum-plan/undated/sha256/{raw_hash}/capture/curriculum-plan.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes

            with patch(
                "campus_ingestion_core.raw_ingestion.build_raw_asset_registry_from_env"
            ) as build_registry:
                raw_asset_registry = InMemoryRawAssetRegistry(
                    backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
                )
                build_registry.return_value = raw_asset_registry
                raw_asset_registry.upsert(
                    _curriculum_raw_asset_record(
                        raw_asset_id="asset:curriculum-plan-pdf",
                        raw_version_id=raw_version_id,
                        raw_source_uri="s3://campus-rag-source/official_pdf/curriculum-plan/curriculum-plan.pdf",
                        content_hash=raw_hash,
                        source_filename="curriculum-plan.pdf",
                        object_key=raw_key,
                    )
                )

                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:curriculum-plan-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "curriculum",
                        "INGESTION_COLLECTION": "curriculum_plan",
                        "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                        "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=object_store,
                    online_ocr=_FakeOnlineOcrClient(),
                )

            build_registry.assert_called_once_with(
                {
                    "RAW_ASSET_ID": "asset:curriculum-plan-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                }
            )

    def test_process_raw_ingestion_job_rejects_split_manifest_with_mismatched_corpus(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/curriculum-plan-master/undated/sha256/{raw_hash}/capture/curriculum-plan.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-master-pdf",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 1,
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
            raw_asset_registry.upsert(
                RawAssetRecord(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    corpus="regulations",
                    collection="student_handbook",
                    raw_source_uri="s3://campus-rag-source/official_pdf/curriculum-plan-master/curriculum-plan.pdf",
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                    ingestion_timestamp="2026-03-23T00:00:00+00:00",
                    import_source="seed",
                )
            )

            with self.assertRaisesRegex(ValueError, "split manifest corpus mismatch"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:curriculum-plan-master-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    },
                    object_store=object_store,
                    online_ocr=online_ocr,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_requires_ocr_credentials(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            with self.assertRaisesRegex(ValueError, "OCR_BASE_URL and OCR_API_KEY"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_handbook",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    },
                    object_store=object_store,
                    registry=InMemoryDocumentRegistry(
                        backing_path=root / "registry" / "student_handbook_documents.json"
                    ),
                    raw_asset_registry=raw_asset_registry,
                )


if __name__ == "__main__":
    unittest.main()
