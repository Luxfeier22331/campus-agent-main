from __future__ import annotations

import unittest

from .authenticated_notice_closeout_async_test_support import *


class PostgresCloseoutStoreLockOrderTest(unittest.TestCase):
    def _build_store(self) -> PostgresAuthenticatedNoticeCloseoutStore:
        store = object.__new__(PostgresAuthenticatedNoticeCloseoutStore)
        store.database_url = "postgresql://example.test/closeout"
        store.run_table = "ingestion_closeout.closeout_runs"
        store.shard_table = "ingestion_closeout.closeout_shards"
        store.batch_table = "ingestion_closeout.closeout_batches"
        store.worker_table = "ingestion_closeout.closeout_workers"
        store.notice_stage_table = "ingestion_closeout.closeout_notice_stage"
        store.raw_asset_stage_table = "ingestion_closeout.closeout_raw_asset_stage"
        store.document_stage_table = "ingestion_closeout.closeout_document_stage"
        store.milestone_table = "ingestion_closeout.closeout_milestones"
        store.promotion_table = "ingestion_closeout.closeout_promotions"
        store.promotion_batch_table = "ingestion_closeout.closeout_promotion_batches"
        return store

    def _build_run(self) -> CloseoutRun:
        return CloseoutRun(
            run_id="run-1",
            bundle_path="/tmp/bundle.json",
            manifest_path="/tmp/manifest.json",
            expected_notice_count=1,
            operations_prefix="campus_notices/operations/authenticated-notice-closeout/run-1",
            batch_count=1,
            pending_batch_count=1,
        ).mark_planned()

    def _build_claimed_batch(self) -> CloseoutBatch:
        return CloseoutBatch(
            batch_id=1,
            shard_id=7,
            notice_ids=("355119",),
        ).claim(worker_id="worker-a", lease_seconds=300)

    def _build_shard(self) -> CloseoutShard:
        return CloseoutShard(
            shard_id=7,
            notice_ids=("355119",),
            batch_ids=(1,),
        )

    def _build_worker(self) -> CloseoutWorker:
        return CloseoutWorker(worker_id="worker-a").claim_batch(1)

    def _sample_stage(self) -> dict[str, object]:
        return {
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
        }

    def test_postgres_claim_and_commit_share_canonical_lock_order(self) -> None:
        store = self._build_store()
        run = self._build_run()
        pending_batch = CloseoutBatch(batch_id=1, shard_id=7, notice_ids=("355119",))
        claimed_batch = pending_batch.claim(worker_id="worker-a", lease_seconds=300)
        worker = CloseoutWorker(worker_id="worker-a")
        shard = self._build_shard()
        pending_batch_payload = asdict(pending_batch)
        pending_batch_payload["state"] = pending_batch.state.value
        cursor = _ClaimCursor((pending_batch_payload,))
        claim_events: list[str] = []
        commit_events: list[str] = []

        def _record_claim_run(_cursor, run_id: str) -> CloseoutRun:
            claim_events.append(f"run:{run_id}")
            return run

        def _record_claim_get_worker(_cursor, run_id: str, worker_id: str) -> CloseoutWorker:
            claim_events.append(f"worker:{worker_id}")
            return worker

        def _record_claim_shard(_cursor, run_id: str, shard_id: int) -> CloseoutShard:
            claim_events.append(f"shard:{shard_id}")
            return shard

        def _record_commit_run(_cursor, run_id: str) -> CloseoutRun:
            commit_events.append(f"run:{run_id}")
            return run.mark_running()

        def _record_commit_batch(
            _cursor,
            run_id: str,
            batch_id: int,
        ) -> CloseoutBatch:
            commit_events.append(f"batch:{batch_id}")
            return claimed_batch

        def _record_commit_worker(
            _cursor,
            run_id: str,
            worker_id: str,
        ) -> CloseoutWorker:
            commit_events.append(f"worker:{worker_id}")
            return self._build_worker()

        def _record_commit_shard(
            _cursor,
            run_id: str,
            shard_id: int,
        ) -> CloseoutShard:
            commit_events.append(f"shard:{shard_id}")
            return shard.mark_running()

        with (
            patch(
                "campus_ingestion_core.authenticated_notice_closeout_store_postgres._postgres_connection",
                return_value=_FakeConnectionContextManager(cursor),
            ),
            patch.object(store, "_require_run_cursor", side_effect=_record_claim_run),
            patch.object(store, "_save_batch_cursor"),
            patch.object(store, "_get_worker_cursor", side_effect=_record_claim_get_worker),
            patch.object(store, "_save_worker_cursor"),
            patch.object(store, "_require_shard_cursor", side_effect=_record_claim_shard),
            patch.object(store, "_save_shard_cursor"),
            patch.object(store, "_active_worker_count_cursor", return_value=1),
            patch.object(store, "_save_run_cursor"),
        ):
            store.claim_next_batch("run-1", worker_id="worker-a", lease_seconds=300)

        with (
            patch(
                "campus_ingestion_core.authenticated_notice_closeout_store_postgres._postgres_connection",
                return_value=_FakeConnectionContextManager(object()),
            ),
            patch.object(store, "_require_run_cursor", side_effect=_record_commit_run),
            patch.object(store, "_require_batch_cursor", side_effect=_record_commit_batch),
            patch.object(store, "_require_worker_cursor", side_effect=_record_commit_worker),
            patch.object(store, "_require_shard_cursor", side_effect=_record_commit_shard),
            patch.object(store, "_stage_notices_cursor"),
            patch.object(store, "_stage_raw_assets_cursor"),
            patch.object(store, "_stage_documents_cursor"),
            patch.object(store, "_save_batch_cursor"),
            patch.object(store, "_save_shard_cursor"),
            patch.object(store, "_save_worker_cursor"),
            patch.object(store, "_active_worker_count_cursor", return_value=1),
            patch.object(store, "_save_run_cursor"),
        ):
            store.commit_batch_stage(
                run_id="run-1",
                worker_id="worker-a",
                batch_id=1,
                stages=(self._sample_stage(),),
            )

        self.assertEqual(claim_events, ["run:run-1", "worker:worker-a", "shard:7"])
        self.assertEqual(
            commit_events[:4],
            ["run:run-1", "batch:1", "worker:worker-a", "shard:7"],
        )

    def test_postgres_claim_query_uses_typed_lease_column(self) -> None:
        store = self._build_store()
        run = self._build_run()
        pending_batch = CloseoutBatch(batch_id=1, shard_id=7, notice_ids=("355119",))
        pending_batch_payload = asdict(pending_batch)
        pending_batch_payload["state"] = pending_batch.state.value
        cursor = _ClaimCursor((pending_batch_payload,))

        with (
            patch(
                "campus_ingestion_core.authenticated_notice_closeout_store_postgres._postgres_connection",
                return_value=_FakeConnectionContextManager(cursor),
            ),
            patch.object(store, "_require_run_cursor", return_value=run),
            patch.object(store, "_save_batch_cursor"),
            patch.object(
                store, "_get_worker_cursor", return_value=CloseoutWorker(worker_id="worker-a")
            ),
            patch.object(store, "_save_worker_cursor"),
            patch.object(store, "_require_shard_cursor", return_value=self._build_shard()),
            patch.object(store, "_save_shard_cursor"),
            patch.object(store, "_active_worker_count_cursor", return_value=1),
            patch.object(store, "_save_run_cursor"),
        ):
            store.claim_next_batch("run-1", worker_id="worker-a", lease_seconds=300)

        claim_query = cursor.execute_calls[0][0]
        self.assertIn("lease_expires_at", claim_query)
        self.assertNotIn("record->>'lease_expires_at'", claim_query)

    def test_postgres_commit_batch_stage_uses_bulk_stage_writers(self) -> None:
        store = self._build_store()
        run = self._build_run().mark_running()
        batch = self._build_claimed_batch()
        worker = self._build_worker()
        shard = self._build_shard().mark_running()
        sample_stage = self._sample_stage()

        with (
            patch(
                "campus_ingestion_core.authenticated_notice_closeout_store_postgres._postgres_connection",
                return_value=_FakeConnectionContextManager(object()),
            ),
            patch.object(store, "_require_run_cursor", return_value=run),
            patch.object(store, "_require_batch_cursor", return_value=batch),
            patch.object(store, "_require_worker_cursor", return_value=worker),
            patch.object(store, "_require_shard_cursor", return_value=shard),
            patch.object(store, "_stage_notices_cursor", create=True) as stage_notices,
            patch.object(store, "_stage_raw_assets_cursor", create=True) as stage_raw_assets,
            patch.object(store, "_stage_documents_cursor", create=True) as stage_documents,
            patch.object(store, "_stage_notice_cursor") as single_notice,
            patch.object(store, "_stage_raw_cursor") as single_raw,
            patch.object(store, "_stage_document_cursor") as single_document,
            patch.object(store, "_save_batch_cursor"),
            patch.object(store, "_save_shard_cursor"),
            patch.object(store, "_save_worker_cursor"),
            patch.object(store, "_active_worker_count_cursor", return_value=1),
            patch.object(store, "_save_run_cursor"),
        ):
            store.commit_batch_stage(
                run_id="run-1",
                worker_id="worker-a",
                batch_id=1,
                stages=(sample_stage,),
            )

        stage_notices.assert_called_once()
        stage_raw_assets.assert_called_once()
        stage_documents.assert_called_once()
        single_notice.assert_not_called()
        single_raw.assert_not_called()
        single_document.assert_not_called()

    def test_postgres_stage_bulk_writers_use_recordset_upsert(self) -> None:
        store = self._build_store()
        cursor = _BulkCursor()

        store._stage_notices_cursor(
            cursor=cursor,
            rows=(
                {
                    "run_id": "run-1",
                    "notice_id": "355119",
                    "shard_id": 7,
                    "batch_id": 1,
                    "updated_at": "2026-04-06T00:00:00+00:00",
                    "record": {"notice": {"notice_id": "355119"}},
                },
            ),
        )

        self.assertEqual(len(cursor.executemany_calls), 0)
        self.assertEqual(len(cursor.execute_calls), 1)
        query = cursor.execute_calls[0][0]
        self.assertIn("jsonb_to_recordset", query)
        self.assertIn("on conflict (run_id, notice_id) do update", query)
        self.assertIn("insert into ingestion_closeout.closeout_notice_stage", query)

    def test_postgres_fail_batch_uses_same_lock_order(self) -> None:
        store = self._build_store()
        run = self._build_run().mark_running()
        batch = self._build_claimed_batch()
        shard = self._build_shard().mark_running()
        worker = self._build_worker()
        events: list[str] = []

        with (
            patch(
                "campus_ingestion_core.authenticated_notice_closeout_store_postgres._postgres_connection",
                return_value=_FakeConnectionContextManager(object()),
            ),
            patch.object(
                store,
                "_require_run_cursor",
                side_effect=lambda _cursor, run_id: events.append(f"run:{run_id}") or run,
            ),
            patch.object(
                store,
                "_require_batch_cursor",
                side_effect=lambda _cursor, run_id, batch_id: (
                    events.append(f"batch:{batch_id}") or batch
                ),
            ),
            patch.object(
                store,
                "_require_worker_cursor",
                side_effect=lambda _cursor, run_id, worker_id: (
                    events.append(f"worker:{worker_id}") or worker
                ),
            ),
            patch.object(
                store,
                "_require_shard_cursor",
                side_effect=lambda _cursor, run_id, shard_id: (
                    events.append(f"shard:{shard_id}") or shard
                ),
            ),
            patch.object(store, "_save_batch_cursor"),
            patch.object(store, "_save_shard_cursor"),
            patch.object(store, "_save_worker_cursor"),
            patch.object(store, "_active_worker_count_cursor", return_value=0),
            patch.object(store, "_save_run_cursor"),
        ):
            store.fail_batch(
                run_id="run-1",
                worker_id="worker-a",
                batch_id=1,
                error="deadlock",
            )

        self.assertEqual(
            events[:4],
            ["run:run-1", "batch:1", "worker:worker-a", "shard:7"],
        )

    def test_postgres_finish_worker_locks_run_before_worker(self) -> None:
        store = self._build_store()
        run = self._build_run().mark_running()
        worker = self._build_worker()
        events: list[str] = []

        with (
            patch(
                "campus_ingestion_core.authenticated_notice_closeout_store_postgres._postgres_connection",
                return_value=_FakeConnectionContextManager(object()),
            ),
            patch.object(
                store,
                "_require_run_cursor",
                side_effect=lambda _cursor, run_id: events.append(f"run:{run_id}") or run,
            ),
            patch.object(
                store,
                "_get_worker_cursor",
                side_effect=lambda _cursor, run_id, worker_id: (
                    events.append(f"worker:{worker_id}") or worker
                ),
            ),
            patch.object(store, "_save_worker_cursor"),
            patch.object(store, "_active_worker_count_cursor", return_value=0),
            patch.object(store, "_save_run_cursor"),
        ):
            store.finish_worker("run-1", "worker-a")

        self.assertEqual(events[:2], ["run:run-1", "worker:worker-a"])
