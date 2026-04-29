from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.internal_notice_regulation_owner_recovery import (
    InternalNoticeRegulationOwnerRecoveryReport,
    InternalNoticeRegulationOwnerRecoveryRow,
)
from campus_ingestion_core.internal_notice_selected_regulation_audit import (
    InternalNoticeSelectedRegulationCohortAuditReport,
)

worker = importlib.import_module(
    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery"
)


class BuildInternalNoticeRegulationOwnerRecoveryWorkerTest(unittest.TestCase):
    def test_main_builds_audit_then_writes_owner_recovery_outputs(self) -> None:
        audit_report = InternalNoticeSelectedRegulationCohortAuditReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            requested_notice_ids=("300011",),
            selected_notice_ids=("300011",),
            missing_projection_notice_ids=(),
            row_count=0,
            classification_counts={},
            selected_import_notice_ids=(),
            held_notice_ids=("300011",),
            rows=(),
        )
        recovery_report = InternalNoticeRegulationOwnerRecoveryReport(
            schema_version="internal_notice_regulation_owner_recovery_v1",
            source_corpus="campus_notices",
            source_collection="internal_notice",
            lookup_order=("captured_attachment", "authenticated_file_release"),
            requested_notice_ids=("300011",),
            row_count=1,
            ready_candidate_count=1,
            unresolved_count=0,
            ready_candidate_notice_ids=("300011",),
            unresolved_notice_ids=(),
            rows=(
                InternalNoticeRegulationOwnerRecoveryRow(
                    notice_id="300011",
                    title="关于《中央民族大学差旅费管理办法》发布实施的通知",
                    source_url="https://portal.example.edu/notices/300011",
                    owner_title_hint="中央民族大学差旅费管理办法",
                    classification="file_release_owner_candidate",
                    stable_reason="file_release_backed_regulation_body_missing",
                    status="ready",
                    reason=None,
                    selected_source_kind="authenticated_file_release",
                    selected_source_document_id="file_release:muc_internal_portal:647",
                    selected_source_corpus="campus_notices",
                    selected_source_collection="file_release_capture",
                    selected_source_uri="https://portal.example.edu/files/647/download",
                    source_backed_candidate=True,
                    import_eligible=True,
                    notice_card_preserved=True,
                    attempts=(),
                ),
            ),
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selection.json"
            output_dir = Path(temp_dir) / "owner-recovery"
            output_json = Path(temp_dir) / "owner-recovery.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["300011", "300011"]}),
                encoding="utf-8",
            )
            with (
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.load_worker_env",
                    return_value={},
                ),
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(bucket_derived="campus-rag-derived"),
                ),
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.S3ObjectStoreAdmin",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.build_notice_consumption_projection_store_from_env",
                    return_value=object(),
                ) as build_projection_store,
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.build_authenticated_notice_source_truth_inventory_store_from_env",
                    return_value=object(),
                ) as build_inventory_store,
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.build_document_registry_from_env",
                    return_value=object(),
                ) as build_registry,
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.build_authenticated_notice_file_release_inventory_store_from_env",
                    return_value=object(),
                ) as build_file_release_store,
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.build_internal_notice_regulation_promotion_manifest",
                    return_value=None,
                ) as build_promotion,
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.build_internal_notice_selected_regulation_cohort_audit",
                    return_value=audit_report,
                ) as build_audit,
                patch(
                    "campus_ingestion_worker.build_internal_notice_regulation_owner_recovery.build_internal_notice_regulation_owner_recovery_report",
                    return_value=recovery_report,
                ) as build_recovery,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--selection-path",
                        str(selection_path),
                        "--output-dir",
                        str(output_dir),
                        "--output-json",
                        str(output_json),
                        "--without-promotion-manifest",
                    ]
                )

            build_projection_store.assert_called_once()
            build_inventory_store.assert_called_once()
            build_registry.assert_called_once()
            build_file_release_store.assert_called_once()
            build_promotion.assert_not_called()
            self.assertEqual(build_audit.call_args.kwargs["notice_ids"], ("300011",))
            self.assertIs(build_recovery.call_args.kwargs["audit_report"], audit_report)
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["ready_candidate_notice_ids"], ["300011"])
            self.assertEqual(json.loads(output_json.read_text(encoding="utf-8")), payload)
            self.assertTrue((output_dir / "owner-recovery-report.json").is_file())
            self.assertTrue((output_dir / "owner-recovery-rows.jsonl").is_file())


if __name__ == "__main__":
    unittest.main()
