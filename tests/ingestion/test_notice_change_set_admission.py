from __future__ import annotations

import unittest

from campus_ingestion_core.notice_change_set_admission import (
    evaluate_transport_notice_change_set_admission,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_ANSWERABLE,
    NOTICE_ANSWERABILITY_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)


class NoticeChangeSetAdmissionTests(unittest.TestCase):
    def test_ready_transport_projection_is_answer_eligible_when_baseline_exists(self) -> None:
        decision = evaluate_transport_notice_change_set_admission(
            _entry(),
            official_baseline_available=True,
        )

        self.assertTrue(decision.answer_eligible)
        self.assertEqual(decision.admission_state, "answer_eligible")
        self.assertEqual(decision.reason_codes, ())

    def test_missing_baseline_blocks_answer_eligibility(self) -> None:
        decision = evaluate_transport_notice_change_set_admission(
            _entry(),
            official_baseline_available=False,
        )

        self.assertFalse(decision.answer_eligible)
        self.assertEqual(decision.admission_state, "missing_baseline")
        self.assertEqual(decision.reason_codes, ("transport_baseline_missing",))

    def test_searchable_only_notice_is_not_promoted_to_change_set(self) -> None:
        decision = evaluate_transport_notice_change_set_admission(
            _entry(
                target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                completeness_status=NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
                answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
                role_metadata={},
            ),
            official_baseline_available=False,
        )

        self.assertFalse(decision.answer_eligible)
        self.assertEqual(decision.admission_state, "searchable_only")
        self.assertEqual(decision.reason_codes, ("notice_searchable_only",))

    def test_incomplete_media_blocks_answer_eligibility(self) -> None:
        decision = evaluate_transport_notice_change_set_admission(
            _entry(completeness_status=NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING),
            official_baseline_available=True,
        )

        self.assertFalse(decision.answer_eligible)
        self.assertEqual(decision.admission_state, "missing_evidence")
        self.assertEqual(decision.reason_codes, ("notice_media_evidence_incomplete",))

    def test_missing_title_or_url_blocks_source_ref_gate(self) -> None:
        decision = evaluate_transport_notice_change_set_admission(
            _entry(
                role_metadata={
                    "notice_title": "",
                    "service_status_candidate_kind": "transport_schedule",
                }
            ),
            official_baseline_available=True,
        )

        self.assertFalse(decision.answer_eligible)
        self.assertEqual(decision.admission_state, "missing_evidence")
        self.assertEqual(decision.reason_codes, ("notice_source_ref_missing",))

    def test_source_title_and_url_can_come_from_read_model_context(self) -> None:
        decision = evaluate_transport_notice_change_set_admission(
            _entry(role_metadata={"service_status_candidate_kind": "transport_schedule"}),
            official_baseline_available=True,
            source_title="关于两校区学生通勤班车增加班次的通知",
            source_url="https://example.edu/notice/355122",
        )

        self.assertTrue(decision.answer_eligible)
        self.assertEqual(decision.admission_state, "answer_eligible")

    def test_non_transport_candidate_is_unsupported(self) -> None:
        decision = evaluate_transport_notice_change_set_admission(
            _entry(
                role_metadata={
                    "notice_title": "图书馆开放时间调整通知",
                    "source_url": "https://example.edu/library",
                    "service_status_candidate_kind": "service_status",
                }
            ),
            official_baseline_available=True,
        )

        self.assertFalse(decision.answer_eligible)
        self.assertEqual(decision.admission_state, "unsupported")
        self.assertEqual(decision.reason_codes, ("transport_change_unsupported",))

    def test_reference_only_projection_is_unsupported(self) -> None:
        decision = evaluate_transport_notice_change_set_admission(
            _entry(answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY),
            official_baseline_available=True,
        )

        self.assertFalse(decision.answer_eligible)
        self.assertEqual(decision.admission_state, "unsupported")
        self.assertEqual(decision.reason_codes, ("transport_change_unsupported",))


def _entry(
    *,
    target_surface: str = NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    consumption_status: str = NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    completeness_status: str = NOTICE_COMPLETENESS_COMPLETE,
    answerability: str = NOTICE_ANSWERABILITY_ANSWERABLE,
    role_metadata: dict[str, object] | None = None,
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id="355122",
        unit_id="notice_unit:muc_internal_portal:355122:transport_schedule",
        primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE
        if target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        else NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
        semantic_owner="notice_body",
        default_agent="campus-services-agent",
        target_surface=target_surface,
        temporal_policy="current_override",
        completeness_status=completeness_status,
        answerability=answerability,
        consumption_status=consumption_status,
        source_notice_document_id="notice:muc_internal_portal:355122",
        source_document_id="notice:muc_internal_portal:355122",
        source_notice_release_time="2026-03-18T09:00:00+08:00",
        role_metadata=role_metadata
        if role_metadata is not None
        else {
            "notice_title": "关于两校区学生通勤班车增加班次的通知",
            "source_url": "https://example.edu/notice/355122",
            "service_status_candidate_kind": "transport_schedule",
        },
    )


if __name__ == "__main__":
    unittest.main()
