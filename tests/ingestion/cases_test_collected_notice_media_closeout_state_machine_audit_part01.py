# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_collected_notice_media_closeout_state_machine_audit_support import *


class CollectedNoticeMediaCloseoutStateMachineAuditTestsPart01(unittest.TestCase):
    def test_attempt_ledger_enriches_attempt_plan_with_candidate_source_ref(self) -> None:
        ledger = build_media_extraction_attempt_ledger(
            candidate_inventory=_candidate_inventory(),
            attempt_plan={
                "attempts": [
                    {
                        "candidate_id": "candidate:schedule",
                        "unit_id": "unit:355867",
                        "source_notice_id": "355867",
                        "media_ref_id": "attachment-0001",
                        "processing_family": "schedule_image_ocr",
                        "state": "pending",
                        "attempt_number": 1,
                        "normalized_output_refs": {"plain_text": {"key": "ocr.txt"}},
                    }
                ]
            },
            generated_at="2026-05-01T00:00:00+08:00",
        )

        attempt = ledger["attempts"][0]
        self.assertEqual(attempt["status"], "pending")
        self.assertEqual(attempt["candidate_id"], "candidate:schedule")
        self.assertEqual(attempt["source_object_ref"]["key"], "objects/schedule.png")
        self.assertEqual(attempt["source_object_hash"], "a" * 64)
        self.assertEqual(attempt["retry_policy"]["max_attempts"], 3)
        self.assertEqual(attempt["retry_budget_remaining"], 2)
        self.assertEqual(attempt["output_refs"]["plain_text"]["key"], "ocr.txt")

    def test_attempt_ledger_rejects_orphan_attempt_plan_row(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown candidate_id"):
            build_media_extraction_attempt_ledger(
                candidate_inventory=_candidate_inventory(),
                attempt_plan={
                    "attempts": [
                        {
                            "candidate_id": "candidate:missing",
                            "state": "pending",
                        }
                    ]
                },
                generated_at="2026-05-01T00:00:00+08:00",
            )

    def test_audit_passes_pending_blocker_when_attempt_ledger_exists(self) -> None:
        candidate_inventory = _candidate_inventory()
        attempt_ledger = {
            "attempts": [
                _attempt(
                    "candidate:schedule",
                    status="pending",
                    retry_budget_remaining=2,
                    source_key="objects/schedule.png",
                )
            ]
        }

        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=candidate_inventory,
            attempt_ledger=attempt_ledger,
            strict_gate=False,
        )

        self.assertEqual(audit["verdict"], "passed")
        self.assertEqual(audit["finding_count"], 0)

    def test_strict_audit_fails_when_required_gate_inputs_are_missing(self) -> None:
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
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {
                "strict_gate_missing_cleanup_report": 1,
                "strict_gate_missing_closeout_candidate_inventory": 1,
                "strict_gate_missing_object_verification_report": 1,
                "strict_gate_missing_target_admission_manifest": 1,
            },
        )

    def test_strict_audit_passes_with_full_nonterminal_gate_inputs(self) -> None:
        candidate_inventory = _candidate_inventory()
        attempt_ledger = {
            "attempts": [
                _attempt(
                    "candidate:schedule",
                    status="pending",
                    retry_budget_remaining=2,
                    source_key="objects/schedule.png",
                    source_hash="a" * 64,
                )
            ]
        }

        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=candidate_inventory,
            attempt_ledger=attempt_ledger,
            closeout_candidate_inventory=candidate_inventory,
            target_admission_manifests=[_target_admission_manifest("needs_multimodal")],
            cleanup_report=_cleanup_report(protected_keys=("objects/schedule.png",)),
            object_verification_report=_object_verification_report(source_hash="a" * 64),
        )

        self.assertEqual(audit["verdict"], "passed")
        self.assertEqual(audit["finding_count"], 0)

    def test_audit_fails_object_verification_without_live_check_method(self) -> None:
        report = _object_verification_report(source_hash="a" * 64)
        row = report["rows"][0]  # type: ignore[index]
        row.pop("check_method", None)  # type: ignore[union-attr]

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
            object_verification_report=report,
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"candidate_source_object_verification_not_live_checked": 1},
        )

    def test_audit_fails_target_manifest_without_fact_readiness_fields(self) -> None:
        manifest = _target_admission_manifest("needs_multimodal")
        entry = manifest["entries"][0]  # type: ignore[index]
        entry.pop("fact_readiness_state", None)  # type: ignore[union-attr]
        entry.pop("required_fact_groups", None)  # type: ignore[union-attr]

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
            closeout_candidate_inventory=_candidate_inventory(),
            target_admission_manifests=[manifest],
            cleanup_report=_cleanup_report(protected_keys=("objects/schedule.png",)),
            object_verification_report=_object_verification_report(source_hash="a" * 64),
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {
                "target_admission_manifest_missing_fact_readiness_state": 1,
                "target_admission_manifest_missing_required_fact_groups": 1,
            },
        )

    def test_audit_fails_target_blocking_candidate_without_attempt(self) -> None:
        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            attempt_ledger={"attempts": []},
            strict_gate=False,
        )

        self.assertEqual(audit["verdict"], "failed")
        self.assertEqual(
            audit["finding_counts_by_code"],
            {"target_blocking_candidate_without_attempt_ledger": 1},
        )

    def test_audit_fails_retryable_attempt_without_retry_budget(self) -> None:
        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="failed_retryable",
                        retry_budget_remaining=0,
                        next_retry_after="",
                        source_key="objects/schedule.png",
                    )
                ]
            },
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"failed_retryable_attempt_without_retry_budget": 1},
        )

    def test_audit_fails_completed_closeout_without_output_refs(self) -> None:
        closeout_inventory = _candidate_inventory()
        closeout_inventory["candidates"][0]["status"] = "completed"  # type: ignore[index]
        closeout_inventory["candidates"][0]["media_text_status"] = "completed"  # type: ignore[index]
        closeout_inventory["candidates"][0]["target_blocking"] = False  # type: ignore[index]
        closeout_inventory["candidates"][0].pop("completed_output_refs", None)  # type: ignore[index]

        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            closeout_candidate_inventory=closeout_inventory,
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="completed",
                        source_key="objects/schedule.png",
                    )
                ]
            },
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"completed_closeout_candidate_without_output_refs": 1},
        )

    def test_audit_fails_admission_ready_with_nonterminal_blocker(self) -> None:
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
            target_admission_manifests=[
                {
                    "entries": [
                        {
                            "searchable_unit_id": "unit:355867",
                            "source_notice_id": "355867",
                            "target_surface": "transport_schedule",
                            "consumption_class": "ready_for_target",
                        }
                    ]
                }
            ],
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"target_admission_ready_with_nonterminal_blocker": 1},
        )

    def test_audit_fails_when_target_manifest_omits_candidate_unit(self) -> None:
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
            closeout_candidate_inventory=_candidate_inventory(),
            target_admission_manifests=[
                {
                    "entries": [
                        {
                            "searchable_unit_id": "unit:other",
                            "target_admission_state": "needs_multimodal",
                        }
                    ]
                }
            ],
            cleanup_report=_cleanup_report(protected_keys=("objects/schedule.png",)),
            object_verification_report=_object_verification_report(source_hash="a" * 64),
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"target_admission_manifest_missing_candidate_unit": 1},
        )

    def test_audit_does_not_require_target_manifest_for_search_only_candidate(self) -> None:
        inventory = _candidate_inventory()
        candidate = inventory["candidates"][0]  # type: ignore[index]
        candidate["target_hints"] = []
        candidate["classification"] = {
            "primary_route": "notice_level_query",
            "target_candidates": [],
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
            closeout_candidate_inventory=inventory,
            target_admission_manifests=[
                {
                    "entries": [
                        {
                            "searchable_unit_id": "unit:other",
                            "target_admission_state": "needs_multimodal",
                        }
                    ]
                }
            ],
            cleanup_report=_cleanup_report(protected_keys=("objects/schedule.png",)),
            object_verification_report=_object_verification_report(source_hash="a" * 64),
        )

        self.assertEqual(audit["verdict"], "passed")
        self.assertEqual(audit["finding_count"], 0)

    def test_audit_fails_cleanup_dry_run_for_active_blocker(self) -> None:
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
                "dry_run_objects": [
                    {"bucket": "campus-rag-source", "object_key": "objects/schedule.png"}
                ],
                "blocked_quarantine_objects": [],
            },
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"cleanup_selected_active_blocking_quarantine_object": 1},
        )

    def test_audit_fails_candidate_source_object_without_verification(self) -> None:
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
            object_verification_report={"rows": []},
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"candidate_source_object_not_verified": 1},
        )

    def test_audit_fails_object_verification_hash_mismatch(self) -> None:
        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="pending",
                        retry_budget_remaining=2,
                        source_key="objects/schedule.png",
                        source_hash="a" * 64,
                    )
                ]
            },
            object_verification_report=_object_verification_report(source_hash="b" * 64),
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"candidate_source_object_hash_mismatch": 1},
        )

    def test_audit_fails_object_verification_without_hash_or_size(self) -> None:
        report = _object_verification_report(source_hash="a" * 64)
        row = report["rows"][0]  # type: ignore[index]
        row.pop("sha256", None)  # type: ignore[union-attr]
        row.pop("expected_sha256", None)  # type: ignore[union-attr]
        row.pop("byte_size", None)  # type: ignore[union-attr]
        row.pop("expected_byte_size", None)  # type: ignore[union-attr]

        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="pending",
                        retry_budget_remaining=2,
                        source_key="objects/schedule.png",
                        source_hash="a" * 64,
                    )
                ]
            },
            object_verification_report=report,
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {
                "candidate_source_object_verification_missing_hash": 1,
                "candidate_source_object_verification_missing_size": 1,
            },
        )

    def test_audit_fails_orphan_attempt(self) -> None:
        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="pending",
                        retry_budget_remaining=2,
                        source_key="objects/schedule.png",
                    ),
                    _attempt(
                        "candidate:orphan",
                        status="pending",
                        retry_budget_remaining=2,
                        source_key="objects/orphan.png",
                    ),
                ]
            },
            strict_gate=False,
        )

        self.assertEqual(audit["finding_counts_by_code"], {"attempt_without_candidate": 1})

    def test_audit_fails_attempt_source_ref_mismatch(self) -> None:
        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="pending",
                        retry_budget_remaining=2,
                        source_key="objects/other.png",
                    )
                ]
            },
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"attempt_source_object_ref_mismatch": 1},
        )

    def test_audit_fails_completed_closeout_without_completed_attempt(self) -> None:
        closeout_inventory = _candidate_inventory()
        closeout_candidate = closeout_inventory["candidates"][0]  # type: ignore[index]
        closeout_candidate["status"] = "completed"
        closeout_candidate["media_text_status"] = "completed"
        closeout_candidate["target_blocking"] = False
        closeout_candidate["completed_output_refs"] = {"plain_text": {"key": "ocr.txt"}}
        closeout_candidate["closeout"] = {"attempt_id": "candidate:schedule:attempt:1"}

        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            closeout_candidate_inventory=closeout_inventory,
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
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"completed_closeout_without_completed_attempt": 1},
        )

    def test_audit_fails_completed_closeout_without_attempt_provenance(self) -> None:
        closeout_inventory = _candidate_inventory()
        closeout_candidate = closeout_inventory["candidates"][0]  # type: ignore[index]
        closeout_candidate["status"] = "completed"
        closeout_candidate["media_text_status"] = "completed"
        closeout_candidate["target_blocking"] = False
        closeout_candidate["completed_output_refs"] = {"plain_text": {"key": "ocr.txt"}}

        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            closeout_candidate_inventory=closeout_inventory,
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="completed",
                        source_key="objects/schedule.png",
                    )
                ]
            },
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"completed_closeout_without_attempt_provenance": 1},
        )

    def test_audit_fails_completed_closeout_with_mismatched_attempt_provenance(self) -> None:
        closeout_inventory = _candidate_inventory()
        closeout_candidate = closeout_inventory["candidates"][0]  # type: ignore[index]
        closeout_candidate["status"] = "completed"
        closeout_candidate["media_text_status"] = "completed"
        closeout_candidate["target_blocking"] = False
        closeout_candidate["completed_output_refs"] = {"plain_text": {"key": "ocr.txt"}}
        closeout_candidate["closeout"] = {"attempt_id": "candidate:schedule:attempt:99"}

        audit = build_collected_notice_media_closeout_state_machine_audit(
            candidate_inventory=_candidate_inventory(),
            closeout_candidate_inventory=closeout_inventory,
            attempt_ledger={
                "attempts": [
                    _attempt(
                        "candidate:schedule",
                        status="completed",
                        source_key="objects/schedule.png",
                    )
                ]
            },
            strict_gate=False,
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"completed_closeout_attempt_provenance_mismatch": 1},
        )

    def test_audit_fails_target_manifest_target_mismatch_for_candidate_unit(self) -> None:
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
            closeout_candidate_inventory=_candidate_inventory(),
            target_admission_manifests=[
                {
                    "entries": [
                        {
                            "searchable_unit_id": "unit:355867",
                            "source_notice_id": "355867",
                            "target": "service_status",
                            "fact_readiness_state": "blocked_by_required_media",
                            "target_admission_state": "needs_multimodal",
                            "required_fact_groups": ["route", "service_window"],
                        }
                    ]
                }
            ],
            cleanup_report=_cleanup_report(protected_keys=("objects/schedule.png",)),
            object_verification_report=_object_verification_report(source_hash="a" * 64),
        )

        self.assertEqual(
            audit["finding_counts_by_code"],
            {"target_admission_manifest_target_mismatch": 1},
        )


if __name__ == "__main__":
    unittest.main()
