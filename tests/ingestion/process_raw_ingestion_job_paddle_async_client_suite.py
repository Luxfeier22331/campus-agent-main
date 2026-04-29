from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *


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
                self.assertRaises(OnlineOcrProviderContractError) as raised,
            ):
                client.parse_file(file_path)

        self.assertIn("file=sample.png", str(raised.exception))
        self.assertIn("job_id=job-1", str(raised.exception))
        self.assertIn("status_code=404", str(raised.exception))
        self.assertIn('response_text={"code":"NoSuchKey"}', str(raised.exception))
