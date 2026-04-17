from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

compare_worker = importlib.import_module("campus_ingestion_worker.compare_online_ocr")


class CompareOnlineOcrWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.compare_online_ocr.load_worker_env"),
            patch("campus_ingestion_worker.compare_online_ocr.compare_online_ocr") as compare_online_ocr,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            compare_online_ocr.return_value = compare_worker.OnlineOcrCompareReport(
                provider="mineru_api",
                model="vlm",
                input_filename="sample.pdf",
                output_dir="/tmp/output",
                provider_response_path="/tmp/output/provider-response.zip",
                candidate_markdown_path="/tmp/output/full.md",
                comparison_path="/tmp/output/comparison.json",
                summary_path="/tmp/output/summary.json",
            )
            compare_worker.main(
                [
                    "--file-path",
                    "/tmp/sample.pdf",
                    "--output-dir",
                    "/tmp/output",
                    "--baseline-provider-response-path",
                    "/tmp/paddle-provider-response.jsonl",
                ]
            )

        request = compare_online_ocr.call_args.kwargs["request"]
        self.assertEqual(str(request.file_path), "/tmp/sample.pdf")
        self.assertEqual(str(request.output_dir), "/tmp/output")
        self.assertEqual(
            str(request.baseline_provider_response_path),
            "/tmp/paddle-provider-response.jsonl",
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["provider"], "mineru_api")
        self.assertEqual(payload["model"], "vlm")
        self.assertEqual(payload["summary_path"], "/tmp/output/summary.json")


if __name__ == "__main__":
    unittest.main()
