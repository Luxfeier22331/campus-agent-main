from __future__ import annotations

import json
import os
import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.online_ocr_compare import (
    OnlineOcrCompareRequest,
    compare_online_ocr,
)
from campus_ingestion_core.raw_ingestion_online_ocr import (
    OnlineOcrProviderContractError,
    OnlineOcrProviderResult,
)


class _FakeMineruCompareClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_mineru_archive_bytes(
                markdown="# MinerU Candidate\n\n第一段内容\n\n第二段内容\n",
                middle_payload={
                    "doc_layout_result": [
                        {"text": "第一段内容"},
                        {"text": "第二段内容"},
                    ]
                },
            ),
            metadata={
                "provider": "mineru_api",
                "batch_id": "batch-001",
                "file_name": file_path.name,
                "state": "done",
                "full_zip_url": "https://download.example.test/sample.zip",
            },
        )


class _ComplexTableMineruCompareClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_mineru_archive_bytes(
                markdown=(
                    "# 课程安排说明\n\n"
                    "<table><tr><td>课程</td><td>周一</td><td>周二</td></tr>"
                    "<tr><td>民族学导论</td><td>1-2节</td><td>3-4节</td></tr>"
                    "<tr><td>语言学概论</td><td>5-6节</td><td>7-8节</td></tr>"
                    "<tr><td>田野调查方法</td><td>9-10节</td><td>11-12节</td></tr></table>\n"
                ),
                middle_payload={
                    "doc_layout_result": [
                        {"text": "课程安排说明"},
                        {"text": "课程 周一 周二"},
                    ]
                },
            ),
            metadata={
                "provider": "mineru_api",
                "batch_id": "batch-002",
                "file_name": file_path.name,
                "state": "done",
                "full_zip_url": "https://download.example.test/complex-table.zip",
            },
        )


class _EmptyMineruCompareClient:
    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_mineru_archive_bytes(
                markdown="",
                middle_payload={"doc_layout_result": []},
            ),
            metadata={
                "provider": "mineru_api",
                "file_name": file_path.name,
                "state": "done",
            },
        )


class _SpatialMineruCompareClient:
    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_mineru_archive_bytes(
                markdown="![campus-map](page-1.png)\n",
                middle_payload={"doc_layout_result": [{"type": "image"}]},
            ),
            metadata={
                "provider": "mineru_api",
                "file_name": file_path.name,
                "state": "done",
            },
        )


class _FailingMineruCompareClient:
    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        raise OnlineOcrProviderContractError(
            file_name=file_path.name,
            job_id="job-404",
            state="done",
            json_url="https://download.example.test/result.jsonl",
            elapsed_seconds=12.5,
            status_code=404,
            response_text="NoSuchKey",
            status_payload={"status": "done"},
        )


def _build_mineru_archive_bytes(*, markdown: str, middle_payload: dict[str, object]) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("full.md", markdown)
        archive.writestr("sample_middle.json", json.dumps(middle_payload, ensure_ascii=False))
        archive.writestr(
            "sample_content_list.json",
            json.dumps([{"type": "text", "text": "第一段内容"}], ensure_ascii=False),
        )
        archive.writestr(
            "sample_model.json", json.dumps({"model_version": "vlm"}, ensure_ascii=False)
        )
    return buffer.getvalue()


def _build_paddle_provider_response_bytes() -> bytes:
    payload = {
        "result": {
            "layoutParsingResults": [
                {"markdown": {"text": "Paddle baseline 第一段"}},
                {"markdown": {"text": "Paddle baseline 第二段"}},
            ]
        }
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _build_markup_heavy_paddle_provider_response_bytes() -> bytes:
    payload = {
        "result": {
            "layoutParsingResults": [
                {
                    "markdown": {
                        "text": (
                            "<table border=1 style='margin:auto'>"
                            "<tr><td>楼名</td><td>房间号</td><td>值班电话</td></tr>"
                            "<tr><td>综合楼</td><td>109室</td><td>83877535</td></tr>"
                            "<tr><td>日新楼</td><td>108室</td><td>83874831</td></tr>"
                            "</table>"
                        )
                    }
                }
            ]
        }
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


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


class OnlineOcrCompareTest(unittest.TestCase):
    def test_compare_online_ocr_reads_runtime_env_when_explicit_env_is_omitted(self) -> None:
        client = _FakeMineruCompareClient()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            file_path = root / "sample.pdf"
            output_dir = root / "compare-output"
            file_path.write_bytes(b"%PDF-1.4 compare fixture")

            with patch.dict(
                os.environ,
                {
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "secret",
                    "OCR_PROVIDER_MODE": "mineru_api",
                },
                clear=False,
            ):
                report = compare_online_ocr(
                    request=OnlineOcrCompareRequest(
                        file_path=file_path,
                        output_dir=output_dir,
                    ),
                    online_ocr=client,
                )

            self.assertEqual(report.provider, "mineru_api")
            self.assertEqual(client.calls, [file_path])

    def test_compare_online_ocr_writes_candidate_artifacts_and_baseline_summary(self) -> None:
        client = _FakeMineruCompareClient()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            file_path = root / "sample.pdf"
            output_dir = root / "compare-output"
            baseline_path = root / "paddle-provider-response.jsonl"
            file_path.write_bytes(b"%PDF-1.4 compare fixture")
            baseline_path.write_bytes(_build_paddle_provider_response_bytes())

            report = compare_online_ocr(
                request=OnlineOcrCompareRequest(
                    file_path=file_path,
                    output_dir=output_dir,
                    baseline_provider_response_path=baseline_path,
                ),
                env={
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "secret",
                    "OCR_PROVIDER_MODE": "mineru_api",
                },
                online_ocr=client,
            )

            summary_path = Path(report.summary_path)
            self.assertTrue(summary_path.exists())
            summary = json.loads(summary_path.read_text(encoding="utf-8"))

            self.assertEqual(client.calls, [file_path])
            self.assertEqual(report.provider, "mineru_api")
            self.assertEqual(report.model, "vlm")
            self.assertTrue(Path(report.provider_response_path).exists())
            self.assertTrue(Path(report.candidate_markdown_path).exists())
            self.assertEqual(
                Path(report.candidate_markdown_path).read_text(encoding="utf-8"),
                "# MinerU Candidate\n\n第一段内容\n\n第二段内容\n",
            )
            self.assertTrue(Path(report.comparison_path).exists())
            self.assertEqual(summary["candidate"]["provider"], "mineru_api")
            self.assertEqual(
                summary["candidate"]["plain_text_preview"], "MinerU Candidate 第一段内容 第二段内容"
            )
            self.assertTrue(summary["baseline"]["available"])
            self.assertEqual(summary["baseline"]["provider"], "paddleocr_async_jobs")
            self.assertEqual(
                summary["baseline"]["plain_text_preview"],
                "Paddle baseline 第一段 Paddle baseline 第二段",
            )

    def test_compare_online_ocr_marks_empty_candidate_and_prefers_usable_baseline(self) -> None:
        client = _EmptyMineruCompareClient()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            file_path = root / "sample.png"
            output_dir = root / "compare-output"
            baseline_path = root / "paddle-provider-response.jsonl"
            file_path.write_bytes(b"fake-image")
            baseline_path.write_bytes(_build_paddle_provider_response_bytes())

            report = compare_online_ocr(
                request=OnlineOcrCompareRequest(
                    file_path=file_path,
                    output_dir=output_dir,
                    baseline_provider_response_path=baseline_path,
                ),
                env={
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "secret",
                    "OCR_PROVIDER_MODE": "mineru_api",
                },
                online_ocr=client,
            )

            comparison = json.loads(Path(report.comparison_path).read_text(encoding="utf-8"))
            self.assertEqual(comparison["candidate"]["status"], "empty_output")
            self.assertTrue(comparison["candidate"]["provider_response_available"])
            self.assertFalse(comparison["candidate"]["usable_output"])
            self.assertTrue(comparison["candidate"]["empty_output"])
            self.assertEqual(comparison["adjudication"]["winner"], "baseline")
            self.assertEqual(
                comparison["adjudication"]["reason_codes"],
                ["candidate_empty_output"],
            )

    def test_compare_online_ocr_captures_candidate_provider_failure_instead_of_aborting(
        self,
    ) -> None:
        client = _FailingMineruCompareClient()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            file_path = root / "sample.pdf"
            output_dir = root / "compare-output"
            baseline_path = root / "paddle-provider-response.jsonl"
            file_path.write_bytes(b"%PDF-1.4 compare fixture")
            baseline_path.write_bytes(_build_paddle_provider_response_bytes())

            report = compare_online_ocr(
                request=OnlineOcrCompareRequest(
                    file_path=file_path,
                    output_dir=output_dir,
                    baseline_provider_response_path=baseline_path,
                ),
                env={
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "secret",
                    "OCR_PROVIDER_MODE": "mineru_api",
                },
                online_ocr=client,
            )

            comparison = json.loads(Path(report.comparison_path).read_text(encoding="utf-8"))
            summary = json.loads(Path(report.summary_path).read_text(encoding="utf-8"))
            self.assertEqual(comparison["candidate"]["status"], "failed")
            self.assertFalse(comparison["candidate"]["provider_response_available"])
            self.assertEqual(
                comparison["candidate"]["error_type"], "OnlineOcrProviderContractError"
            )
            self.assertIn("unusable resultUrl", comparison["candidate"]["error"])
            self.assertEqual(comparison["adjudication"]["winner"], "baseline")
            self.assertEqual(
                comparison["adjudication"]["reason_codes"],
                ["candidate_provider_failure"],
            )
            self.assertEqual(summary["adjudication"]["winner"], "baseline")

    def test_compare_online_ocr_does_not_use_length_delta_alone_as_winner(self) -> None:
        client = _FakeMineruCompareClient()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            file_path = root / "sample.png"
            output_dir = root / "compare-output"
            baseline_path = root / "paddle-provider-response.jsonl"
            file_path.write_bytes(b"fake-image")
            baseline_path.write_bytes(_build_markup_heavy_paddle_provider_response_bytes())

            report = compare_online_ocr(
                request=OnlineOcrCompareRequest(
                    file_path=file_path,
                    output_dir=output_dir,
                    baseline_provider_response_path=baseline_path,
                ),
                env={
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "secret",
                    "OCR_PROVIDER_MODE": "mineru_api",
                },
                online_ocr=client,
            )

            comparison = json.loads(Path(report.comparison_path).read_text(encoding="utf-8"))
            self.assertGreater(
                comparison["baseline"]["plain_text_length"],
                comparison["candidate"]["plain_text_length"],
            )
            self.assertGreater(
                comparison["baseline"]["structure_signals"]["html_tag_count"],
                comparison["candidate"]["structure_signals"]["html_tag_count"],
            )
            self.assertEqual(comparison["adjudication"]["winner"], "manual_review")
            self.assertTrue(comparison["adjudication"]["manual_review_required"])
            self.assertEqual(
                comparison["adjudication"]["reason_codes"],
                [
                    "length_delta_not_decisive",
                    "baseline_markup_inflation_detected",
                    "no_clear_winner",
                ],
            )

    def test_compare_online_ocr_refines_simple_table_image_and_recommends_paddle(self) -> None:
        client = _EmptyMineruCompareClient()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            file_path = root / "notice-table.png"
            output_dir = root / "compare-output"
            baseline_path = root / "paddle-provider-response.jsonl"
            file_path.write_bytes(b"fake-image")
            baseline_path.write_bytes(_build_simple_table_paddle_provider_response_bytes())

            report = compare_online_ocr(
                request=OnlineOcrCompareRequest(
                    file_path=file_path,
                    output_dir=output_dir,
                    baseline_provider_response_path=baseline_path,
                ),
                env={
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "secret",
                    "OCR_PROVIDER_MODE": "mineru_api",
                },
                online_ocr=client,
            )

            summary = json.loads(Path(report.summary_path).read_text(encoding="utf-8"))
            self.assertEqual(summary["asset_typing"]["initial"]["asset_subkind"], "generic_image")
            self.assertEqual(
                summary["asset_typing"]["refined"]["asset_subkind"], "simple_table_image"
            )
            self.assertEqual(
                summary["routing_recommendation"]["canonical_provider"], "paddleocr_async_jobs"
            )
            self.assertEqual(
                summary["routing_recommendation"]["route_id"], "simple_table_image_paddle_primary"
            )

    def test_compare_online_ocr_refines_complex_table_image_and_recommends_mineru(self) -> None:
        client = _ComplexTableMineruCompareClient()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            file_path = root / "wide-schedule.png"
            output_dir = root / "compare-output"
            baseline_path = root / "paddle-provider-response.jsonl"
            file_path.write_bytes(b"fake-wide-image")
            baseline_path.write_bytes(_build_weak_paddle_provider_response_bytes())

            report = compare_online_ocr(
                request=OnlineOcrCompareRequest(
                    file_path=file_path,
                    output_dir=output_dir,
                    baseline_provider_response_path=baseline_path,
                ),
                env={
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "secret",
                    "OCR_PROVIDER_MODE": "mineru_api",
                },
                online_ocr=client,
            )

            summary = json.loads(Path(report.summary_path).read_text(encoding="utf-8"))
            self.assertEqual(
                summary["asset_typing"]["refined"]["asset_subkind"], "complex_table_image"
            )
            self.assertEqual(summary["routing_recommendation"]["canonical_provider"], "mineru_api")
            self.assertEqual(
                summary["routing_recommendation"]["route_id"], "complex_image_mineru_selected"
            )

    def test_compare_online_ocr_refines_spatial_image_and_marks_it_deferred(self) -> None:
        client = _SpatialMineruCompareClient()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            file_path = root / "campus-map.png"
            output_dir = root / "compare-output"
            baseline_path = root / "paddle-provider-response.jsonl"
            file_path.write_bytes(b"fake-map-image")
            baseline_path.write_bytes(_build_sparse_map_paddle_provider_response_bytes())

            report = compare_online_ocr(
                request=OnlineOcrCompareRequest(
                    file_path=file_path,
                    output_dir=output_dir,
                    baseline_provider_response_path=baseline_path,
                ),
                env={
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "secret",
                    "OCR_PROVIDER_MODE": "mineru_api",
                },
                online_ocr=client,
            )

            summary = json.loads(Path(report.summary_path).read_text(encoding="utf-8"))
            self.assertEqual(summary["asset_typing"]["refined"]["asset_subkind"], "spatial_image")
            self.assertFalse(summary["routing_recommendation"]["canonical_allowed"])
            self.assertEqual(
                summary["routing_recommendation"]["route_id"], "spatial_image_deferred"
            )


if __name__ == "__main__":
    unittest.main()
