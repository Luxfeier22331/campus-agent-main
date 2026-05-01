from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_smoke_replay_run import (
    AUTHENTICATED_NOTICE_SMOKE_REPLAY_RUN_PLAN_SCHEMA_VERSION,
    build_authenticated_notice_smoke_replay_run_plan,
)


class AuthenticatedNoticeSmokeReplayRunTest(unittest.TestCase):
    def test_plan_copies_verified_source_row_with_synthetic_provenance(self) -> None:
        plan = build_authenticated_notice_smoke_replay_run_plan(
            source_row=_source_row(),
            purpose="phase1_wrapper_execute_smoke",
            generated_at="2026-05-01T01:00:00Z",
            synthetic_run_id="run-001:smoke:20260501T010000000000Z",
        )

        self.assertEqual(
            plan["schema_version"],
            AUTHENTICATED_NOTICE_SMOKE_REPLAY_RUN_PLAN_SCHEMA_VERSION,
        )
        self.assertEqual(plan["mode"], "dry_run")
        self.assertFalse(plan["write_enabled"])
        self.assertEqual(plan["source_run_id"], "run-001")
        self.assertEqual(plan["synthetic_run_id"], "run-001:smoke:20260501T010000000000Z")
        self.assertEqual(plan["counts"]["planned_ledger_row_count"], 1)
        row = plan["synthetic_row"]
        self.assertEqual(row["run_id"], "run-001:smoke:20260501T010000000000Z")
        self.assertEqual(row["record"]["run_id"], "run-001:smoke:20260501T010000000000Z")
        self.assertEqual(row["record"]["synthetic_replay"]["source_run_id"], "run-001")
        self.assertEqual(row["record"]["synthetic_replay"]["object_refs_reused"], True)
        self.assertEqual(row["bundle_object_key"], "runs/run-001/bundle.json")
        self.assertEqual(row["manifest_object_key"], "runs/run-001/manifest.json")

    def test_plan_rejects_unverified_source_row(self) -> None:
        source_row = _source_row()
        source_row["verification_status"] = "failed"

        with self.assertRaisesRegex(ValueError, "verification_status=verified"):
            build_authenticated_notice_smoke_replay_run_plan(
                source_row=source_row,
                purpose="phase1_wrapper_execute_smoke",
                generated_at="2026-05-01T01:00:00Z",
                synthetic_run_id="run-001:smoke:20260501T010000000000Z",
            )


def _source_row() -> dict[str, object]:
    return {
        "run_id": "run-001",
        "site_id": "muc_internal_portal",
        "source_surface": "notice",
        "collection_mode": "incremental",
        "source_home_url": "https://my.muc.edu.cn",
        "notice_type_ids": [],
        "selected_notice_ids": [],
        "bundle_path": None,
        "manifest_path": None,
        "bundle_object_key": "runs/run-001/bundle.json",
        "manifest_object_key": "runs/run-001/manifest.json",
        "notices_collected": 2,
        "pages_fetched": 1,
        "detail_fetched": 2,
        "items_seen": 2,
        "attachment_refs_seen": 0,
        "attachment_uploaded": 0,
        "attachment_terminal_unavailable": 0,
        "attachment_transient_failed": 0,
        "attachment_reference_only": 0,
        "status": "success",
        "error_count": 0,
        "started_at": "2026-05-01T00:00:00Z",
        "finished_at": "2026-05-01T00:01:00Z",
        "record": {
            "run_id": "run-001",
            "source_surface": "notice",
            "status": "success",
            "verification_status": "verified",
        },
        "source_bucket": "campus-rag-source",
        "bundle_content_sha256": "a" * 64,
        "bundle_byte_size": 4096,
        "manifest_content_sha256": "b" * 64,
        "manifest_byte_size": 2048,
        "verification_status": "verified",
        "required_source_object_count": 2,
        "verified_source_object_count": 2,
        "missing_source_object_count": 0,
        "checksum_mismatch_count": 0,
        "size_mismatch_count": 0,
        "failure_reason": None,
    }


if __name__ == "__main__":
    unittest.main()
