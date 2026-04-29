from __future__ import annotations

import unittest

from .authenticated_notice_closeout_async_test_support import *


class AuthenticatedNoticeCloseoutAsyncPlanningInventoryTest(unittest.TestCase):
    def test_plan_run_writes_frozen_batch_inputs_without_staging_any_documents(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            _write_json(bundle_path, _build_notice_bundle(3))
            _write_json(manifest_path, _sample_export_manifest())
            service, object_store = _build_service(root=root)

            summary = service.plan_run(
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
            service, object_store = _build_service(root=root)
            _bootstrap_source_truth_scope(
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
            self.assertEqual(
                parent["raw_record"]["raw_asset_id"],
                "asset:authenticated-notice:muc_internal_portal:355119",
            )
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
            service, object_store = _build_service(root=root)
            first_docx_bytes = _build_minimal_docx_bytes(
                paragraphs=("报名表第一行", "报名表第二行")
            )
            first_png_bytes = _build_minimal_png_bytes()
            second_docx_bytes = _build_minimal_docx_bytes(
                paragraphs=("第二条报名表第一行", "第二条报名表第二行")
            )
            second_png_bytes = _build_minimal_png_bytes()
            bundle = _sample_projection_notice_bundle(
                docx_bytes=first_docx_bytes,
                png_bytes=first_png_bytes,
            )
            second_notice, second_payloads = _build_second_source_truth_notice(
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
            _bootstrap_source_truth_scope(
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
            service, _ = _build_service(root=root, object_store=object_store)

            summary = service.plan_run(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
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
            service, object_store = _build_service(root=root)
            _bootstrap_source_truth_scope(
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

    def test_rebuild_source_truth_inventory_selected_notice_ids_do_not_shrink_full_scope(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = _build_service(root=root)
            first_docx_bytes = _build_minimal_docx_bytes(
                paragraphs=("报名表第一行", "报名表第二行")
            )
            first_png_bytes = _build_minimal_png_bytes()
            second_docx_bytes = _build_minimal_docx_bytes(
                paragraphs=("第二条报名表第一行", "第二条报名表第二行")
            )
            second_png_bytes = _build_minimal_png_bytes()
            bundle = _sample_projection_notice_bundle(
                docx_bytes=first_docx_bytes,
                png_bytes=first_png_bytes,
            )
            second_notice, second_payloads = _build_second_source_truth_notice(
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
            _bootstrap_source_truth_scope(
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
                tuple(
                    entry.notice_id
                    for entry in inventory_store.list_by_scope("campus_notices", "internal_notice")
                ),
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
                tuple(
                    entry.notice_id
                    for entry in inventory_store.list_by_scope("campus_notices", "internal_notice")
                ),
                ("355119", "355120"),
            )

    def test_repair_source_truth_replay_refreshes_frozen_inventory_counts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = _build_service(
                root=root,
                ocr_client=_FakeAttachmentNoTextOcrClient(),
            )
            _bootstrap_source_truth_scope(
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
            service, object_store = _build_service(
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
            _bootstrap_source_truth_scope(
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
                object_store.get_bytes(bucket="campus-rag-derived", key=inventory_key).decode(
                    "utf-8"
                )
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
            expected_attachment_sha256 = str(bundle[0]["attachments"][0]["sha256"])
            refreshed_payload = json.loads(
                object_store.get_bytes(bucket="campus-rag-derived", key=inventory_key).decode(
                    "utf-8"
                )
            )
            refreshed_parent = refreshed_payload["parents"][0]
            self.assertEqual(
                refreshed_parent["attachment_projection_plans"],
                [
                    {
                        "attachment_ref_id": "attachment-0001",
                        "attachment_content_sha256": expected_attachment_sha256,
                        "classification": "text_extractable",
                        "document_id": "notice_attachment:muc_internal_portal:355119:attachment-0001",
                        "materialization_policy": "required_document",
                    }
                ],
            )
            self.assertEqual(refreshed_parent["attachment_document_count"], 1)
            self.assertEqual(refreshed_parent["ocr_required_count"], 0)

    def test_repair_source_truth_replay_refreshes_frozen_batch_inputs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = _build_service(
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
            _bootstrap_source_truth_scope(
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
            batch_input_key = build_operations_artifact_key(
                corpus="campus_notices",
                operation="authenticated-notice-closeout",
                run_id="source-truth-run-1",
                filename="input.json",
                segments=("batches", "000001"),
            )
            poisoned_batch_input = json.loads(
                object_store.get_bytes(
                    bucket=service.object_store_settings.bucket_derived,
                    key=batch_input_key,
                ).decode("utf-8")
            )
            parent = dict(poisoned_batch_input["source_truth_parents"][0])
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
            poisoned_batch_input["source_truth_parents"] = [parent]
            object_store.put_bytes(
                bucket="campus-rag-derived",
                key=batch_input_key,
                data=json.dumps(
                    poisoned_batch_input,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                ).encode("utf-8"),
                content_type="application/json",
            )

            repaired = service.repair_run("source-truth-run-1")

            self.assertEqual(repaired["expected_ocr_candidate_count"], 0)
            batch_input = json.loads(
                object_store.get_bytes(
                    bucket=service.object_store_settings.bucket_derived,
                    key=batch_input_key,
                ).decode("utf-8")
            )
            refreshed_parent = batch_input["source_truth_parents"][0]
            self.assertEqual(
                refreshed_parent["attachment_projection_plans"],
                [
                    {
                        "attachment_ref_id": "attachment-0001",
                        "attachment_content_sha256": str(bundle[0]["attachments"][0]["sha256"]),
                        "classification": "text_extractable",
                        "document_id": "notice_attachment:muc_internal_portal:355119:attachment-0001",
                        "materialization_policy": "required_document",
                    }
                ],
            )
            self.assertEqual(refreshed_parent["ocr_required_count"], 0)
