from __future__ import annotations

import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from .official_web_projection_chunking_audit_test_support import (
    OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION,
    OfficialWebProjectionChunkingAuditDocumentReport,
    OfficialWebProjectionChunkingAuditReport,
    worker,
)


class OfficialWebProjectionChunkingAuditWorkerCliTest(unittest.TestCase):
    def test_main_prints_audit_report_as_json(self) -> None:
        report = OfficialWebProjectionChunkingAuditReport(
            schema_version=OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION,
            projection_output_dir="/tmp/projection-output",
            passed=False,
            document_count=1,
            total_units=3,
            total_chunks=3,
            issue_counts={"collapsed_section_path": 1},
            documents=(
                OfficialWebProjectionChunkingAuditDocumentReport(
                    document_id="official_web:muc_public:generic_content_page:doc-001",
                    title="中央民族大学新闻网",
                    target_corpus="official_web",
                    target_collection="muc_public_pages",
                    normalized_canonical_url="https://news.muc.edu.cn/",
                    page_family="generic_content_page",
                    unit_count=3,
                    chunk_count=3,
                    distinct_section_path_count=1,
                    token_summary={"min": 10, "max": 20, "avg": 15.0, "median": 15},
                    short_chunk_count=1,
                    stacked_short_label_unit_count=1,
                    ellipsis_unit_count=0,
                    issue_codes=("collapsed_section_path",),
                    examples=(),
                ),
            ),
        )
        with (
            patch("campus_ingestion_worker.audit_official_web_projection_chunking.load_worker_env"),
            patch(
                "campus_ingestion_worker.audit_official_web_projection_chunking.audit_official_web_projection_chunking"
            ) as audit_projection,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            audit_projection.return_value = report
            worker.main(["--projection-output-dir", "/tmp/projection-output"])

        self.assertEqual(
            Path(audit_projection.call_args.kwargs["projection_output_dir"]),
            Path("/tmp/projection-output").resolve(),
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["issue_counts"]["collapsed_section_path"], 1)
        self.assertEqual(
            payload["documents"][0]["document_id"],
            "official_web:muc_public:generic_content_page:doc-001",
        )
