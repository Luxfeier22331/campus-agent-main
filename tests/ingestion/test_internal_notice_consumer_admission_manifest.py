from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_DECISION_ADMIT,
    CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION,
    CONSUMER_ADMISSION_POLICY_VERSION,
    CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
    ConsumerAdmissionDecisionRecord,
    InternalNoticeConsumerAdmissionManifest,
    compute_consumer_admission_selection_sha256,
    load_internal_notice_consumer_admission_manifest,
    validate_internal_notice_consumer_admission_manifest,
    write_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
)


class InternalNoticeConsumerAdmissionManifestTest(unittest.TestCase):
    def test_manifest_round_trips_with_stable_selection_hash(self) -> None:
        first_hash = compute_consumer_admission_selection_sha256(("355120", "355119"))
        second_hash = compute_consumer_admission_selection_sha256(("355119", "355120"))
        self.assertEqual(first_hash, second_hash)

        manifest = InternalNoticeConsumerAdmissionManifest(
            admission_run_id="consumer-admission-001",
            source_channel="authenticated_notice_portal",
            corpus="campus_notices",
            collection="internal_notice",
            selection_source="bundle_dry_run",
            selection_path="bundle.json",
            selection_sha256=first_hash,
            scope_write_mode="upsert_selected",
            selected_notice_ids=("355119", "355120"),
            decision_records=(
                ConsumerAdmissionDecisionRecord(
                    notice_id="355119",
                    source_notice_id="355119",
                    site_id="muc_internal_portal",
                    raw_asset_id="asset:authenticated-notice:muc_internal_portal:355119",
                    raw_version_id="sha256:raw-355119",
                    notice_family="facility_service_status",
                    suggested_consumption_route="service_status_candidate",
                    target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
                    consumption_status=(
                        CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION
                    ),
                    admission_decision=CONSUMER_ADMISSION_DECISION_ADMIT,
                    admission_reason_codes=("service_status_candidate",),
                    body_quality="body_present",
                    attachment_ref_count=1,
                    reference_only_attachment_ref_count=0,
                    owner_expectation_count=0,
                    pending_multimodal_attachment_count=0,
                ),
                ConsumerAdmissionDecisionRecord(
                    notice_id="355120",
                    source_notice_id="355120",
                    site_id="muc_internal_portal",
                    raw_asset_id="asset:authenticated-notice:muc_internal_portal:355120",
                    raw_version_id="sha256:raw-355120",
                    notice_family="facility_service_status",
                    suggested_consumption_route="service_status_candidate",
                    target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
                    consumption_status=(
                        CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION
                    ),
                    admission_decision=CONSUMER_ADMISSION_DECISION_ADMIT,
                    admission_reason_codes=("service_status_candidate",),
                    body_quality="body_present",
                    attachment_ref_count=0,
                    reference_only_attachment_ref_count=0,
                    owner_expectation_count=0,
                    pending_multimodal_attachment_count=0,
                ),
            ),
            decision_counts={
                CONSUMER_ADMISSION_DECISION_ADMIT: 2,
                NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE: 2,
            },
            created_at="2026-04-27T00:00:00+00:00",
        )

        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "consumer-admission-manifest.json"
            write_internal_notice_consumer_admission_manifest(path, manifest)
            payload = json.loads(path.read_text(encoding="utf-8"))
            loaded = load_internal_notice_consumer_admission_manifest(path)

        self.assertEqual(
            payload["schema_version"],
            CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION,
        )
        self.assertEqual(payload["policy_version"], CONSUMER_ADMISSION_POLICY_VERSION)
        self.assertEqual(loaded.selected_notice_ids, ("355119", "355120"))
        self.assertEqual(
            loaded.decision_records[0].consumption_status,
            CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
        )

    def test_validation_rejects_duplicate_decision_notice_ids(self) -> None:
        record = ConsumerAdmissionDecisionRecord(
            notice_id="355119",
            source_notice_id="355119",
            site_id="muc_internal_portal",
            raw_asset_id="asset:authenticated-notice:muc_internal_portal:355119",
            raw_version_id="sha256:raw-355119",
            notice_family="course_teaching_arrangement",
            suggested_consumption_route="notice_level_query",
            target_surface="notice_level_query",
            consumption_status="retained_for_notice_query",
            admission_decision=CONSUMER_ADMISSION_DECISION_ADMIT,
            admission_reason_codes=("notice_level_query",),
            body_quality="body_present",
            attachment_ref_count=0,
            reference_only_attachment_ref_count=0,
            owner_expectation_count=0,
            pending_multimodal_attachment_count=0,
        )
        manifest = InternalNoticeConsumerAdmissionManifest(
            admission_run_id="consumer-admission-001",
            source_channel="authenticated_notice_portal",
            corpus="campus_notices",
            collection="internal_notice",
            selection_source="bundle_dry_run",
            selection_path="bundle.json",
            selection_sha256=compute_consumer_admission_selection_sha256(("355119",)),
            scope_write_mode="upsert_selected",
            selected_notice_ids=("355119",),
            decision_records=(record, record),
            created_at="2026-04-27T00:00:00+00:00",
        )

        with self.assertRaisesRegex(ValueError, "duplicate decision notice_id"):
            validate_internal_notice_consumer_admission_manifest(manifest)

    def test_validation_accepts_regulation_family_target_surface(self) -> None:
        manifest = InternalNoticeConsumerAdmissionManifest(
            admission_run_id="consumer-admission-regulation",
            source_channel="authenticated_notice_portal",
            corpus="campus_notices",
            collection="internal_notice",
            selection_source="regulation_document_site_dry_run",
            selection_path="355119",
            selection_sha256=compute_consumer_admission_selection_sha256(("355119",)),
            scope_write_mode="upsert_selected",
            selected_notice_ids=("355119",),
            decision_records=(
                ConsumerAdmissionDecisionRecord(
                    notice_id="355119",
                    source_notice_id="355119",
                    site_id="muc_internal_portal",
                    raw_asset_id="asset:authenticated-notice:muc_internal_portal:355119",
                    raw_version_id="sha256:raw-355119",
                    notice_family="policy_regulation",
                    suggested_consumption_route="regulation_candidate",
                    target_surface=NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
                    consumption_status=(
                        CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION
                    ),
                    admission_decision=CONSUMER_ADMISSION_DECISION_ADMIT,
                    admission_reason_codes=("regulation_candidate",),
                    body_quality="body_present",
                    attachment_ref_count=0,
                    reference_only_attachment_ref_count=0,
                    owner_expectation_count=0,
                    pending_multimodal_attachment_count=0,
                ),
            ),
            created_at="2026-04-28T00:00:00+00:00",
        )

        validate_internal_notice_consumer_admission_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
