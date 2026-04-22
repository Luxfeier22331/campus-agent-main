from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *  # noqa: F401,F403


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
