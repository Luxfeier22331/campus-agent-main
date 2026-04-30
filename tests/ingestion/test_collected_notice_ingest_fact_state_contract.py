from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_fact_state_contract import (
    TARGET_ADMISSION_STATES,
    validate_fact_state_payload,
)


class CollectedNoticeIngestFactStateContractTests(unittest.TestCase):
    def test_contract_accepts_stage_ready_text_fact_with_supplemental_pending_media(
        self,
    ) -> None:
        payload = {
            "schema_version": "notice_ingest_fact_state.v1",
            "target": "transport_schedule",
            "source_unit_state": "searchable_ready",
            "fact_readiness_state": "ready_from_text",
            "target_admission_state": "stage_ready",
            "required_fact_groups": ["route", "service_window", "departure_time"],
            "ready_fact_groups": ["route", "service_window", "departure_time"],
            "missing_fact_groups": [],
            "reason_codes": ["body_facts_complete", "supplemental_media_pending"],
            "media_states": [
                {
                    "media_role": "supplemental_location_visual",
                    "media_state": "pending",
                    "target_blocking": False,
                }
            ],
            "blocking_media": [],
            "provenance": {"source_notice_id": "355881"},
        }

        validate_fact_state_payload(payload)
        self.assertIn("stage_ready", TARGET_ADMISSION_STATES)

    def test_contract_rejects_unknown_target_admission_state(self) -> None:
        with self.assertRaises(ValueError):
            validate_fact_state_payload(
                {
                    "schema_version": "notice_ingest_fact_state.v1",
                    "target": "transport_schedule",
                    "source_unit_state": "searchable_ready",
                    "fact_readiness_state": "ready_from_text",
                    "target_admission_state": "ready-ish",
                    "required_fact_groups": [],
                    "ready_fact_groups": [],
                    "missing_fact_groups": [],
                    "reason_codes": [],
                    "media_states": [],
                    "blocking_media": [],
                    "provenance": {},
                }
            )

    def test_contract_rejects_needs_multimodal_without_blocking_media(self) -> None:
        payload = _payload(
            fact_readiness_state="blocked_by_required_media",
            target_admission_state="needs_multimodal",
            media_states=[
                {
                    "media_role": "schedule_table_carrier",
                    "media_state": "pending",
                    "target_blocking": False,
                }
            ],
            blocking_media=[],
        )

        with self.assertRaisesRegex(ValueError, "needs_multimodal requires blocking_media"):
            validate_fact_state_payload(payload)

    def test_contract_rejects_stage_ready_with_blocking_media(self) -> None:
        blocking_media = [
            {
                "media_role": "schedule_table_carrier",
                "media_state": "pending",
                "target_blocking": True,
            }
        ]
        payload = _payload(
            fact_readiness_state="ready_from_text",
            target_admission_state="stage_ready",
            media_states=blocking_media,
            blocking_media=blocking_media,
        )

        with self.assertRaisesRegex(ValueError, "stage_ready must not include blocking_media"):
            validate_fact_state_payload(payload)


def _payload(
    *,
    fact_readiness_state: str,
    target_admission_state: str,
    media_states: list[dict[str, object]],
    blocking_media: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "schema_version": "notice_ingest_fact_state.v1",
        "target": "transport_schedule",
        "source_unit_state": "searchable_ready",
        "fact_readiness_state": fact_readiness_state,
        "target_admission_state": target_admission_state,
        "required_fact_groups": ["route", "service_window", "departure_time"],
        "ready_fact_groups": [],
        "missing_fact_groups": ["route", "service_window", "departure_time"],
        "reason_codes": ["required_media_pending"],
        "media_states": media_states,
        "blocking_media": blocking_media,
        "provenance": {"source_notice_id": "355867"},
    }


if __name__ == "__main__":
    unittest.main()
