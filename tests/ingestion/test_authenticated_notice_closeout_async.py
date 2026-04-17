from __future__ import annotations

from dataclasses import asdict, replace
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import time
import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_closeout import (
    AuthenticatedNoticeCloseoutService,
    CloseoutBatch,
    CloseoutBatchState,
    CloseoutPlanner,
    CloseoutRun,
    CloseoutRunState,
    CloseoutShard,
    CloseoutVerifier,
    CloseoutWorker,
    InMemoryCloseoutStore,
)
from campus_ingestion_core.authenticated_notice_import import AuthenticatedNoticeImportRequest
from campus_ingestion_core.authenticated_notice_import import import_authenticated_notice_export
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    AuthenticatedNoticeSourceTruthReplayRequest,
)
from campus_ingestion_core.authenticated_notice_closeout_store import (
    PostgresAuthenticatedNoticeCloseoutStore,
)
from campus_ingestion_core.authenticated_notice_closeout_models import (
    document_stage_slug,
)
from campus_ingestion_core.object_store import build_operations_artifact_key
from campus_ingestion_core.settings import ObjectStoreSettings
from tests.ingestion.test_authenticated_notice_import import (
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
    _write_json,
)
from tests.ingestion.test_authenticated_notice_source_projections import (
    _FakeAttachmentOcrClient,
    _FakeAttachmentNoTextOcrClient,
    _build_minimal_docx_bytes,
    _build_minimal_gif_bytes,
    _build_map_like_png_bytes,
    _build_minimal_png_bytes,
    _sample_notice_bundle as _sample_projection_notice_bundle,
    _sample_notice_bundle_with_decorative_gif,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


def _build_notice_bundle(count: int) -> list[dict[str, object]]:
    bundle: list[dict[str, object]] = []
    for offset in range(count):
        item = json.loads(json.dumps(_sample_notice_bundle()[0], ensure_ascii=False))
        notice_id = 355119 + offset
        item["notice_id"] = notice_id
        notice = item["notice"]
        assert isinstance(notice, dict)
        notice["notice_id"] = notice_id
        notice["notice_title"] = f"测试通知 {notice_id}"
        notice["notice_content"] = (
            f"<h1>测试通知 {notice_id}</h1>"
            f"<p>这是第 {offset + 1} 条通知。</p>"
            f"<p>附件1：附件-{notice_id}.docx</p>"
        )
        notice["notice_link"] = f"https://portal.example.edu/notice/{notice_id}"
        categories = notice["categories"]
        assert isinstance(categories, list) and categories
        categories[0]["notice_id"] = notice_id
        item["links"][0]["notice_id"] = notice_id
        item["links"][0]["url"] = f"https://portal.example.edu/files/{notice_id}.docx"
        item["links"][0]["final_url"] = f"https://portal.example.edu/files/{notice_id}.docx"
        item["links"][0]["link_text"] = f"附件-{notice_id}.docx"
        item["notice_attachments"][0]["notice_id"] = notice_id
        item["attachments"][0]["attachment_id"] = notice_id
        item["attachments"][0]["source_url"] = f"https://portal.example.edu/files/{notice_id}.docx"
        item["attachments"][0]["normalized_source_url"] = (
            f"https://portal.example.edu/files/{notice_id}.docx"
        )
        item["attachments"][0]["final_url"] = f"https://portal.example.edu/files/{notice_id}.docx"
        item["attachments"][0]["original_filename"] = f"{notice_id}.docx"
        item["attachments"][0]["object_key"] = f"objects/{notice_id}.docx"
        bundle.append(item)
    return bundle


class _SlowTrackingObjectStore(_FakeObjectStore):
    def __init__(self, *, delay_seconds: float = 0.02) -> None:
        super().__init__()
        self.delay_seconds = delay_seconds
        self.max_put_inflight = 0
        self._put_inflight = 0
        self._lock = threading.Lock()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
    ) -> None:
        with self._lock:
            self._put_inflight += 1
            self.max_put_inflight = max(self.max_put_inflight, self._put_inflight)
        try:
            time.sleep(self.delay_seconds)
            super().put_bytes(
                bucket=bucket,
                key=key,
                data=data,
                content_type=content_type,
                metadata=metadata,
            )
        finally:
            with self._lock:
                self._put_inflight -= 1


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
            [
                (batch.batch_id, batch.shard_id, batch.notice_ids)
                for batch in first_batches
            ],
            [
                (batch.batch_id, batch.shard_id, batch.notice_ids)
                for batch in second_batches
            ],
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


class _FakeCursorContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> object:
        return self._cursor

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeConnectionContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> _FakeConnectionContextManager:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def cursor(self) -> _FakeCursorContextManager:
        return _FakeCursorContextManager(self._cursor)


class _ClaimCursor:
    def __init__(self, row: tuple[object, ...]) -> None:
        self._row = row
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.execute_calls.append((query, params))

    def fetchone(self) -> tuple[object, ...] | None:
        if self._row is None:
            return None
        row = self._row
        self._row = None
        return row


class _BulkCursor:
    def __init__(self) -> None:
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []
        self.executemany_calls: list[tuple[str, list[tuple[object, ...]]]] = []

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.execute_calls.append((query, params))

    def executemany(self, query: str, params_seq) -> None:
        self.executemany_calls.append((query, list(params_seq)))


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
                "campus_ingestion_core.authenticated_notice_closeout_store._postgres_connection",
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
                "campus_ingestion_core.authenticated_notice_closeout_store._postgres_connection",
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
                "campus_ingestion_core.authenticated_notice_closeout_store._postgres_connection",
                return_value=_FakeConnectionContextManager(cursor),
            ),
            patch.object(store, "_require_run_cursor", return_value=run),
            patch.object(store, "_save_batch_cursor"),
            patch.object(store, "_get_worker_cursor", return_value=CloseoutWorker(worker_id="worker-a")),
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
                "campus_ingestion_core.authenticated_notice_closeout_store._postgres_connection",
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
                "campus_ingestion_core.authenticated_notice_closeout_store._postgres_connection",
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
                side_effect=lambda _cursor, run_id, batch_id: events.append(f"batch:{batch_id}") or batch,
            ),
            patch.object(
                store,
                "_require_worker_cursor",
                side_effect=lambda _cursor, run_id, worker_id: events.append(f"worker:{worker_id}") or worker,
            ),
            patch.object(
                store,
                "_require_shard_cursor",
                side_effect=lambda _cursor, run_id, shard_id: events.append(f"shard:{shard_id}") or shard,
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
                "campus_ingestion_core.authenticated_notice_closeout_store._postgres_connection",
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
                side_effect=lambda _cursor, run_id, worker_id: events.append(f"worker:{worker_id}") or worker,
            ),
            patch.object(store, "_save_worker_cursor"),
            patch.object(store, "_active_worker_count_cursor", return_value=0),
            patch.object(store, "_save_run_cursor"),
        ):
            store.finish_worker("run-1", "worker-a")

        self.assertEqual(events[:2], ["run:run-1", "worker:worker-a"])


class AuthenticatedNoticeCloseoutServiceTest(unittest.TestCase):
    def _build_service(
        self,
        *,
        root: Path,
        ocr_client: object | None = None,
        object_store: _FakeObjectStore | None = None,
    ) -> tuple[AuthenticatedNoticeCloseoutService, _FakeObjectStore]:
        runtime_object_store = object_store or _FakeObjectStore()
        service = AuthenticatedNoticeCloseoutService(
            closeout_store=InMemoryCloseoutStore(),
            object_store=runtime_object_store,
            object_store_settings=ObjectStoreSettings(
                endpoint="http://localhost:9000",
                access_key="minioadmin",
                secret_key="minioadmin",
            ),
            document_registry=InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            ),
            raw_asset_registry=InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            ),
            planner=CloseoutPlanner(shard_size=2, batch_size=1, max_shards=4),
            ocr_client=ocr_client,
        )
        return service, runtime_object_store

    def _bootstrap_source_truth_scope(
        self,
        *,
        root: Path,
        object_store: _FakeObjectStore,
        document_registry: InMemoryDocumentRegistry,
        raw_asset_registry: InMemoryRawAssetRegistry,
        source_truth_inventory_store=None,
        bundle: list[dict[str, object]] | None = None,
        attachment_payloads: dict[str, tuple[bytes, str]] | None = None,
    ) -> None:
        bundle_path = root / "source-truth-bundle.json"
        manifest_path = root / "source-truth-manifest.json"
        docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表第一行", "报名表第二行"))
        png_bytes = _build_minimal_png_bytes()
        bundle = bundle or _sample_projection_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)
        _write_json(bundle_path, bundle)
        _write_json(manifest_path, _sample_export_manifest())
        import_authenticated_notice_export(
            request=AuthenticatedNoticeImportRequest(
                bundle_path=bundle_path,
                export_manifest_path=manifest_path,
                site_id="muc_internal_portal",
                source_home_url="https://portal.example.edu/home",
            ),
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=source_truth_inventory_store,
        )
        payloads = attachment_payloads or {
            str(bundle[0]["attachments"][0]["object_key"]): (docx_bytes, str(bundle[0]["attachments"][0]["mime_type"])),
            str(bundle[0]["attachments"][1]["object_key"]): (png_bytes, str(bundle[0]["attachments"][1]["mime_type"])),
        }
        for object_key, (data, content_type) in payloads.items():
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=object_key,
                data=data,
                content_type=content_type,
            )

    def _build_second_source_truth_notice(
        self,
        *,
        docx_bytes: bytes,
        png_bytes: bytes,
    ) -> tuple[dict[str, object], dict[str, tuple[bytes, str]]]:
        bundle = json.loads(
            json.dumps(
                _sample_projection_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)[0],
                ensure_ascii=False,
            )
        )
        bundle["notice_id"] = 355120
        notice = bundle["notice"]
        assert isinstance(notice, dict)
        notice["notice_id"] = 355120
        notice["notice_title"] = "第二条 authenticated notice 测试通知"
        notice["notice_link"] = "https://portal.example.edu/notice/355120"
        notice["notice_content"] = (
            "<h1>第二条 authenticated notice 测试通知</h1>"
            "<p>第二条通知正文。</p>"
            "<p>附件1：application-355120.docx</p>"
            "<p>附件2：notice-355120.png</p>"
            "<p>附件3：supplement-355120.pdf</p>"
        )
        categories = notice["categories"]
        assert isinstance(categories, list)
        for index, category in enumerate(categories):
            assert isinstance(category, dict)
            category["notice_id"] = 355120
            category["category_last_run_id"] = 140 + index

        links = bundle["links"]
        assert isinstance(links, list) and len(links) == 3
        links[0]["id"] = 134
        links[0]["notice_id"] = 355120
        links[0]["url"] = "https://portal.example.edu/files/application-355120.docx"
        links[0]["final_url"] = "https://portal.example.edu/files/application-355120.docx"
        links[0]["link_text"] = "application-355120.docx"
        links[0]["file_size"] = len(docx_bytes)
        links[1]["id"] = 135
        links[1]["notice_id"] = 355120
        links[1]["url"] = "https://portal.example.edu/files/notice-355120.png"
        links[1]["final_url"] = "https://portal.example.edu/files/notice-355120.png"
        links[1]["link_text"] = "notice-355120.png"
        links[1]["file_size"] = len(png_bytes)
        links[2]["id"] = 136
        links[2]["notice_id"] = 355120
        links[2]["url"] = "https://portal.example.edu/files/supplement-355120.pdf"
        links[2]["final_url"] = "https://portal.example.edu/files/supplement-355120.pdf"
        links[2]["link_text"] = "supplement-355120.pdf"

        notice_attachments = bundle["notice_attachments"]
        assert isinstance(notice_attachments, list) and len(notice_attachments) == 3
        notice_attachments[0]["notice_id"] = 355120
        notice_attachments[0]["attachment_id"] = 101
        notice_attachments[0]["link_id"] = 134
        notice_attachments[1]["notice_id"] = 355120
        notice_attachments[1]["attachment_id"] = 102
        notice_attachments[1]["link_id"] = 135
        notice_attachments[2]["notice_id"] = 355120
        notice_attachments[2]["attachment_id"] = 103
        notice_attachments[2]["link_id"] = 136

        attachments = bundle["attachments"]
        assert isinstance(attachments, list) and len(attachments) == 3
        second_docx_key = "attachments/pilot/355120/application-355120.docx"
        second_png_key = "attachments/pilot/355120/notice-355120.png"
        second_docx_sha256 = hashlib.sha256(docx_bytes).hexdigest()
        second_png_sha256 = hashlib.sha256(png_bytes).hexdigest()
        attachments[0]["attachment_id"] = 101
        attachments[0]["source_url"] = "https://portal.example.edu/files/application-355120.docx"
        attachments[0]["normalized_source_url"] = (
            "https://portal.example.edu/files/application-355120.docx"
        )
        attachments[0]["final_url"] = "https://portal.example.edu/files/application-355120.docx"
        attachments[0]["original_filename"] = "application-355120.docx"
        attachments[0]["byte_size"] = len(docx_bytes)
        attachments[0]["sha256"] = second_docx_sha256
        attachments[0]["object_key"] = second_docx_key
        attachments[1]["attachment_id"] = 102
        attachments[1]["source_url"] = "https://portal.example.edu/files/notice-355120.png"
        attachments[1]["normalized_source_url"] = (
            "https://portal.example.edu/files/notice-355120.png"
        )
        attachments[1]["final_url"] = "https://portal.example.edu/files/notice-355120.png"
        attachments[1]["original_filename"] = "notice-355120.png"
        attachments[1]["byte_size"] = len(png_bytes)
        attachments[1]["sha256"] = second_png_sha256
        attachments[1]["object_key"] = second_png_key
        attachments[2]["attachment_id"] = 103
        attachments[2]["source_url"] = "https://portal.example.edu/files/supplement-355120.pdf"
        attachments[2]["normalized_source_url"] = (
            "https://portal.example.edu/files/supplement-355120.pdf"
        )
        attachments[2]["final_url"] = "https://portal.example.edu/files/supplement-355120.pdf"
        attachments[2]["original_filename"] = "supplement-355120.pdf"

        return bundle, {
            second_docx_key: (
                docx_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            second_png_key: (png_bytes, "image/png"),
        }

    def test_plan_run_writes_frozen_batch_inputs_without_staging_any_documents(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(3))
            _write_json(manifest_path, _sample_export_manifest())
            service, object_store = self._build_service(root=root)

            summary = service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                run_id="run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )

            self.assertEqual(summary["state"], "planned")
            self.assertEqual(summary["expected_notice_count"], 3)
            self.assertEqual(summary["batch_count"], 3)
            self.assertEqual(summary["completed_batch_count"], 0)
            self.assertEqual(summary["running_batch_count"], 0)
            self.assertEqual(summary["pending_batch_count"], 3)
            self.assertEqual(summary["staged_notice_count"], 0)
            self.assertEqual(summary["staged_document_count"], 0)
            self.assertEqual(service.closeout_store.get_staged_notices("run-1"), ())
            self.assertEqual(service.closeout_store.get_staged_documents("run-1"), ())
            self.assertEqual(
                service.document_registry.list_by_scope("campus_notices", "internal_notice"),
                (),
            )
            self.assertEqual(
                service.raw_asset_registry.list_by_scope("campus_notices", "internal_notice"),
                (),
            )

            uploaded_keys = {entry["key"] for entry in object_store.uploads}
            batch_input_key = build_operations_artifact_key(
                corpus="campus_notices",
                operation="authenticated-notice-closeout",
                run_id="run-1",
                filename="input.json",
                segments=("batches", "000001"),
            )
            self.assertIn(
                build_operations_artifact_key(
                    corpus="campus_notices",
                    operation="authenticated-notice-closeout",
                    run_id="run-1",
                    filename="run-manifest.json",
                ),
                uploaded_keys,
            )
            self.assertIn(
                build_operations_artifact_key(
                    corpus="campus_notices",
                    operation="authenticated-notice-closeout",
                    run_id="run-1",
                    filename="shard-plan.json",
                ),
                uploaded_keys,
            )
            self.assertIn(batch_input_key, uploaded_keys)
            batch_input = json.loads(
                object_store.get_bytes(
                    bucket=service.object_store_settings.bucket_derived,
                    key=batch_input_key,
                ).decode("utf-8")
            )
            self.assertEqual(batch_input["batch_id"], 1)
            self.assertEqual(batch_input["shard_id"], 1)
            self.assertEqual(batch_input["notice_ids"], ["355119"])
            self.assertEqual(len(batch_input["bundle_records"]), 1)

    def test_plan_source_truth_replay_run_writes_frozen_parent_inventory(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(root=root)
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
            )

            from campus_ingestion_core.authenticated_notice_source_truth_replay import (
                load_authenticated_notice_source_truth_replay_inventory_from_store,
            )

            with patch(
                "campus_ingestion_core.authenticated_notice_closeout_planning.load_authenticated_notice_source_truth_replay_inventory_from_store",
                wraps=load_authenticated_notice_source_truth_replay_inventory_from_store,
            ) as load_from_store:
                summary = service.plan_source_truth_replay_run(
                    request=AuthenticatedNoticeSourceTruthReplayRequest(),
                    run_id="source-truth-run-1",
                    max_concurrency=2,
                    notice_concurrency=4,
                    object_store_concurrency=16,
                    lease_seconds=120,
                )

            self.assertEqual(load_from_store.call_count, 1)

            self.assertEqual(summary["state"], "planned")
            self.assertEqual(summary["expected_notice_count"], 1)
            self.assertEqual(summary["expected_document_count"], 2)
            self.assertEqual(summary["expected_attachment_document_count"], 1)
            self.assertEqual(summary["expected_ocr_candidate_count"], 1)
            self.assertEqual(
                summary["notice_risk_counts"],
                {"body_with_text_attachments": 1},
            )
            self.assertEqual(summary["high_risk_notice_count"], 0)
            self.assertEqual(summary["batch_count"], 1)

            batch_input_key = build_operations_artifact_key(
                corpus="campus_notices",
                operation="authenticated-notice-closeout",
                run_id="source-truth-run-1",
                filename="input.json",
                segments=("batches", "000001"),
            )
            batch_input = json.loads(
                object_store.get_bytes(
                    bucket=service.object_store_settings.bucket_derived,
                    key=batch_input_key,
                ).decode("utf-8")
            )
            self.assertEqual(batch_input["input_kind"], "source_truth_replay")
            self.assertNotIn("bundle_records", batch_input)
            self.assertEqual(len(batch_input["source_truth_parents"]), 1)
            parent = batch_input["source_truth_parents"][0]
            self.assertEqual(parent["document_id"], "notice:muc_internal_portal:355119")
            self.assertEqual(parent["notice_risk_label"], "body_with_text_attachments")
            self.assertEqual(parent["attachment_ref_count"], 3)
            self.assertEqual(parent["attachment_mix_score"], 5)
            self.assertTrue(parent["has_text_table_attachment"])
            self.assertFalse(parent["has_spatial_attachment"])
            self.assertTrue(parent["has_reference_only_attachment"])
            self.assertEqual(parent["raw_record"]["raw_asset_id"], "asset:authenticated-notice:muc_internal_portal:355119")
            self.assertEqual(
                sorted(item["classification"] for item in parent["attachment_projection_plans"]),
                ["ocr_required", "text_extractable"],
            )
            self.assertEqual(
                {
                    item["attachment_ref_id"]: item["materialization_policy"]
                    for item in parent["attachment_projection_plans"]
                },
                {
                    "attachment-0001": "required_document",
                    "attachment-0002": "conditional_on_extracted_text",
                },
            )

    def test_plan_source_truth_replay_run_filters_to_selected_notice_ids(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(root=root)
            first_docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表第一行", "报名表第二行"))
            first_png_bytes = _build_minimal_png_bytes()
            second_docx_bytes = _build_minimal_docx_bytes(
                paragraphs=("第二条报名表第一行", "第二条报名表第二行")
            )
            second_png_bytes = _build_minimal_png_bytes()
            bundle = _sample_projection_notice_bundle(
                docx_bytes=first_docx_bytes,
                png_bytes=first_png_bytes,
            )
            second_notice, second_payloads = self._build_second_source_truth_notice(
                docx_bytes=second_docx_bytes,
                png_bytes=second_png_bytes,
            )
            bundle.append(second_notice)
            attachment_payloads = {
                str(bundle[0]["attachments"][0]["object_key"]): (
                    first_docx_bytes,
                    str(bundle[0]["attachments"][0]["mime_type"]),
                ),
                str(bundle[0]["attachments"][1]["object_key"]): (
                    first_png_bytes,
                    str(bundle[0]["attachments"][1]["mime_type"]),
                ),
                **second_payloads,
            }
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
                bundle=bundle,
                attachment_payloads=attachment_payloads,
            )

            summary = service.plan_source_truth_replay_run(
                request=AuthenticatedNoticeSourceTruthReplayRequest(
                    notice_ids=("355120", "355120"),
                ),
                run_id="source-truth-run-selected-1",
                max_concurrency=1,
                notice_concurrency=2,
                object_store_concurrency=8,
                lease_seconds=120,
            )

            self.assertEqual(summary["state"], "planned")
            self.assertEqual(summary["selected_notice_ids"], ["355120"])
            self.assertEqual(
                summary["notice_risk_counts"],
                {"body_with_text_attachments": 1},
            )
            self.assertEqual(summary["expected_notice_count"], 1)

            batch_input_key = build_operations_artifact_key(
                corpus="campus_notices",
                operation="authenticated-notice-closeout",
                run_id="source-truth-run-selected-1",
                filename="input.json",
                segments=("batches", "000001"),
            )
            batch_input = json.loads(
                object_store.get_bytes(
                    bucket=service.object_store_settings.bucket_derived,
                    key=batch_input_key,
                ).decode("utf-8")
            )
            self.assertEqual(batch_input["notice_ids"], ["355120"])
            self.assertEqual(
                [item["notice_id"] for item in batch_input["source_truth_parents"]],
                ["355120"],
            )

            run_manifest_key = build_operations_artifact_key(
                corpus="campus_notices",
                operation="authenticated-notice-closeout",
                run_id="source-truth-run-selected-1",
                filename="run-manifest.json",
            )
            run_manifest = json.loads(
                object_store.get_bytes(
                    bucket=service.object_store_settings.bucket_derived,
                    key=run_manifest_key,
                ).decode("utf-8")
            )
            self.assertEqual(run_manifest["selected_notice_ids"], ["355120"])

            run = service.closeout_store.get_run("source-truth-run-selected-1")
            assert run is not None
            self.assertEqual(run.selected_notice_ids, ("355120",))

    def test_plan_run_parallelizes_batch_artifact_writes_and_records_progress(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(8))
            _write_json(manifest_path, _sample_export_manifest())
            object_store = _SlowTrackingObjectStore(delay_seconds=0.01)
            service, _ = self._build_service(root=root, object_store=object_store)

            summary = service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                run_id="run-parallel-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=4,
                lease_seconds=120,
            )

            self.assertEqual(summary["state"], "planned")
            self.assertGreaterEqual(object_store.max_put_inflight, 2)
            milestones = {
                item["name"]: item["payload"]
                for item in service.closeout_store.get_milestones("run-parallel-1")
            }
            self.assertEqual(
                milestones["batch_inputs_progress"]["completed_batch_count"],
                summary["batch_count"],
            )
            self.assertEqual(
                milestones["batch_inputs_progress"]["total_batch_count"],
                summary["batch_count"],
            )
            self.assertEqual(
                milestones["batch_manifests_progress"]["completed_batch_count"],
                summary["batch_count"],
            )
            self.assertEqual(
                milestones["batch_manifests_progress"]["total_batch_count"],
                summary["batch_count"],
            )

    def test_rebuild_source_truth_inventory_allows_projection_only_planning(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(root=root)
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
            )

            from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
                InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
                rebuild_authenticated_notice_source_truth_inventory,
            )

            inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
            rebuild_authenticated_notice_source_truth_inventory(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                object_store=object_store,
                object_store_settings=service.object_store_settings,
                inventory_store=inventory_store,
            )
            service.planning.source_truth_inventory_store = inventory_store

            summary = service.plan_source_truth_replay_run(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                run_id="source-truth-run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )

            self.assertEqual(summary["state"], "planned")
            self.assertEqual(summary["expected_notice_count"], 1)

    def test_rebuild_source_truth_inventory_selected_notice_ids_do_not_shrink_full_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(root=root)
            first_docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表第一行", "报名表第二行"))
            first_png_bytes = _build_minimal_png_bytes()
            second_docx_bytes = _build_minimal_docx_bytes(
                paragraphs=("第二条报名表第一行", "第二条报名表第二行")
            )
            second_png_bytes = _build_minimal_png_bytes()
            bundle = _sample_projection_notice_bundle(
                docx_bytes=first_docx_bytes,
                png_bytes=first_png_bytes,
            )
            second_notice, second_payloads = self._build_second_source_truth_notice(
                docx_bytes=second_docx_bytes,
                png_bytes=second_png_bytes,
            )
            bundle.append(second_notice)
            attachment_payloads = {
                str(bundle[0]["attachments"][0]["object_key"]): (
                    first_docx_bytes,
                    str(bundle[0]["attachments"][0]["mime_type"]),
                ),
                str(bundle[0]["attachments"][1]["object_key"]): (
                    first_png_bytes,
                    str(bundle[0]["attachments"][1]["mime_type"]),
                ),
                **second_payloads,
            }
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
                bundle=bundle,
                attachment_payloads=attachment_payloads,
            )

            from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
                InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
                rebuild_authenticated_notice_source_truth_inventory,
            )

            inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
            rebuild_authenticated_notice_source_truth_inventory(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                object_store=object_store,
                object_store_settings=service.object_store_settings,
                inventory_store=inventory_store,
            )
            self.assertEqual(
                tuple(entry.notice_id for entry in inventory_store.list_by_scope("campus_notices", "internal_notice")),
                ("355119", "355120"),
            )

            rebuild_authenticated_notice_source_truth_inventory(
                request=AuthenticatedNoticeSourceTruthReplayRequest(notice_ids=("355120",)),
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                object_store=object_store,
                object_store_settings=service.object_store_settings,
                inventory_store=inventory_store,
            )

            self.assertEqual(
                tuple(entry.notice_id for entry in inventory_store.list_by_scope("campus_notices", "internal_notice")),
                ("355119", "355120"),
            )

    def test_repair_source_truth_replay_refreshes_frozen_inventory_counts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(
                root=root,
                ocr_client=_FakeAttachmentNoTextOcrClient(),
            )
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
            )

            service.plan_source_truth_replay_run(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                run_id="source-truth-run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )
            poisoned = service.closeout_store.get_run("source-truth-run-1")
            assert poisoned is not None
            service.closeout_store.save_run(
                replace(
                    poisoned,
                    expected_document_count=3,
                    expected_attachment_document_count=2,
                    expected_ocr_candidate_count=0,
                )
            )

            repaired = service.repair_run("source-truth-run-1")

            self.assertEqual(repaired["expected_document_count"], 2)
            self.assertEqual(repaired["expected_attachment_document_count"], 1)
            self.assertEqual(repaired["expected_ocr_candidate_count"], 1)
            milestone_names = [
                item["name"] for item in service.closeout_store.get_milestones("source-truth-run-1")
            ]
            self.assertIn("inventory_refreshed", milestone_names)

    def test_repair_source_truth_replay_rebuilds_plans_from_frozen_source_truth(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(
                root=root,
                ocr_client=_FakeAttachmentOcrClient(),
            )
            docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表第一行", "报名表第二行"))
            gif_bytes = _build_minimal_gif_bytes()
            bundle = _sample_notice_bundle_with_decorative_gif(
                docx_bytes=docx_bytes,
                gif_bytes=gif_bytes,
            )
            attachment_payloads = {
                str(bundle[0]["attachments"][0]["object_key"]): (
                    docx_bytes,
                    str(bundle[0]["attachments"][0]["mime_type"]),
                ),
                str(bundle[0]["attachments"][1]["object_key"]): (
                    gif_bytes,
                    str(bundle[0]["attachments"][1]["mime_type"]),
                ),
            }
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
                bundle=bundle,
                attachment_payloads=attachment_payloads,
            )

            service.plan_source_truth_replay_run(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                run_id="source-truth-run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )
            poisoned = service.closeout_store.get_run("source-truth-run-1")
            assert poisoned is not None
            inventory_key = str(poisoned.source_truth_inventory_object_key)
            inventory_payload = json.loads(
                object_store.get_bytes(bucket="campus-rag-derived", key=inventory_key).decode("utf-8")
            )
            inventory_payload["expected_ocr_candidate_count"] = 1
            parent = dict(inventory_payload["parents"][0])
            parent["attachment_projection_plans"] = [
                {
                    "attachment_ref_id": "attachment-0001",
                    "classification": "text_extractable",
                    "document_id": "notice_attachment:muc_internal_portal:355119:attachment-0001",
                    "materialization_policy": "required_document",
                },
                {
                    "attachment_ref_id": "attachment-0002",
                    "classification": "ocr_required",
                    "document_id": "notice_attachment:muc_internal_portal:355119:attachment-0002",
                    "materialization_policy": "conditional_on_extracted_text",
                },
            ]
            parent["expected_attachment_documents"] = [
                {
                    "attachment_ref_id": "attachment-0001",
                    "classification": "text_extractable",
                    "document_id": "notice_attachment:muc_internal_portal:355119:attachment-0001",
                    "materialization_policy": "required_document",
                }
            ]
            parent["text_extractable_count"] = 1
            parent["ocr_required_count"] = 1
            parent["attachment_document_count"] = 1
            inventory_payload["parents"] = [parent]
            object_store.put_bytes(
                bucket="campus-rag-derived",
                key=inventory_key,
                data=json.dumps(
                    inventory_payload,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                ).encode("utf-8"),
                content_type="application/json",
            )
            service.closeout_store.save_run(
                replace(
                    poisoned,
                    expected_document_count=2,
                    expected_attachment_document_count=1,
                    expected_ocr_candidate_count=1,
                )
            )

            repaired = service.repair_run("source-truth-run-1")

            self.assertEqual(repaired["expected_document_count"], 2)
            self.assertEqual(repaired["expected_attachment_document_count"], 1)
            self.assertEqual(repaired["expected_ocr_candidate_count"], 0)
            refreshed_payload = json.loads(
                object_store.get_bytes(bucket="campus-rag-derived", key=inventory_key).decode("utf-8")
            )
            refreshed_parent = refreshed_payload["parents"][0]
            self.assertEqual(
                refreshed_parent["attachment_projection_plans"],
                [
                    {
                        "attachment_ref_id": "attachment-0001",
                        "classification": "text_extractable",
                        "document_id": "notice_attachment:muc_internal_portal:355119:attachment-0001",
                        "materialization_policy": "required_document",
                    }
                ],
            )
            self.assertEqual(refreshed_parent["attachment_document_count"], 1)
            self.assertEqual(refreshed_parent["ocr_required_count"], 0)

    def test_repair_source_truth_replay_reopens_completed_batches_with_stale_attachment_outcomes(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(
                root=root,
                ocr_client=_FakeAttachmentOcrClient(),
            )
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
            )

            verified = service.run_worker(
                run_id=service.plan_source_truth_replay_run(
                    request=AuthenticatedNoticeSourceTruthReplayRequest(),
                    run_id="source-truth-run-1",
                    max_concurrency=2,
                    notice_concurrency=4,
                    object_store_concurrency=16,
                    lease_seconds=120,
                )["run_id"],
                worker_id="worker-a",
                poll_interval=0.0,
            )
            self.assertEqual(verified["state"], "verified")

            service.closeout_store._notices["source-truth-run-1"]["355119"][
                "attachment_outcomes"
            ] = []
            broken_run = service.closeout_store.get_run("source-truth-run-1")
            assert broken_run is not None
            service.closeout_store.save_run(
                replace(
                    broken_run,
                    state=CloseoutRunState.VERIFYING,
                    verification={},
                    finished_at=None,
                )
            )

            with self.assertRaisesRegex(ValueError, "verification failed"):
                service.run_verifier.verify_run("source-truth-run-1")

            repaired = service.repair_run("source-truth-run-1")
            repaired_batch = service.closeout_store.get_batch("source-truth-run-1", 1)
            assert repaired_batch is not None

            self.assertEqual(repaired["state"], "planned")
            self.assertEqual(repaired["completed_batch_count"], 0)
            self.assertEqual(repaired["pending_batch_count"], 1)
            self.assertEqual(repaired_batch.state, CloseoutBatchState.PENDING)
            self.assertEqual(repaired_batch.batch_id, 1)
            self.assertEqual(repaired["verification"], {})

            resumed = service.run_worker(
                run_id="source-truth-run-1",
                worker_id="worker-b",
                poll_interval=0.0,
            )
            self.assertEqual(resumed["state"], "verified")
            self.assertEqual(resumed["verification"]["missing_attachment_outcome_count"], 0)
            staged_notice = service.closeout_store.get_staged_notices("source-truth-run-1")[0]
            self.assertEqual(len(staged_notice["attachment_outcomes"]), 2)

    def test_source_truth_replay_workers_stage_parent_and_child_documents(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(
                root=root,
                ocr_client=_FakeAttachmentOcrClient(),
            )
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
            )

            service.plan_source_truth_replay_run(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                run_id="source-truth-run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )

            verified = service.run_worker(
                run_id="source-truth-run-1",
                worker_id="worker-a",
                poll_interval=0.0,
            )

            self.assertEqual(verified["state"], "verified")
            self.assertEqual(verified["expected_notice_count"], 1)
            self.assertEqual(verified["expected_document_count"], 2)
            self.assertEqual(verified["expected_ocr_candidate_count"], 1)
            self.assertEqual(verified["staged_notice_count"], 1)
            self.assertEqual(verified["staged_raw_asset_count"], 1)
            self.assertEqual(verified["staged_document_count"], 3)
            self.assertEqual(verified["verification"]["expected_document_id_count"], 3)
            self.assertEqual(verified["verification"]["required_document_count"], 2)
            self.assertEqual(verified["verification"]["expected_ocr_candidate_count"], 1)
            self.assertEqual(verified["verification"]["missing_document_id_count"], 0)
            self.assertTrue(verified["verification"]["ok"])

            promotion = service.promote_run("source-truth-run-1")
            self.assertEqual(promotion["state"], "done")
            self.assertEqual(promotion["replaced_scope_record_count"], 3)
            records = service.document_registry.list_by_scope(
                "campus_notices",
                "internal_notice",
            )
            self.assertEqual(len(records), 3)
            self.assertTrue(
                any(record.document_id.startswith("notice_attachment:") for record in records)
            )

    def test_source_truth_replay_workers_record_no_text_ocr_outcome_without_child_document(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(
                root=root,
                ocr_client=_FakeAttachmentNoTextOcrClient(),
            )
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
            )

            service.plan_source_truth_replay_run(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                run_id="source-truth-run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )

            verified = service.run_worker(
                run_id="source-truth-run-1",
                worker_id="worker-a",
                poll_interval=0.0,
            )

            self.assertEqual(verified["state"], "verified")
            self.assertEqual(verified["expected_document_count"], 2)
            self.assertEqual(verified["expected_attachment_document_count"], 1)
            self.assertEqual(verified["expected_ocr_candidate_count"], 1)
            self.assertEqual(verified["staged_document_count"], 2)
            self.assertEqual(verified["verification"]["expected_document_id_count"], 2)
            self.assertEqual(verified["verification"]["materialized_ocr_attachment_document_count"], 0)
            self.assertEqual(verified["verification"]["no_extractable_text_attachment_count"], 1)
            self.assertEqual(verified["verification"]["missing_attachment_outcome_count"], 0)
            self.assertTrue(verified["verification"]["ok"])

            staged_notice = service.closeout_store.get_staged_notices("source-truth-run-1")[0]
            self.assertEqual(len(staged_notice["attachment_outcomes"]), 2)
            self.assertEqual(
                [item["outcome"] for item in staged_notice["attachment_outcomes"]],
                ["materialized_document", "no_extractable_text"],
            )
            no_text_outcome = staged_notice["attachment_outcomes"][1]
            self.assertEqual(no_text_outcome["attachment_ref_id"], "attachment-0002")
            self.assertEqual(no_text_outcome["classification"], "ocr_required")
            self.assertEqual(
                no_text_outcome["materialization_policy"],
                "conditional_on_extracted_text",
            )
            self.assertTrue(
                no_text_outcome["provider_response_staged_object_key"].endswith(
                    f"/attachments/{document_stage_slug(no_text_outcome['document_id'])}/provider-response.jsonl"
                )
            )

            promotion = service.promote_run("source-truth-run-1")
            self.assertEqual(promotion["state"], "done")
            self.assertEqual(promotion["replaced_scope_record_count"], 2)
            records = service.document_registry.list_by_scope("campus_notices", "internal_notice")
            self.assertEqual(len(records), 2)

    def test_source_truth_replay_no_text_provider_response_keys_are_unique_per_notice(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(
                root=root,
                ocr_client=_FakeAttachmentNoTextOcrClient(),
            )
            service.planner = CloseoutPlanner(shard_size=2, batch_size=2, max_shards=4)
            first_docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表第一行", "报名表第二行"))
            first_png_bytes = _build_minimal_png_bytes()
            second_docx_bytes = _build_minimal_docx_bytes(
                paragraphs=("第二条报名表第一行", "第二条报名表第二行")
            )
            second_png_bytes = _build_minimal_png_bytes()
            bundle = _sample_projection_notice_bundle(
                docx_bytes=first_docx_bytes,
                png_bytes=first_png_bytes,
            )
            second_notice, second_payloads = self._build_second_source_truth_notice(
                docx_bytes=second_docx_bytes,
                png_bytes=second_png_bytes,
            )
            bundle.append(second_notice)
            attachment_payloads = {
                str(bundle[0]["attachments"][0]["object_key"]): (
                    first_docx_bytes,
                    str(bundle[0]["attachments"][0]["mime_type"]),
                ),
                str(bundle[0]["attachments"][1]["object_key"]): (
                    first_png_bytes,
                    str(bundle[0]["attachments"][1]["mime_type"]),
                ),
                **second_payloads,
            }
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
                bundle=bundle,
                attachment_payloads=attachment_payloads,
            )

            service.plan_source_truth_replay_run(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                run_id="source-truth-run-unique-provider-keys",
                max_concurrency=1,
                notice_concurrency=2,
                object_store_concurrency=8,
                lease_seconds=120,
            )
            verified = service.run_worker(
                run_id="source-truth-run-unique-provider-keys",
                worker_id="worker-a",
                poll_interval=0.0,
            )

            self.assertEqual(verified["state"], "verified")
            staged_notices = service.closeout_store.get_staged_notices(
                "source-truth-run-unique-provider-keys"
            )
            no_text_outcomes = [
                outcome
                for staged_notice in staged_notices
                for outcome in staged_notice["attachment_outcomes"]
                if outcome["outcome"] == "no_extractable_text"
            ]
            self.assertEqual(len(no_text_outcomes), 2)
            provider_keys = {
                str(outcome["document_id"]): str(outcome["provider_response_staged_object_key"])
                for outcome in no_text_outcomes
            }
            self.assertEqual(len(set(provider_keys.values())), 2)
            for document_id, key in provider_keys.items():
                self.assertTrue(
                    key.endswith(
                        f"/attachments/{document_stage_slug(document_id)}/provider-response.jsonl"
                    )
                )

    def test_source_truth_replay_workers_keep_spatial_inline_images_in_manual_review(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(
                root=root,
                ocr_client=_FakeAttachmentOcrClient(),
            )
            docx_bytes = _build_minimal_docx_bytes(paragraphs=("报名表第一行", "报名表第二行"))
            png_bytes = _build_map_like_png_bytes()
            bundle = _sample_projection_notice_bundle(docx_bytes=docx_bytes, png_bytes=png_bytes)
            attachment_payloads = {
                str(bundle[0]["attachments"][0]["object_key"]): (
                    docx_bytes,
                    str(bundle[0]["attachments"][0]["mime_type"]),
                ),
                str(bundle[0]["attachments"][1]["object_key"]): (
                    png_bytes,
                    str(bundle[0]["attachments"][1]["mime_type"]),
                ),
            }
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
                bundle=bundle,
                attachment_payloads=attachment_payloads,
            )

            from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
                rebuild_authenticated_notice_source_truth_inventory,
            )

            rebuild_authenticated_notice_source_truth_inventory(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                object_store=object_store,
                object_store_settings=service.object_store_settings,
                inventory_store=service.source_truth_inventory_store,
            )

            service.plan_source_truth_replay_run(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                run_id="source-truth-run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )

            verified = service.run_worker(
                run_id="source-truth-run-1",
                worker_id="worker-a",
                poll_interval=0.0,
            )

            self.assertEqual(verified["state"], "verified")
            self.assertEqual(verified["expected_document_count"], 2)
            self.assertEqual(verified["expected_attachment_document_count"], 1)
            self.assertEqual(verified["expected_ocr_candidate_count"], 0)
            self.assertEqual(
                verified["notice_risk_counts"],
                {"mixed_high_risk": 1},
            )
            self.assertEqual(verified["high_risk_notice_count"], 1)
            self.assertEqual(verified["staged_document_count"], 2)
            self.assertEqual(verified["verification"]["manual_review_required_attachment_count"], 1)
            self.assertEqual(verified["verification"]["missing_attachment_outcome_count"], 0)
            self.assertTrue(verified["verification"]["ok"])

            staged_notice = service.closeout_store.get_staged_notices("source-truth-run-1")[0]
            self.assertEqual(len(staged_notice["attachment_outcomes"]), 2)
            manual_outcome = staged_notice["attachment_outcomes"][1]
            self.assertEqual(manual_outcome["classification"], "manual_review_required")
            self.assertEqual(manual_outcome["materialization_policy"], "manual_review")
            self.assertEqual(manual_outcome["outcome"], "manual_review_required")
            self.assertEqual(manual_outcome["review_reason"], "spatial_visual_asset")

            promotion = service.promote_run("source-truth-run-1")
            self.assertEqual(promotion["state"], "done")
            self.assertEqual(promotion["replaced_scope_record_count"], 2)

    def test_source_truth_replay_verification_reads_frozen_inventory_not_batch_inputs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = self._build_service(
                root=root,
                ocr_client=_FakeAttachmentOcrClient(),
            )
            self._bootstrap_source_truth_scope(
                root=root,
                object_store=object_store,
                document_registry=service.document_registry,
                raw_asset_registry=service.raw_asset_registry,
                source_truth_inventory_store=service.source_truth_inventory_store,
            )

            service.plan_source_truth_replay_run(
                request=AuthenticatedNoticeSourceTruthReplayRequest(),
                run_id="source-truth-run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )
            verified = service.run_worker(
                run_id="source-truth-run-1",
                worker_id="worker-a",
                poll_interval=0.0,
            )
            self.assertEqual(verified["state"], "verified")

            batch_input_key = build_operations_artifact_key(
                corpus="campus_notices",
                operation="authenticated-notice-closeout",
                run_id="source-truth-run-1",
                filename="input.json",
                segments=("batches", "000001"),
            )
            del object_store.objects[(service.object_store_settings.bucket_derived, batch_input_key)]

            verification = service.run_verifier.verify_run("source-truth-run-1")

            self.assertTrue(verification["ok"])

    def test_workers_can_resume_from_planned_batches_and_finalize_verification(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(3))
            _write_json(manifest_path, _sample_export_manifest())
            service, object_store = self._build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                run_id="run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )

            first_worker = service.run_worker(
                run_id="run-1",
                worker_id="worker-a",
                poll_interval=0.0,
                max_batches=1,
            )
            self.assertEqual(first_worker["state"], "running")
            self.assertEqual(first_worker["completed_batch_count"], 1)

            second_worker = service.run_worker(
                run_id="run-1",
                worker_id="worker-b",
                poll_interval=0.0,
            )
            self.assertEqual(second_worker["state"], "verified")
            self.assertEqual(second_worker["staged_notice_count"], 3)
            self.assertEqual(second_worker["staged_document_count"], 3)
            self.assertEqual(second_worker["completed_batch_count"], 3)
            self.assertEqual(second_worker["pending_batch_count"], 0)
            self.assertEqual(second_worker["active_worker_count"], 0)
            self.assertEqual(second_worker["verification"]["missing_document_id_count"], 0)
            self.assertTrue(second_worker["verification"]["ok"])

            status = service.show_run("run-1")
            self.assertEqual(status["state"], "verified")
            self.assertEqual(len(service.closeout_store.get_staged_notices("run-1")), 3)
            self.assertEqual(len(service.closeout_store.get_staged_documents("run-1")), 3)
            uploaded_keys = {entry["key"] for entry in object_store.uploads}
            self.assertIn(
                build_operations_artifact_key(
                    corpus="campus_notices",
                    operation="authenticated-notice-closeout",
                    run_id="run-1",
                    filename="verified.json",
                    segments=("milestones",),
                ),
                uploaded_keys,
            )
            self.assertIn(
                build_operations_artifact_key(
                    corpus="campus_notices",
                    operation="authenticated-notice-closeout",
                    run_id="run-1",
                    filename="manifest.json",
                    segments=("batches", "000003"),
                ),
                uploaded_keys,
            )

            promotion = service.promote_run("run-1")
            self.assertEqual(promotion["state"], "done")
            self.assertEqual(promotion["replaced_scope_record_count"], 3)
            self.assertEqual(
                len(
                    service.document_registry.list_by_scope(
                        "campus_notices",
                        "internal_notice",
                    )
                ),
                3,
            )

    def test_promote_run_can_resume_from_promoting_state(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(2))
            _write_json(manifest_path, _sample_export_manifest())
            service, _object_store = self._build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                run_id="run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )
            verified = service.run_worker(
                run_id="run-1",
                worker_id="worker-a",
                poll_interval=0.0,
            )
            self.assertEqual(verified["state"], "verified")

            run = service.closeout_store.get_run("run-1")
            assert run is not None
            service.closeout_store.save_run(
                replace(run, state=CloseoutRunState.PROMOTING)
            )

            promotion = service.promote_run("run-1")
            self.assertEqual(promotion["state"], "done")
            self.assertEqual(promotion["replaced_scope_record_count"], 2)

    def test_show_run_keeps_run_state_when_promotion_payload_has_its_own_state(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, _object_store = self._build_service(root=root)
            run_started_at = "2026-04-04T00:00:00+00:00"
            promotion_started_at = "2026-04-05T00:00:00+00:00"
            run = CloseoutRun(
                run_id="run-1",
                bundle_path="/tmp/bundle.json",
                manifest_path="/tmp/manifest.json",
                expected_notice_count=2,
                operations_prefix="campus_notices/operations/authenticated-notice-closeout/run-1",
                batch_count=2,
                completed_batch_count=2,
                staged_notice_count=2,
                staged_raw_asset_count=2,
                staged_document_count=2,
                processed_notice_count=2,
                started_at=run_started_at,
                promotion={
                    "promotion_id": "promotion-0001",
                    "state": "running",
                    "phase": "copying",
                    "started_at": promotion_started_at,
                    "copy_batch_count": 2,
                    "copy_completed_batch_count": 1,
                },
            ).mark_planned().mark_running().mark_verified({"ok": True}).mark_promoting()
            service.closeout_store.save_run(run)

            summary = service.show_run("run-1")

            self.assertEqual(summary["state"], "promoting")
            self.assertEqual(summary["promotion"]["state"], "running")
            self.assertEqual(summary["promotion"]["phase"], "copying")
            self.assertEqual(summary["promotion_state"], "running")
            self.assertEqual(summary["promotion_phase"], "copying")
            self.assertEqual(summary["started_at"], run_started_at)
            self.assertEqual(summary["promotion_started_at"], promotion_started_at)

    def test_promote_run_persists_copy_progress_and_resumes_after_copy_failure(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(3))
            _write_json(manifest_path, _sample_export_manifest())
            service, _object_store = self._build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                run_id="run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )
            verified = service.run_worker(
                run_id="run-1",
                worker_id="worker-a",
                poll_interval=0.0,
            )
            self.assertEqual(verified["state"], "verified")

            service.promotion.copy_batch_size = 1
            original_copy_batch = service.promotion._copy_document_batch
            copy_batch_calls = 0

            def _crashing_copy_batch(*args, **kwargs):
                nonlocal copy_batch_calls
                copy_batch_calls += 1
                if copy_batch_calls == 2:
                    raise RuntimeError("copy batch crashed")
                return original_copy_batch(*args, **kwargs)

            with self.assertRaisesRegex(RuntimeError, "copy batch crashed"):
                with patch.object(
                    service.promotion,
                    "_copy_document_batch",
                    side_effect=_crashing_copy_batch,
                ):
                    service.promote_run("run-1")

            partial = service.show_run("run-1")
            self.assertEqual(partial["state"], "promoting")
            self.assertEqual(partial["promotion_state"], "running")
            self.assertEqual(partial["promotion_phase"], "copying")
            self.assertEqual(partial["promotion"]["copy_batch_count"], 3)
            self.assertEqual(partial["promotion"]["copy_completed_batch_count"], 1)
            self.assertEqual(partial["promotion"]["copied_document_count"], 1)

            resumed = service.promote_run("run-1")
            self.assertEqual(resumed["state"], "done")
            self.assertEqual(resumed["promotion_state"], "done")
            self.assertEqual(resumed["promotion"]["copy_completed_batch_count"], 3)
            self.assertEqual(resumed["promotion"]["copied_document_count"], 3)
            self.assertEqual(resumed["replaced_scope_record_count"], 3)

    def test_promote_run_uses_bulk_raw_asset_sync_without_per_record_gets(self) -> None:
        class _BulkOnlyRawAssetRegistry(InMemoryRawAssetRegistry):
            def __init__(self, *, backing_path: Path | None = None) -> None:
                super().__init__(backing_path=backing_path)
                self.upsert_many_calls = 0

            def get(self, raw_asset_id: str, raw_version_id: str):
                raise AssertionError("promotion should not probe raw assets one by one")

            def list_by_scope(self, corpus: str, collection: str | None = None):
                raise AssertionError("promotion should not scan raw asset scope before bulk sync")

            def upsert_many(self, records):
                self.upsert_many_calls += 1
                for record in records:
                    self.upsert(record)

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(2))
            _write_json(manifest_path, _sample_export_manifest())
            object_store = _FakeObjectStore()
            raw_registry = _BulkOnlyRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            service = AuthenticatedNoticeCloseoutService(
                closeout_store=InMemoryCloseoutStore(),
                object_store=object_store,
                object_store_settings=ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                ),
                document_registry=InMemoryDocumentRegistry(
                    backing_path=root / "registry" / "documents.json"
                ),
                raw_asset_registry=raw_registry,
                planner=CloseoutPlanner(shard_size=2, batch_size=1, max_shards=4),
            )
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                run_id="run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )
            verified = service.run_worker(
                run_id="run-1",
                worker_id="worker-a",
                poll_interval=0.0,
            )
            self.assertEqual(verified["state"], "verified")

            promotion = service.promote_run("run-1")

            self.assertEqual(promotion["state"], "done")
            self.assertEqual(raw_registry.upsert_many_calls, 1)

    def test_partial_planned_run_does_not_finalize_verification(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(4))
            _write_json(manifest_path, _sample_export_manifest())
            service, _object_store = self._build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                run_id="run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )

            del service.closeout_store._batches["run-1"][3]
            del service.closeout_store._batches["run-1"][4]

            worker_summary = service.run_worker(
                run_id="run-1",
                worker_id="worker-a",
                poll_interval=0.0,
            )
            self.assertEqual(worker_summary["state"], "running")
            self.assertEqual(worker_summary["batch_count"], 4)
            self.assertEqual(worker_summary["completed_batch_count"], 2)
            self.assertEqual(worker_summary["pending_batch_count"], 2)
            self.assertEqual(worker_summary["verification"], {})

            milestone_names = [
                item["name"] for item in service.closeout_store.get_milestones("run-1")
            ]
            self.assertNotIn("staged", milestone_names)
            self.assertNotIn("verified", milestone_names)
            with self.assertRaisesRegex(ValueError, "verification failed"):
                service.run_verifier.verify_run("run-1")

    def test_repair_run_restores_missing_batches_and_resumes_same_run(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(4))
            _write_json(manifest_path, _sample_export_manifest())
            service, _object_store = self._build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                run_id="run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )
            del service.closeout_store._batches["run-1"][3]
            del service.closeout_store._batches["run-1"][4]
            partial = service.run_worker(
                run_id="run-1",
                worker_id="worker-a",
                poll_interval=0.0,
            )
            broken_run = service.closeout_store.get_run("run-1")
            assert broken_run is not None
            service.closeout_store.save_run(
                replace(
                    broken_run,
                    state=CloseoutRunState.VERIFIED,
                    verification={"ok": True, "expected_notice_count": 2},
                )
            )

            repaired = service.repair_run("run-1")
            self.assertEqual(partial["completed_batch_count"], 2)
            self.assertEqual(repaired["state"], "running")
            self.assertEqual(repaired["batch_count"], 4)
            self.assertEqual(repaired["completed_batch_count"], 2)
            self.assertEqual(repaired["pending_batch_count"], 2)
            self.assertEqual(repaired["verification"], {})
            self.assertIsNotNone(service.closeout_store.get_batch("run-1", 3))
            self.assertIsNotNone(service.closeout_store.get_batch("run-1", 4))

            resumed = service.run_worker(
                run_id="run-1",
                worker_id="worker-b",
                poll_interval=0.0,
            )
            self.assertEqual(resumed["state"], "verified")
            self.assertEqual(resumed["expected_notice_count"], 4)
            self.assertEqual(resumed["completed_batch_count"], 4)
            self.assertEqual(resumed["staged_notice_count"], 4)
            self.assertTrue(resumed["verification"]["ok"])

    def test_repair_run_resets_failed_batches_and_resumes_same_run(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(4))
            _write_json(manifest_path, _sample_export_manifest())
            service, _object_store = self._build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                run_id="run-1",
                max_concurrency=2,
                notice_concurrency=4,
                object_store_concurrency=16,
                lease_seconds=120,
            )

            claimed = service.closeout_store.claim_next_batch(
                "run-1",
                worker_id="worker-a",
                lease_seconds=120,
            )
            assert claimed is not None
            service.closeout_store.fail_batch(
                run_id="run-1",
                worker_id="worker-a",
                batch_id=claimed.batch_id,
                error="NoSuchKey",
            )

            repaired = service.repair_run("run-1")
            repaired_batch = service.closeout_store.get_batch("run-1", claimed.batch_id)
            assert repaired_batch is not None
            self.assertEqual(repaired["state"], "planned")
            self.assertEqual(repaired["failed_shard_count"], 0)
            self.assertEqual(repaired["pending_batch_count"], 4)
            self.assertEqual(repaired_batch.state, CloseoutBatchState.PENDING)
            self.assertIsNone(repaired_batch.worker_id)
            self.assertIsNone(repaired_batch.error)

            resumed = service.run_worker(
                run_id="run-1",
                worker_id="worker-b",
                poll_interval=0.0,
            )
            self.assertEqual(resumed["state"], "verified")
            self.assertEqual(resumed["expected_notice_count"], 4)
            self.assertEqual(resumed["completed_batch_count"], 4)


class CloseoutVerifierTest(unittest.TestCase):
    def test_verifier_reconciles_document_and_raw_asset_sets(self) -> None:
        verifier = CloseoutVerifier()

        document_report = verifier.reconcile_documents(
            {"notice:muc:1", "notice:muc:2"},
            {"notice:muc:1"},
        )
        raw_report = verifier.reconcile_raw_assets(
            {"asset:1", "asset:2"},
            {"asset:1", "asset:3"},
        )

        self.assertEqual(document_report["missing_document_id_count"], 1)
        self.assertEqual(document_report["unexpected_document_id_count"], 0)
        self.assertEqual(raw_report["matching_raw_asset_id_count"], 1)
        self.assertEqual(raw_report["unexpected_raw_asset_id_count"], 1)


if __name__ == "__main__":
    unittest.main()
