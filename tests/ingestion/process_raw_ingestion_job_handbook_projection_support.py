from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *


class _PhoneDirectoryOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        provider_payload = {
            "result": {
                "dataInfo": {
                    "numPages": 1,
                    "pages": [{"width": 828, "height": 1151}],
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
                                    "markdown": {"text": "中央民族大学校内常用电话"},
                                },
                                {
                                    "blockType": "paragraph",
                                    "blockId": "p1-body",
                                    "readingOrder": 2,
                                    "markdown": {"text": "保卫处 68930010"},
                                },
                                {
                                    "blockType": "paragraph",
                                    "blockId": "p1-body-2",
                                    "readingOrder": 3,
                                    "markdown": {"text": "校医院 68933120"},
                                },
                            ]
                        }
                    }
                ],
            },
            "logId": "phone-directory-001",
        }
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode(
                "utf-8"
            )
        )


def _write_service_guide_source_truth_manifest(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "schema_version": "campus_services_service_guide_source_truth_manifest.v1",
                "target_corpus": "campus_services",
                "target_collection": "service_guide",
                "upstream_corpus": "regulations",
                "upstream_collection": "student_rules",
                "release_id_prefix": "service-guide-handbook",
                "effective_from": "2018-09-01T00:00:00+08:00",
                "effective_until": "2099-12-31T23:59:59+08:00",
                "expected_ready_records": 9,
                "curated_flow_graphs": [
                    {
                        "path": str(
                            Path(
                                "configs/ingestion/regulations/student_rules/curated-flow-graphs/"
                                "central-minzu-student-dormitory-management-workflow.v1.json"
                            ).resolve()
                        )
                    }
                ],
                "curated_service_guides": [
                    {
                        "path": str(
                            Path(
                                "configs/ingestion/regulations/student_rules/curated-service-guides/"
                                "central-minzu-student-public-medical.v1.json"
                            ).resolve()
                        )
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


class ProcessRawIngestionJobHandbookProjectionBaseTest(unittest.TestCase):
    pass


__all__ = [name for name in globals() if not name.startswith("__")]
