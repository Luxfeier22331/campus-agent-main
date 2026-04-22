from __future__ import annotations

import unittest

from .authenticated_notice_closeout_async_test_support import *  # noqa: F401,F403


class CloseoutRunModelTest(unittest.TestCase):
    def test_from_dict_restores_selected_notice_ids(self) -> None:
        run = CloseoutRun.from_dict(
            {
                "run_id": "run-1",
                "bundle_path": "",
                "manifest_path": None,
                "expected_notice_count": 1,
                "operations_prefix": "campus_notices/operations/authenticated-notice-closeout/run-1",
                "selected_notice_ids": ["355119", "355120"],
            }
        )

        self.assertEqual(run.selected_notice_ids, ("355119", "355120"))

    def test_run_state_transitions(self) -> None:
        run = CloseoutRun(
            run_id="run-1",
            bundle_path="/tmp/bundle.json",
            manifest_path="/tmp/manifest.json",
            expected_notice_count=6,
            operations_prefix="campus_notices/operations/authenticated-notice-closeout/run-1",
        )

        self.assertEqual(run.state, CloseoutRunState.PLANNING)
        planned = run.mark_planned()
        self.assertEqual(planned.state, CloseoutRunState.PLANNED)
        self.assertIsNotNone(planned.planned_at)

        running = planned.mark_running()
        self.assertEqual(running.state, CloseoutRunState.RUNNING)
        self.assertIsNotNone(running.started_at)

        verifying = running.mark_verifying()
        self.assertEqual(verifying.state, CloseoutRunState.VERIFYING)

        verified = verifying.mark_verified(
            {
                "expected_notice_count": 6,
                "staged_notice_count": 6,
                "missing_document_id_count": 0,
            }
        )
        self.assertEqual(verified.state, CloseoutRunState.VERIFIED)
        self.assertEqual(verified.verification["staged_notice_count"], 6)

        completed = verified.complete({"replaced_scope_record_count": 6})
        self.assertEqual(completed.state, CloseoutRunState.DONE)
        self.assertIsNotNone(completed.finished_at)
        self.assertEqual(completed.promotion["replaced_scope_record_count"], 6)


class CloseoutPlannerTest(unittest.TestCase):
    def test_shard_and_batch_plan_are_deterministic_and_balanced(self) -> None:
        planner = CloseoutPlanner(shard_size=3, batch_size=2, max_shards=10)
        notices = _build_notice_bundle(7)

        first_shards = planner.plan_shards(notices)
        second_shards = planner.plan_shards(notices)
        first_batches = planner.plan_batches(first_shards)
        second_batches = planner.plan_batches(second_shards)

        self.assertEqual(
            [(shard.shard_id, shard.notice_ids) for shard in first_shards],
            [(shard.shard_id, shard.notice_ids) for shard in second_shards],
        )
        self.assertEqual(
            [(batch.batch_id, batch.shard_id, batch.notice_ids) for batch in first_batches],
            [(batch.batch_id, batch.shard_id, batch.notice_ids) for batch in second_batches],
        )
        self.assertEqual(sum(len(shard.notice_ids) for shard in first_shards), 7)
        self.assertEqual(sum(len(batch.notice_ids) for batch in first_batches), 7)
        self.assertTrue(all(len(shard.notice_ids) <= 3 for shard in first_shards))
        self.assertTrue(all(len(batch.notice_ids) <= 2 for batch in first_batches))
        self.assertEqual(first_batches[0].state, CloseoutBatchState.PENDING)

    def test_shard_plan_respects_max_shards(self) -> None:
        planner = CloseoutPlanner(shard_size=2, batch_size=1, max_shards=2)
        shards = planner.plan_shards(_build_notice_bundle(5))
        batches = planner.plan_batches(shards)

        self.assertEqual(len(shards), 2)
        self.assertEqual(len(batches), 5)
        self.assertEqual(sum(len(shard.notice_ids) for shard in shards), 5)


class CloseoutStoreTest(unittest.TestCase):
    def test_in_memory_store_records_committed_stage_rows_and_progress(self) -> None:
        store = InMemoryCloseoutStore()
        run = CloseoutRun(
            run_id="run-1",
            bundle_path="/tmp/bundle.json",
            manifest_path="/tmp/manifest.json",
            expected_notice_count=1,
            operations_prefix="campus_notices/operations/authenticated-notice-closeout/run-1",
            batch_count=1,
            pending_batch_count=1,
        ).mark_planned()
        store.save_run(run)
        shard = store.make_shard(shard_id=1, notice_ids=("355119",), batch_ids=(1,))
        batch = store.make_batch(batch_id=1, shard_id=1, notice_ids=("355119",))
        store.save_shard("run-1", shard)
        store.save_batch("run-1", batch)
        claimed = store.claim_next_batch("run-1", worker_id="worker-a", lease_seconds=120)
        self.assertIsNotNone(claimed)
        store.commit_batch_stage(
            run_id="run-1",
            worker_id="worker-a",
            batch_id=1,
            stages=(
                {
                    "notice": {
                        "notice_id": "355119",
                        "raw_asset_id": "asset:1",
                        "raw_version_id": "sha256:1",
                        "document_id": "notice:muc_internal_portal:355119",
                    },
                    "raw_record": {
                        "raw_asset_id": "asset:1",
                        "raw_version_id": "sha256:1",
                    },
                    "source_artifact_keys": {"source-truth/notice-manifest.json": "source.json"},
                    "document": {
                        "document_id": "notice:muc_internal_portal:355119",
                        "revision_track": "source-faithful",
                        "version_id": "sha256:1",
                    },
                    "artifact_keys": ("source.json",),
                    "staged_object_keys": {"document_units": "ops/document-units.jsonl"},
                    "final_object_keys": {"document_units": "docs/document-units.jsonl"},
                    "content_hash": "hash-1",
                    "staged_object_metadata": {
                        "document_units": {"sha256": "hash-1", "content_length": 12}
                    },
                },
            ),
        )

        run_after = store.get_run("run-1")
        assert run_after is not None
        self.assertEqual(run_after.completed_batch_count, 1)
        self.assertEqual(run_after.running_batch_count, 0)
        self.assertEqual(run_after.pending_batch_count, 0)
        self.assertEqual(run_after.staged_notice_count, 1)
        self.assertEqual(run_after.active_worker_count, 0)
        self.assertEqual(len(store.get_staged_notices("run-1", batch_id=1)), 1)
        self.assertEqual(len(store.get_staged_documents("run-1")), 1)
        self.assertTrue(store.try_begin_verification("run-1"))
