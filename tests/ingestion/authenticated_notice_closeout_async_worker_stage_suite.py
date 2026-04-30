from __future__ import annotations

import unittest

from .authenticated_notice_closeout_async_test_support import *


class AuthenticatedNoticeCloseoutAsyncWorkerStageTest(unittest.TestCase):
    def test_repair_source_truth_replay_reopens_completed_batches_with_stale_attachment_outcomes(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = _build_service(
                root=root,
                ocr_client=_FakeAttachmentOcrClient(),
            )
            _bootstrap_source_truth_scope(
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
            service, object_store = _build_service(
                root=root,
                ocr_client=_FakeAttachmentOcrClient(),
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

            promotion = service.promote_run(
                "source-truth-run-1",
                media_gate_audit=_passed_media_gate_audit(),
            )
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

    def test_source_truth_replay_workers_record_no_text_ocr_outcome_without_child_document(
        self,
    ) -> None:
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
            self.assertEqual(
                verified["verification"]["materialized_ocr_attachment_document_count"], 0
            )
            self.assertEqual(verified["verification"]["no_extractable_text_attachment_count"], 1)
            self.assertEqual(verified["verification"]["missing_attachment_outcome_count"], 0)
            self.assertTrue(verified["verification"]["ok"])

            staged_notice = service.closeout_store.get_staged_notices("source-truth-run-1")[0]
            staged_raw_asset = service.closeout_store.get_staged_raw_assets("source-truth-run-1")[0]
            self.assertEqual(
                staged_raw_asset["source_artifact_keys"],
                {
                    "source-truth/notice-manifest.json": next(
                        key
                        for key in staged_notice["artifact_keys"]
                        if str(key).endswith("/source-truth/notice-manifest.json")
                    ),
                    "source-truth/content-blocks.jsonl": next(
                        key
                        for key in staged_notice["artifact_keys"]
                        if str(key).endswith("/source-truth/content-blocks.jsonl")
                    ),
                    "source-truth/attachment-refs.jsonl": next(
                        key
                        for key in staged_notice["artifact_keys"]
                        if str(key).endswith("/source-truth/attachment-refs.jsonl")
                    ),
                },
            )
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

            promotion = service.promote_run(
                "source-truth-run-1",
                media_gate_audit=_passed_media_gate_audit(),
            )
            self.assertEqual(promotion["state"], "done")
            self.assertEqual(promotion["replaced_scope_record_count"], 2)
            records = service.document_registry.list_by_scope("campus_notices", "internal_notice")
            self.assertEqual(len(records), 2)

    def test_source_truth_replay_no_text_provider_response_keys_are_unique_per_notice(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = _build_service(
                root=root,
                ocr_client=_FakeAttachmentNoTextOcrClient(),
            )
            service.planner = CloseoutPlanner(shard_size=2, batch_size=2, max_shards=4)
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

    def test_source_truth_replay_workers_keep_spatial_inline_images_in_multimodal_processing(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = _build_service(
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
            self.assertEqual(
                verified["verification"]["multimodal_processing_required_attachment_count"], 1
            )
            self.assertEqual(verified["verification"]["missing_attachment_outcome_count"], 0)
            self.assertTrue(verified["verification"]["ok"])

            staged_notice = service.closeout_store.get_staged_notices("source-truth-run-1")[0]
            self.assertEqual(len(staged_notice["attachment_outcomes"]), 2)
            multimodal_outcome = staged_notice["attachment_outcomes"][1]
            self.assertEqual(multimodal_outcome["classification"], "multimodal_processing_required")
            self.assertEqual(multimodal_outcome["materialization_policy"], "multimodal_processing")
            self.assertEqual(multimodal_outcome["outcome"], "multimodal_processing_required")
            self.assertEqual(multimodal_outcome["review_reason"], "spatial_visual_asset")

            promotion = service.promote_run(
                "source-truth-run-1",
                media_gate_audit=_passed_media_gate_audit(),
            )
            self.assertEqual(promotion["state"], "done")
            self.assertEqual(promotion["replaced_scope_record_count"], 2)

    def test_source_truth_replay_verification_reads_frozen_inventory_not_batch_inputs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service, object_store = _build_service(
                root=root,
                ocr_client=_FakeAttachmentOcrClient(),
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
            del object_store.objects[
                (service.object_store_settings.bucket_derived, batch_input_key)
            ]

            verification = service.run_verifier.verify_run("source-truth-run-1")

            self.assertTrue(verification["ok"])
