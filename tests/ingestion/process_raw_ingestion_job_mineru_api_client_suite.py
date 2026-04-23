from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *


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

    def test_parse_file_splits_oversized_pdf_and_returns_segment_provenance(self) -> None:
        requests_module = _SplitMineruRequestsModule()
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
            file_path = Path(temp_dir) / "oversized.pdf"
            import fitz

            with fitz.open() as document:
                for _ in range(201):
                    document.new_page(width=300, height=300)
                file_path.write_bytes(document.tobytes(garbage=3, deflate=True))

            with (
                patch.dict("sys.modules", {"requests": requests_module}),
                patch("campus_ingestion_core.raw_ingestion_online_ocr.time.sleep"),
            ):
                result = client.parse_file(file_path)

        self.assertFalse(result.provider_result_bytes.startswith(b"PK\x03\x04"))
        payload = json.loads(result.provider_result_bytes.decode("utf-8"))
        self.assertEqual(payload["result"]["dataInfo"]["numPages"], 2)
        self.assertEqual(result.metadata["split_applied"], True)
        self.assertEqual(result.metadata["page_count"], 201)
        self.assertEqual(result.metadata["segment_count"], 2)
        self.assertEqual(
            [artifact.filename for artifact in result.raw_provider_artifacts],
            [
                "provider-response-raw.part-0001.zip",
                "provider-response-raw.part-0002.zip",
                "provider-response-raw.manifest.json",
            ],
        )
        self.assertEqual(len(requests_module.post_calls), 2)
        self.assertEqual(len(requests_module.put_calls), 2)


class _SplitMineruRequestsModule:
    def __init__(self) -> None:
        self.post_calls: list[tuple[str, dict[str, str], dict[str, object]]] = []
        self.put_calls: list[tuple[str, bytes]] = []
        self.get_calls: list[str] = []
        self._batch_status_attempts: dict[str, int] = {}
        self._download_payloads = {
            "https://download.example.test/batch-001.zip": _build_split_mineru_archive_bytes(
                title="大段 1",
                paragraph="第 1 段",
            ),
            "https://download.example.test/batch-002.zip": _build_split_mineru_archive_bytes(
                title="大段 2",
                paragraph="第 2 段",
            ),
        }

    def post(self, url: str, *, headers=None, json=None, timeout=None):  # type: ignore[no-untyped-def]
        del timeout
        self.post_calls.append((url, headers or {}, json or {}))
        batch_id = f"batch-{len(self.post_calls):03d}"
        return _FakeRequestsResponse(
            status_code=200,
            json_payload={
                "code": 0,
                "data": {
                    "batch_id": batch_id,
                    "file_urls": [f"https://upload.example.test/{batch_id}.pdf"],
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
        if "/extract-results/batch/" in url:
            batch_id = url.rsplit("/", 1)[-1]
            attempts = self._batch_status_attempts.get(batch_id, 0) + 1
            self._batch_status_attempts[batch_id] = attempts
            state = "running" if attempts == 1 else "done"
            return _FakeRequestsResponse(
                status_code=200,
                json_payload={
                    "code": 0,
                    "data": {
                        "extract_result": [
                            {
                                "file_name": unittest.mock.ANY,
                                "state": state,
                                "full_zip_url": (
                                    f"https://download.example.test/{batch_id}.zip"
                                    if state == "done"
                                    else None
                                ),
                            }
                        ]
                    },
                },
            )
        if url in self._download_payloads:
            return _FakeRequestsResponse(
                status_code=200,
                content=self._download_payloads[url],
            )
        raise AssertionError(f"unexpected GET url: {url}")


def _build_split_mineru_archive_bytes(*, title: str, paragraph: str) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "sample_content_list.json",
            json.dumps(
                [
                    {
                        "type": "text",
                        "text": title,
                        "text_level": 1,
                        "bbox": [10, 20, 300, 80],
                        "page_idx": 0,
                    },
                    {
                        "type": "text",
                        "text": paragraph,
                        "text_level": 0,
                        "bbox": [10, 100, 900, 180],
                        "page_idx": 0,
                    },
                ],
                ensure_ascii=False,
            ),
        )
        archive.writestr("full.md", f"# {title}\n\n{paragraph}\n")
    return buffer.getvalue()
