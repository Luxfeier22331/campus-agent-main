from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_historical_enqueue import (
    build_historical_notice_enqueue_plan,
    execute_historical_notice_enqueue_plan,
)
from campus_ingestion_core.collected_notice_ingest_queue import (
    validate_notice_ingest_job_payload,
)
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)


class CollectedNoticeHistoricalEnqueueTest(unittest.TestCase):
    def test_dry_run_projects_source_truth_candidates_to_notice_ingest_jobs(self) -> None:
        plan = build_historical_notice_enqueue_plan(
            _reimport_plan(
                candidates=(
                    _candidate("notice", "355512", content_hash="sha256-a"),
                    _candidate("file_release", "8127", content_hash="sha256-b"),
                )
            ),
            replay_batch_id="phase-04-7-test",
        )

        self.assertEqual(plan["mode"], "dry_run")
        self.assertFalse(plan["write_enabled"])
        self.assertEqual(plan["counts"]["planned_job_count"], 2)
        self.assertEqual(plan["counts"]["rejected_count"], 0)
        self.assertEqual(
            [job["source_identity"] for job in plan["jobs"]],
            ["muc_internal_portal:355512", "file_release:8127"],
        )
        self.assertEqual(
            [job["capture_manifest_object_ref"]["role"] for job in plan["jobs"]],
            ["source-truth/notice-manifest.json", "source-truth/file-release-manifest.json"],
        )
        for job in plan["jobs"]:
            validate_notice_ingest_job_payload(job)
            self.assertEqual(job["enqueue_source"], "historical_backfill")
            self.assertEqual(job["replay_batch_id"], "phase-04-7-test")
            self.assertNotIn("body_text", job)
            self.assertNotIn("raw_html", job)

    def test_plan_rejects_missing_refs_unsupported_surface_and_duplicate_keys(self) -> None:
        duplicate = _candidate("notice", "355512", content_hash="sha256-a")
        plan = build_historical_notice_enqueue_plan(
            _reimport_plan(
                candidates=(
                    duplicate,
                    duplicate,
                    _candidate(
                        "notice",
                        "355513",
                        content_hash="sha256-b",
                        include_manifest=False,
                    ),
                    _candidate(
                        "notice",
                        "355514",
                        content_hash="sha256-c",
                        include_bundle=False,
                    ),
                    _candidate("unsupported", "355515", content_hash="sha256-d"),
                )
            ),
            replay_batch_id="phase-04-7-test",
        )

        self.assertEqual(plan["counts"]["planned_job_count"], 1)
        self.assertEqual(plan["counts"]["rejected_count"], 4)
        reason_codes = {
            reason for item in plan["rejected_items"] for reason in item["reason_codes"]
        }
        self.assertEqual(
            reason_codes,
            {
                "duplicate_idempotency_key",
                "missing_capture_manifest_object_ref",
                "missing_bundle_object_ref",
                "unsupported_source_surface",
            },
        )

    def test_plan_preserves_phase_four_rejected_run_refs(self) -> None:
        plan = build_historical_notice_enqueue_plan(
            {
                **_reimport_plan(candidates=(_candidate("notice", "355512", content_hash="a"),)),
                "input_refs": {
                    "rejected_run_refs": [
                        {
                            "run_id": "run-failed",
                            "source_surface": "notice",
                            "status": "failed",
                            "verification_status": "missing_required_objects",
                            "reason_codes": [
                                "collector_run_not_success",
                                "collector_run_not_verified",
                            ],
                        }
                    ]
                },
            },
            replay_batch_id="phase-04-7-test",
        )

        self.assertEqual(plan["counts"]["planned_job_count"], 1)
        self.assertEqual(plan["counts"]["candidate_rejected_count"], 0)
        self.assertEqual(plan["counts"]["input_rejected_run_count"], 1)
        self.assertEqual(plan["counts"]["rejected_count"], 1)
        self.assertEqual(
            plan["rejected_items"][0]["reason_codes"],
            ["collector_run_not_success", "collector_run_not_verified"],
        )

    def test_execute_writes_queue_jobs_only_and_reports_existing_jobs(self) -> None:
        dry_run = build_historical_notice_enqueue_plan(
            _reimport_plan(
                candidates=(
                    _candidate("notice", "355512", content_hash="sha256-a"),
                    _candidate("file_release", "8127", content_hash="sha256-b"),
                )
            ),
            replay_batch_id="phase-04-7-test",
        )
        store = InMemoryNoticeIngestQueueStore()
        first = execute_historical_notice_enqueue_plan(dry_run, queue_store=store)
        second = execute_historical_notice_enqueue_plan(dry_run, queue_store=store)

        self.assertEqual(first["mode"], "execute")
        self.assertTrue(first["write_enabled"])
        self.assertEqual(first["counts"]["inserted_count"], 2)
        self.assertEqual(first["counts"]["existing_count"], 0)
        self.assertEqual(first["counts"]["queue_write_count"], 2)
        self.assertEqual(second["counts"]["inserted_count"], 0)
        self.assertEqual(second["counts"]["existing_count"], 2)
        self.assertEqual(store.list_status_counts()["queued"], 2)
        self.assertNotIn("source_truth_write_count", first["counts"])
        self.assertNotIn("downstream_write_count", first["counts"])


def _reimport_plan(*, candidates: tuple[dict[str, object], ...]) -> dict[str, object]:
    return {
        "schema_version": "collected_notice_reimport_dry_run.v1",
        "report_id": "reimport-test",
        "input_refs": {
            "captured_runs_inventory_path": "phase-01/captured-runs-inventory.json",
        },
        "write_manifest_candidate": {
            "source_truth_candidates": list(candidates),
        },
    }


def _candidate(
    source_surface: str,
    source_identifier: str,
    *,
    content_hash: str,
    include_manifest: bool = True,
    include_bundle: bool = True,
) -> dict[str, object]:
    manifest_role = (
        "source-truth/file-release-manifest.json"
        if source_surface == "file_release"
        else "source-truth/notice-manifest.json"
    )
    refs = []
    if include_bundle:
        refs.append(
            {
                "bucket": "campus-rag-source",
                "key": "authenticated_notice_portal/runs/run-001/bundle.json",
                "role": "collector_bundle",
            }
        )
    refs.append(
        {
            "bucket": "campus-rag-source",
            "key": "authenticated_notice_portal/runs/run-001/export-manifest.json",
            "role": "collector_manifest",
        }
    )
    if include_manifest:
        refs.append(
            {
                "bucket": "campus-rag-source",
                "key": (
                    f"authenticated_notice_portal/{source_identifier}/"
                    f"source-truth/{manifest_role.rsplit('/', 1)[-1]}"
                ),
                "role": manifest_role,
            }
        )
    return {
        "source_surface": source_surface,
        "source_channel": "authenticated_notice_portal",
        "site_id": "muc_internal_portal",
        "source_identifier": source_identifier,
        "run_id": "run-001",
        "document": {"content_hash": content_hash},
        "source_object_refs": refs,
    }


if __name__ == "__main__":
    unittest.main()
