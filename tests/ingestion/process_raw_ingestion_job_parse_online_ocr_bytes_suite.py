from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *  # noqa: F401,F403


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
