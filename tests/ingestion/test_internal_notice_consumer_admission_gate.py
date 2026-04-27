from __future__ import annotations

import unittest

from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
    CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH,
    CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST,
    CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED,
    CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION,
    CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_DECISION_ADMIT,
    CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
    ConsumerAdmissionDecisionRecord,
    InternalNoticeConsumerAdmissionManifest,
    compute_consumer_admission_selection_sha256,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
)


class InternalNoticeConsumerAdmissionGateTest(unittest.TestCase):
    def test_gate_blocks_missing_manifest_for_read_model_rebuild(self) -> None:
        report = check_internal_notice_consumer_admission_gate(
            manifest=None,
            request=ConsumerAdmissionGateRequest(
                operation=CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
                source_corpus="campus_notices",
                source_collection="internal_notice",
                selected_notice_ids=("355119",),
                scope_write_mode="upsert_selected",
            ),
        )

        self.assertEqual(report.verdict, "block")
        self.assertIn(CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST, report.reason_codes)

    def test_gate_blocks_id_mismatch(self) -> None:
        report = check_internal_notice_consumer_admission_gate(
            manifest=_manifest(("355119",)),
            request=ConsumerAdmissionGateRequest(
                operation=CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
                source_corpus="campus_notices",
                source_collection="internal_notice",
                selected_notice_ids=("355120",),
                scope_write_mode="upsert_selected",
            ),
        )

        self.assertEqual(report.verdict, "block")
        self.assertIn(CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH, report.reason_codes)

    def test_gate_blocks_non_notice_level_read_model_surface(self) -> None:
        report = check_internal_notice_consumer_admission_gate(
            manifest=_manifest(
                ("355119",),
                target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
            ),
            request=ConsumerAdmissionGateRequest(
                operation=CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
                source_corpus="campus_notices",
                source_collection="internal_notice",
                selected_notice_ids=("355119",),
                scope_write_mode="upsert_selected",
            ),
        )

        self.assertEqual(report.verdict, "block")
        self.assertIn(
            CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION,
            report.reason_codes,
        )

    def test_gate_blocks_replace_scope_without_manifest_authorization(self) -> None:
        report = check_internal_notice_consumer_admission_gate(
            manifest=_manifest(("355119",)),
            request=ConsumerAdmissionGateRequest(
                operation=CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
                source_corpus="campus_notices",
                source_collection="internal_notice",
                selected_notice_ids=("355119",),
                scope_write_mode=CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
            ),
        )

        self.assertEqual(report.verdict, "block")
        self.assertIn(
            CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED,
            report.reason_codes,
        )

    def test_gate_blocks_threshold_breach(self) -> None:
        report = check_internal_notice_consumer_admission_gate(
            manifest=_manifest(("355119",), body_quality="empty_body"),
            request=ConsumerAdmissionGateRequest(
                operation=CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
                source_corpus="campus_notices",
                source_collection="internal_notice",
                selected_notice_ids=("355119",),
                max_empty_body_count=0,
            ),
        )

        self.assertEqual(report.verdict, "block")
        self.assertIn(CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH, report.reason_codes)


def _manifest(
    notice_ids: tuple[str, ...],
    *,
    target_surface: str = NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    body_quality: str = "body_present",
) -> InternalNoticeConsumerAdmissionManifest:
    return InternalNoticeConsumerAdmissionManifest(
        admission_run_id="consumer-admission-001",
        source_channel="authenticated_notice_portal",
        corpus="campus_notices",
        collection="internal_notice",
        selection_source="bundle_dry_run",
        selection_path="bundle.json",
        selection_sha256=compute_consumer_admission_selection_sha256(notice_ids),
        scope_write_mode="upsert_selected",
        selected_notice_ids=notice_ids,
        decision_records=tuple(
            ConsumerAdmissionDecisionRecord(
                notice_id=notice_id,
                source_notice_id=notice_id,
                site_id="muc_internal_portal",
                raw_asset_id=f"asset:authenticated-notice:muc_internal_portal:{notice_id}",
                raw_version_id=f"sha256:raw-{notice_id}",
                notice_family="course_teaching_arrangement",
                suggested_consumption_route="notice_level_query",
                target_surface=target_surface,
                consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                admission_decision=CONSUMER_ADMISSION_DECISION_ADMIT,
                admission_reason_codes=("notice_level_query",),
                body_quality=body_quality,
                attachment_ref_count=0,
                reference_only_attachment_ref_count=0,
                owner_expectation_count=0,
                pending_multimodal_attachment_count=0,
            )
            for notice_id in notice_ids
        ),
        created_at="2026-04-27T00:00:00+00:00",
    )


if __name__ == "__main__":
    unittest.main()
