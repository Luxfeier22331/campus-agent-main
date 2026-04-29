from __future__ import annotations

import unittest

from .authenticated_notice_closeout_async_test_support import *


class AuthenticatedNoticeCloseoutAsyncVerificationAndPromotionTest(unittest.TestCase):
    def test_workers_can_resume_from_planned_batches_and_finalize_verification(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(3))
            _write_json(manifest_path, _sample_export_manifest())
            service, object_store = _build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
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
            service, _object_store = _build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
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
            service.closeout_store.save_run(replace(run, state=CloseoutRunState.PROMOTING))

            promotion = service.promote_run("run-1")
            self.assertEqual(promotion["state"], "done")
            self.assertEqual(promotion["replaced_scope_record_count"], 2)

    def test_show_run_keeps_run_state_when_promotion_payload_has_its_own_state(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, _object_store = _build_service(root=root)
            run_started_at = "2026-04-04T00:00:00+00:00"
            promotion_started_at = "2026-04-05T00:00:00+00:00"
            run = (
                CloseoutRun(
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
                )
                .mark_planned()
                .mark_running()
                .mark_verified({"ok": True})
                .mark_promoting()
            )
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
            service, _object_store = _build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
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

            with (
                self.assertRaisesRegex(RuntimeError, "copy batch crashed"),
                patch.object(
                    service.promotion,
                    "_copy_document_batch",
                    side_effect=_crashing_copy_batch,
                ),
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
                    allow_local_fixture_import=True,
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
            service, _object_store = _build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
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
            service, _object_store = _build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
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
            service, _object_store = _build_service(root=root)
            service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
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
