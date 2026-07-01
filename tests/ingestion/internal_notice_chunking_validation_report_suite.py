from __future__ import annotations

import unittest

from campus_ingestion_core import validate_internal_notice_chunking

from tests.support.in_memory_registry import InMemoryDocumentRegistry

from .internal_notice_chunking_validation_test_support import (
    _attachment_rows,
    _build_staged_document,
    _FakeCloseoutStore,
    _FakeObjectStore,
    _make_frozen_inventory_payload,
    _make_inventory_entry,
    _make_notice_record,
    _ManifestOnlyRegistry,
    _parent_notice_rows,
    chunking_test_env,
)


class InternalNoticeChunkingValidationReportTest(unittest.TestCase):
    def test_validate_internal_notice_chunking_fails_when_parent_chunks_miss_title_propagation(
        self,
    ) -> None:
        record = _make_notice_record(
            document_id="notice:example_internal_portal:355119",
            source_uri="https://portal.example.edu/notice/355119",
            object_key="campus_notices/documents/internal_notice/notice-355119/source-faithful/2026/document-units.jsonl",
        )
        registry = InMemoryDocumentRegistry((record,))
        object_store = _FakeObjectStore(
            objects={
                ("campus-agent-derived", record.document_units_object_key): _parent_notice_rows(
                    record=record,
                    title="关于开展专项申请的通知",
                    body_lines=("请于本周内完成登记并提交材料。",),
                    with_title_unit=False,
                    title_in_body_metadata=False,
                )
            }
        )

        report = validate_internal_notice_chunking(
            env=chunking_test_env(),
            registry=registry,
            object_store=object_store,
        )

        self.assertFalse(report.passed)
        self.assertGreater(report.missing_title_chunk_count, 0)

    def test_validate_internal_notice_chunking_flags_ocr_noise_and_header_dominance(self) -> None:
        record = _make_notice_record(
            document_id="notice_attachment:example_internal_portal:355119:attachment-0002",
            source_uri="https://portal.example.edu/notice/355119/attachments/2",
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0002/source-faithful/2026/document-units.jsonl"
            ),
        )
        registry = InMemoryDocumentRegistry((record,))
        object_store = _FakeObjectStore(
            objects={
                ("campus-agent-derived", record.document_units_object_key): _attachment_rows(
                    record=record,
                    title="报名流程图.png",
                    filename="报名流程图.png",
                    extraction_class="ocr_required",
                    body_blocks=("----\n??\n..\n--\n",),
                )
            }
        )

        report = validate_internal_notice_chunking(
            env=chunking_test_env(),
            registry=registry,
            object_store=object_store,
        )

        self.assertFalse(report.passed)
        self.assertGreater(report.header_dominant_ocr_chunk_count, 0)
        self.assertGreater(report.noisy_ocr_chunk_count, 0)

    def test_validate_internal_notice_chunking_reports_notice_risk_counts_from_inventory(
        self,
    ) -> None:
        from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
            AuthenticatedNoticeSourceTruthInventoryEntry,
            InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
        )

        record = _make_notice_record(
            document_id="notice:example_internal_portal:355119",
            source_uri="https://portal.example.edu/notice/355119",
            object_key="campus_notices/documents/internal_notice/notice-355119/source-faithful/2026/document-units.jsonl",
        )
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(
                    _make_inventory_entry(
                        record=record,
                        notice_risk_label="body_with_spatial_attachments",
                        attachment_mix_score=2,
                        attachment_ref_count=1,
                        has_spatial_attachment=True,
                    )
                ),
            )
        )
        registry = InMemoryDocumentRegistry((record,))
        object_store = _FakeObjectStore(
            objects={
                ("campus-agent-derived", record.document_units_object_key): _parent_notice_rows(
                    record=record,
                    title="关于现场审核安排的通知",
                    body_lines=("请按照附件位置图前往现场办理。",),
                )
            }
        )

        report = validate_internal_notice_chunking(
            env=chunking_test_env(),
            registry=registry,
            object_store=object_store,
            source_truth_inventory_store=inventory_store,
        )

        self.assertEqual(report.notice_risk_counts, {"body_with_spatial_attachments": 1})
        self.assertEqual(report.high_risk_notice_count, 1)

    def test_validate_internal_notice_chunking_uses_closeout_frozen_inventory_for_notice_risk_metadata(
        self,
    ) -> None:
        from campus_ingestion_core.authenticated_notice_closeout_models import CloseoutRun

        attachment_record = _make_notice_record(
            document_id="notice_attachment:example_internal_portal:355121:attachment-0001",
            source_uri="https://portal.example.edu/notice/355121/attachments/1",
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355121-attachment-0001/source-faithful/2026/document-units.jsonl"
            ),
        )
        staged_key = (
            "campus_notices/operations/authenticated-notice-closeout/"
            "run-verified/staging/batches/batch-0001/documents/doc-001/document-units.jsonl"
        )
        inventory_key = (
            "campus_notices/operations/authenticated-notice-closeout/"
            "run-verified/inputs/ingestion_projection.json"
        )
        run = (
            CloseoutRun(
                run_id="run-verified",
                bundle_path="/tmp/not-used.json",
                manifest_path=None,
                expected_notice_count=1,
                expected_document_count=1,
                operations_prefix="campus_notices/operations/authenticated-notice-closeout/run-verified",
                source_truth_inventory_object_key=inventory_key,
            )
            .mark_planned()
            .mark_running()
            .mark_verifying()
            .mark_verified({"staged_document_count": 1})
        )
        closeout_store = _FakeCloseoutStore(
            run=run,
            staged_documents=(
                _build_staged_document(
                    record=attachment_record,
                    staged_document_units_key=staged_key,
                ),
            ),
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-agent-derived", staged_key): _attachment_rows(
                    record=attachment_record,
                    title="办理位置图.png",
                    filename="办理位置图.png",
                    extraction_class="ocr_required",
                    body_blocks=("请按图示前往一号楼大厅。",),
                ),
                ("campus-agent-derived", inventory_key): _make_frozen_inventory_payload(
                    run_id="run-verified",
                    notice_id="355121",
                    notice_risk_label="body_with_spatial_attachments",
                    attachment_mix_score=2,
                    attachment_ref_count=1,
                    has_spatial_attachment=True,
                ),
            }
        )

        report = validate_internal_notice_chunking(
            env=chunking_test_env(),
            registry=_ManifestOnlyRegistry((attachment_record,)),
            object_store=object_store,
            closeout_run_id="run-verified",
            closeout_store=closeout_store,
        )

        self.assertEqual(report.notice_risk_counts, {"body_with_spatial_attachments": 1})
        self.assertEqual(report.high_risk_notice_count, 1)
