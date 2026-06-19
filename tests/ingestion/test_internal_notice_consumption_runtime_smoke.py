from __future__ import annotations

import unittest
from dataclasses import dataclass

from campus_ingestion_core.internal_notice_consumption_admission import (
    InMemoryInternalNoticeConsumptionAdmissionStore,
    InternalNoticeConsumptionAdmissionRecord,
)
from campus_ingestion_core.internal_notice_consumption_runtime_smoke import (
    run_internal_notice_consumption_runtime_smoke,
)
from campus_ingestion_core.internal_notice_multimodal_processing import (
    InMemoryInternalNoticeMultimodalAttemptStore,
    InternalNoticeMultimodalAttempt,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)


class InternalNoticeConsumptionRuntimeSmokeTest(unittest.TestCase):
    def test_runtime_smoke_reports_projection_admission_attempt_and_read_model_state(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    "351907",
                    "notice_unit:351907:notice_window",
                    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    admission_batch_id="batch-projection-001",
                ),
                _entry(
                    "351907",
                    "notice_unit:351907:pending_multimodal",
                    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
                    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
                    admission_batch_id="batch-projection-001",
                ),
            )
        )
        read_model_store = _ReadModelStore(
            (_ReadModelRow(unit_id="notice_unit:351907:notice_window"),)
        )
        admission_store = InMemoryInternalNoticeConsumptionAdmissionStore(
            (
                InternalNoticeConsumptionAdmissionRecord(
                    batch_id="batch-projection-001",
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    command="projection_rebuild",
                    selected_notice_ids=("351907",),
                    status="completed",
                    result_counts={"projection_entry_count": 2},
                    created_at="2026-04-25T00:00:00Z",
                ),
            )
        )
        attempt_store = InMemoryInternalNoticeMultimodalAttemptStore(
            (
                InternalNoticeMultimodalAttempt(
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    source_notice_id="351907",
                    unit_id="notice_unit:351907:pending_multimodal",
                    attempt_number=1,
                    admission_batch_id="batch-multimodal-001",
                    model="gpt-4.1-mini",
                    decision_action="needs_additional_processing",
                    status="processed",
                    reasons=("low_visual_confidence",),
                    created_at="2026-04-25T00:00:00Z",
                ),
            )
        )

        report = run_internal_notice_consumption_runtime_smoke(
            notice_ids=("351907",),
            projection_store=projection_store,
            read_model_store=read_model_store,
            admission_store=admission_store,
            attempt_store=attempt_store,
        )

        self.assertTrue(report.ok)
        self.assertEqual(report.projection_entry_count, 2)
        self.assertEqual(report.admission_batch_count, 1)
        self.assertEqual(report.multimodal_attempt_count, 1)
        self.assertEqual(report.pending_multimodal_processing_count, 1)
        self.assertEqual(report.projection_entries_missing_admission_count, 0)
        self.assertEqual(report.pending_multimodal_without_attempt_count, 0)

    def test_runtime_smoke_fails_when_projection_lacks_admission_provenance(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    "351907",
                    "notice_unit:351907:notice_window",
                    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                ),
            )
        )
        read_model_store = _ReadModelStore(
            (_ReadModelRow(unit_id="notice_unit:351907:notice_window"),)
        )
        admission_store = InMemoryInternalNoticeConsumptionAdmissionStore(
            (
                InternalNoticeConsumptionAdmissionRecord(
                    batch_id="batch-projection-001",
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    command="projection_rebuild",
                    selected_notice_ids=("351907",),
                    status="completed",
                    result_counts={"projection_entry_count": 1},
                    created_at="2026-04-25T00:00:00Z",
                ),
            )
        )

        report = run_internal_notice_consumption_runtime_smoke(
            notice_ids=("351907",),
            projection_store=projection_store,
            read_model_store=read_model_store,
            admission_store=admission_store,
            attempt_store=InMemoryInternalNoticeMultimodalAttemptStore(),
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.projection_entries_missing_admission_count, 1)

    def test_runtime_smoke_requires_attempts_for_pending_multimodal_entries(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    "351907",
                    "notice_unit:351907:pending_multimodal",
                    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
                    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
                    admission_batch_id="batch-projection-001",
                ),
            )
        )
        admission_store = InMemoryInternalNoticeConsumptionAdmissionStore(
            (
                InternalNoticeConsumptionAdmissionRecord(
                    batch_id="batch-projection-001",
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    command="projection_rebuild",
                    selected_notice_ids=("351907",),
                    status="completed",
                    result_counts={"projection_entry_count": 1},
                    created_at="2026-04-25T00:00:00Z",
                ),
            )
        )

        report = run_internal_notice_consumption_runtime_smoke(
            notice_ids=("351907",),
            projection_store=projection_store,
            read_model_store=_ReadModelStore(()),
            admission_store=admission_store,
            attempt_store=InMemoryInternalNoticeMultimodalAttemptStore(),
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.pending_multimodal_without_attempt_count, 1)

    def test_runtime_smoke_can_check_multimodal_runtime_with_injected_checker(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    "351907",
                    "notice_unit:351907:notice_window",
                    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    admission_batch_id="batch-projection-001",
                ),
            )
        )
        admission_store = InMemoryInternalNoticeConsumptionAdmissionStore(
            (
                InternalNoticeConsumptionAdmissionRecord(
                    batch_id="batch-projection-001",
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    command="projection_rebuild",
                    selected_notice_ids=("351907",),
                    status="completed",
                    result_counts={"projection_entry_count": 1},
                    created_at="2026-04-25T00:00:00Z",
                ),
            )
        )

        report = run_internal_notice_consumption_runtime_smoke(
            notice_ids=("351907",),
            projection_store=projection_store,
            read_model_store=_ReadModelStore(
                (_ReadModelRow(unit_id="notice_unit:351907:notice_window"),)
            ),
            admission_store=admission_store,
            attempt_store=InMemoryInternalNoticeMultimodalAttemptStore(),
            env={"INTERNAL_NOTICE_MULTIMODAL_API_KEY": "notice-multimodal-key"},
            check_multimodal_runtime=True,
            multimodal_runtime_checker=lambda env: (
                False,
                env["INTERNAL_NOTICE_MULTIMODAL_API_KEY"],
            ),
        )

        self.assertFalse(report.ok)
        self.assertTrue(report.multimodal_runtime_checked)
        self.assertFalse(report.multimodal_runtime_ok)
        self.assertEqual(report.multimodal_runtime_error, "notice-multimodal-key")


@dataclass(frozen=True, slots=True)
class _ReadModelRow:
    unit_id: str


class _ReadModelStore:
    def __init__(self, rows: tuple[_ReadModelRow, ...]) -> None:
        self.rows = rows

    def list_by_scope(self, *args, **kwargs) -> tuple[_ReadModelRow, ...]:
        return self.rows


def _entry(
    notice_id: str,
    unit_id: str,
    target_surface: str,
    consumption_status: str,
    *,
    admission_batch_id: str = "",
) -> NoticeConsumptionProjectionEntry:
    role_metadata = (
        {"consumer_admission_batch_id": admission_batch_id} if admission_batch_id else {}
    )
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=unit_id,
        primary_role="notice_window",
        semantic_owner="notice_body",
        default_agent="notice",
        target_surface=target_surface,
        temporal_policy="announcement_window",
        completeness_status="complete",
        answerability="answerable",
        consumption_status=consumption_status,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        role_metadata=role_metadata,
    )


if __name__ == "__main__":
    unittest.main()
