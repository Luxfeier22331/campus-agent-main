# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_collected_notice_media_closeout_state_machine_audit_support import *


class CollectedNoticeMediaCloseoutStateMachineAuditTestsPart02(unittest.TestCase):
    def test_audit_fails_cleanup_report_without_protected_active_object(self) -> None:
        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="pending",
                        retry_budget_remaining=2,
                        source_key="objects/schedule.png",
                    )
                ]
            },
            cleanup_report=_cleanup_report(protected_keys=()),
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"cleanup_report_missing_active_blocking_quarantine_object": 1},
        )

    def test_audit_does_not_require_cleanup_protection_for_permanent_source_truth_candidate(
        self,
    ) -> None:
        inventory = _candidate_inventory()
        candidate = inventory["candidates"][0]  # type: ignore[index]
        candidate["media_kind"] = "pdf"
        candidate["processing_family"] = "released_file_text_extraction"
        candidate["attachment_ref"] = {
            "retention_class": "permanent_source_truth",
            "attachment_capture_policy": "fetch_required_for_source_truth",
        }

        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=inventory,
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="pending",
                        retry_budget_remaining=2,
                        source_key="objects/schedule.png",
                    )
                ]
            },
            cleanup_report=_cleanup_report(protected_keys=()),
            strict_gate=False,
        )

        self.assertEqual(audit["verdict"], "passed")
        self.assertEqual(audit["finding_count"], 0)

    def test_audit_fails_cleanup_report_with_matching_key_wrong_bucket(self) -> None:
        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="pending",
                        retry_budget_remaining=2,
                        source_key="objects/schedule.png",
                    )
                ]
            },
            cleanup_report={
                "dry_run_objects": [],
                "blocked_quarantine_objects": [
                    {"bucket": "other-bucket", "object_key": "objects/schedule.png"}
                ],
            },
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"cleanup_report_missing_active_blocking_quarantine_object": 1},
        )

    def test_audit_accepts_cleanup_summary_with_blocked_inventory_rows(self) -> None:
        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="pending",
                        retry_budget_remaining=2,
                        source_key="objects/schedule.png",
                    )
                ]
            },
            cleanup_report={
                "blocked_quarantine_inventory_rows": [
                    {"bucket": "campus-rag-source", "object_key": "objects/schedule.png"}
                ]
            },
            strict_gate=False,
        )

        self.assertEqual(audit["verdict"], "passed")
        self.assertEqual(audit["finding_count"], 0)


if __name__ == "__main__":
    unittest.main()
