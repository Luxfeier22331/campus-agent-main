from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.internal_notice_selected_regulation_audit import (
    InternalNoticeSelectedRegulationCohortAuditReport,
    InternalNoticeSelectedRegulationCohortAuditRow,
)

worker = importlib.import_module(
    "campus_ingestion_worker.audit_internal_notice_regulation_selected_cohort"
)


class AuditInternalNoticeRegulationSelectedCohortWorkerTest(unittest.TestCase):
    def test_main_merges_selection_path_and_writes_audit_json(self) -> None:
        report = InternalNoticeSelectedRegulationCohortAuditReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            requested_notice_ids=("300001", "300002"),
            selected_notice_ids=("300001", "300002"),
            missing_projection_notice_ids=(),
            row_count=1,
            classification_counts={"full_text_candidate": 1},
            selected_import_notice_ids=("300001",),
            held_notice_ids=(),
            rows=(
                InternalNoticeSelectedRegulationCohortAuditRow(
                    notice_id="300001",
                    title="中央民族大学实验室安全管理规定",
                    source_url="https://portal.example.edu/notices/300001",
                    notice_release_time="2026-04-10",
                    attachment_ref_count=0,
                    attachment_document_count=0,
                    owner_expectation_count=0,
                    owner_expectation_kinds=(),
                    target_surfaces=("regulations/institutional_rules",),
                    consumption_statuses=("ready_for_target_materialization",),
                    source_document_ids=("notice:muc_internal_portal:300001",),
                    classification="full_text_candidate",
                    target_recommendation="regulations/institutional_rules",
                    stable_reason="target_ready",
                    import_eligible=True,
                ),
            ),
        )
        projection_store = object()
        inventory_store = object()

        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selected-notices.json"
            output_path = Path(temp_dir) / "audit.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["300001", "300002", "300001"]}),
                encoding="utf-8",
            )
            with (
                patch(
                    "campus_ingestion_worker.audit_internal_notice_regulation_selected_cohort.load_worker_env",
                    return_value={},
                ),
                patch(
                    "campus_ingestion_worker.audit_internal_notice_regulation_selected_cohort.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.audit_internal_notice_regulation_selected_cohort.build_authenticated_notice_source_truth_inventory_store_from_env",
                    return_value=inventory_store,
                ),
                patch(
                    "campus_ingestion_worker.audit_internal_notice_regulation_selected_cohort.build_internal_notice_regulation_promotion_manifest",
                    return_value=None,
                ) as build_manifest,
                patch(
                    "campus_ingestion_worker.audit_internal_notice_regulation_selected_cohort.build_internal_notice_selected_regulation_cohort_audit",
                    return_value=report,
                ) as build_audit,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--notice-id",
                        "300002",
                        "--selection-path",
                        str(selection_path),
                        "--output-json",
                        str(output_path),
                        "--without-promotion-manifest",
                    ]
                )

            build_manifest.assert_not_called()
            self.assertEqual(
                build_audit.call_args.kwargs["notice_ids"],
                ("300001", "300002"),
            )
            self.assertIs(build_audit.call_args.kwargs["projection_store"], projection_store)
            self.assertIs(
                build_audit.call_args.kwargs["source_truth_inventory_store"],
                inventory_store,
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["row_count"], 1)
            self.assertEqual(payload["selected_import_notice_ids"], ["300001"])
            self.assertEqual(
                json.loads(output_path.read_text(encoding="utf-8")),
                payload,
            )


if __name__ == "__main__":
    unittest.main()
