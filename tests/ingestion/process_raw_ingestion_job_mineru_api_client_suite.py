from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *  # noqa: F401,F403


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
