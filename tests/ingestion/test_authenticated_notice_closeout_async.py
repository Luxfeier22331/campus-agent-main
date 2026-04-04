from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.authenticated_notice_closeout import (
    AuthenticatedNoticeCloseoutService,
    CloseoutBatchState,
    CloseoutPlanner,
    CloseoutRun,
    CloseoutRunState,
    CloseoutVerifier,
    InMemoryCloseoutStore,
)
from campus_ingestion_core.authenticated_notice_import import AuthenticatedNoticeImportRequest
from campus_ingestion_core.object_store import build_operations_artifact_key
from campus_ingestion_core.settings import ObjectStoreSettings
from tests.ingestion.test_authenticated_notice_import import (
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
    _write_json,
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


class CloseoutRunModelTest(unittest.TestCase):
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


class AuthenticatedNoticeCloseoutServiceTest(unittest.TestCase):
    def _build_service(
        self,
        *,
        root: Path,
    ) -> tuple[AuthenticatedNoticeCloseoutService, _FakeObjectStore]:
        object_store = _FakeObjectStore()
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
            raw_asset_registry=InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            ),
            planner=CloseoutPlanner(shard_size=2, batch_size=1, max_shards=4),
        )
        return service, object_store

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
