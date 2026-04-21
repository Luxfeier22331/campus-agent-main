from __future__ import annotations

import json
import unittest

from campus_ingestion_core import scan_internal_notice_chunking

from tests.support.in_memory_registry import InMemoryDocumentRegistry

from .internal_notice_chunking_validation_test_support import (
    _attachment_rows,
    _build_staged_document,
    _FakeCloseoutStore,
    _FakeObjectStore,
    _make_closeout_run,
    _make_notice_record,
    _ManifestOnlyRegistry,
    _parent_notice_rows,
    chunking_test_env,
)


class InternalNoticeChunkingValidationScanTest(unittest.TestCase):
    def test_scan_internal_notice_chunking_classifies_parent_and_attachment_lanes(self) -> None:
        parent_record = _make_notice_record(
            document_id="notice:muc_internal_portal:355119",
            source_uri="https://portal.example.edu/notice/355119",
            object_key="campus_notices/documents/internal_notice/notice-355119/source-faithful/2026/document-units.jsonl",
        )
        text_attachment_record = _make_notice_record(
            document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
            source_uri="https://portal.example.edu/notice/355119/attachments/1",
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0001/source-faithful/2026/document-units.jsonl"
            ),
        )
        ocr_attachment_record = _make_notice_record(
            document_id="notice_attachment:muc_internal_portal:355119:attachment-0002",
            source_uri="https://portal.example.edu/notice/355119/attachments/2",
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0002/source-faithful/2026/document-units.jsonl"
            ),
        )
        registry = InMemoryDocumentRegistry(
            (parent_record, text_attachment_record, ocr_attachment_record)
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-rag-derived",
                    parent_record.document_units_object_key,
                ): _parent_notice_rows(
                    record=parent_record,
                    title="关于开展专项申请的通知",
                    body_lines=("请于本周内完成登记并提交材料。",),
                ),
                (
                    "campus-rag-derived",
                    text_attachment_record.document_units_object_key,
                ): _attachment_rows(
                    record=text_attachment_record,
                    title="专项申请表.docx",
                    filename="专项申请表.docx",
                    extraction_class="text_extractable",
                    body_blocks=("申请人姓名：张三\n学院：信息工程学院",),
                ),
                (
                    "campus-rag-derived",
                    ocr_attachment_record.document_units_object_key,
                ): _attachment_rows(
                    record=ocr_attachment_record,
                    title="现场流程图.png",
                    filename="现场流程图.png",
                    extraction_class="ocr_required",
                    body_blocks=("提交纸质材料后至学院办公室核验。",),
                ),
            }
        )

        scan_result = scan_internal_notice_chunking(
            env=chunking_test_env(),
            registry=registry,
            object_store=object_store,
        )

        self.assertEqual(len(scan_result.documents), 3)
        lane_map = {
            document.record.document_id: document.lane for document in scan_result.documents
        }
        self.assertEqual(lane_map[parent_record.document_id], "notice_body")
        self.assertEqual(
            lane_map[text_attachment_record.document_id], "attachment_text_extractable"
        )
        self.assertEqual(lane_map[ocr_attachment_record.document_id], "attachment_ocr_required")

    def test_scan_internal_notice_chunking_can_freeze_selection_from_preparation_manifest(
        self,
    ) -> None:
        parent_record = _make_notice_record(
            document_id="notice:muc_internal_portal:355119",
            source_uri="https://portal.example.edu/notice/355119",
            object_key="campus_notices/documents/internal_notice/notice-355119/source-faithful/2026/document-units.jsonl",
        )
        attachment_record = _make_notice_record(
            document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
            source_uri="https://portal.example.edu/notice/355119/attachments/1",
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0001/source-faithful/2026/document-units.jsonl"
            ),
        )
        registry = _ManifestOnlyRegistry((parent_record, attachment_record))
        preparation_run_id = "prep-20260406-0001"
        manifest_key = (
            "campus_notices/operations/registry-scope-chunk-preparation/"
            f"{preparation_run_id}/internal_notice/chunk-preparation.json"
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", manifest_key): (
                    json.dumps(
                        {
                            "preparation_run_id": preparation_run_id,
                            "corpus": "campus_notices",
                            "collection": "internal_notice",
                            "cleaning_policy_version": "authenticated_notice_projection_v1",
                            "chunk_policy_version": "internal_notice_semantic_v1",
                            "prepared_at": "2026-04-06T00:00:00+00:00",
                            "document_count": 1,
                            "chunk_count": 1,
                            "document_version_ids_hash": "hash-a",
                            "document_units_keys_hash": "hash-b",
                            "validation_status": "passed",
                            "validation_summary_object_key": None,
                            "document_report_object_key": None,
                            "documents": [
                                {
                                    "document_id": attachment_record.document_id,
                                    "revision_track": attachment_record.revision_track,
                                    "version_id": attachment_record.version_id,
                                    "document_units_object_key": attachment_record.document_units_object_key,
                                }
                            ],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                (
                    "campus-rag-derived",
                    parent_record.document_units_object_key,
                ): _parent_notice_rows(
                    record=parent_record,
                    title="关于开展专项申请的通知",
                    body_lines=("请于本周内完成登记并提交材料。",),
                ),
                (
                    "campus-rag-derived",
                    attachment_record.document_units_object_key,
                ): _attachment_rows(
                    record=attachment_record,
                    title="专项申请表.docx",
                    filename="专项申请表.docx",
                    extraction_class="text_extractable",
                    body_blocks=("申请人姓名：张三\n学院：信息工程学院",),
                ),
            }
        )

        scan_result = scan_internal_notice_chunking(
            env=chunking_test_env(),
            registry=registry,
            object_store=object_store,
            preparation_run_id=preparation_run_id,
        )

        self.assertEqual(len(scan_result.documents), 1)
        self.assertEqual(scan_result.documents[0].record.document_id, attachment_record.document_id)
        self.assertEqual(scan_result.inputs.selection_mode, "preparation_manifest")
        self.assertEqual(scan_result.inputs.records, (attachment_record,))

    def test_scan_internal_notice_chunking_can_freeze_selection_from_verified_closeout_run(
        self,
    ) -> None:
        attachment_record = _make_notice_record(
            document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
            source_uri="https://portal.example.edu/notice/355119/attachments/1",
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0001/source-faithful/2026/document-units.jsonl"
            ),
        )
        staged_key = (
            "campus_notices/operations/authenticated-notice-closeout/"
            "run-verified/staging/batches/batch-0001/documents/doc-001/document-units.jsonl"
        )
        registry = _ManifestOnlyRegistry((attachment_record,))
        closeout_store = _FakeCloseoutStore(
            run=_make_closeout_run(run_id="run-verified"),
            staged_documents=(
                _build_staged_document(
                    record=attachment_record,
                    staged_document_units_key=staged_key,
                ),
            ),
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", staged_key): _attachment_rows(
                    record=attachment_record,
                    title="专项申请表.docx",
                    filename="专项申请表.docx",
                    extraction_class="text_extractable",
                    body_blocks=("申请人姓名：张三\n学院：信息工程学院",),
                ),
            }
        )

        scan_result = scan_internal_notice_chunking(
            env=chunking_test_env(),
            registry=registry,
            object_store=object_store,
            closeout_run_id="run-verified",
            closeout_store=closeout_store,
        )

        self.assertEqual(len(scan_result.documents), 1)
        self.assertEqual(scan_result.documents[0].record.document_id, attachment_record.document_id)
        self.assertEqual(scan_result.inputs.selection_mode, "verified_closeout_run")
        self.assertEqual(scan_result.inputs.closeout_run_id, "run-verified")
        self.assertEqual(scan_result.documents[0].record.document_units_object_key, staged_key)
        self.assertIsNone(scan_result.documents[0].read_failure)

    def test_scan_internal_notice_chunking_uses_closeout_backed_preparation_manifest_before_promote(
        self,
    ) -> None:
        attachment_record = _make_notice_record(
            document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
            source_uri="https://portal.example.edu/notice/355119/attachments/1",
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0001/source-faithful/2026/document-units.jsonl"
            ),
        )
        preparation_run_id = "prep-20260409-closeout-001"
        manifest_key = (
            "campus_notices/operations/registry-scope-chunk-preparation/"
            f"{preparation_run_id}/internal_notice/chunk-preparation.json"
        )
        staged_key = (
            "campus_notices/operations/authenticated-notice-closeout/"
            "run-verified/staging/batches/batch-0001/documents/doc-001/document-units.jsonl"
        )
        closeout_store = _FakeCloseoutStore(
            run=_make_closeout_run(run_id="run-verified"),
            staged_documents=(
                _build_staged_document(
                    record=attachment_record,
                    staged_document_units_key=staged_key,
                ),
            ),
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", manifest_key): (
                    json.dumps(
                        {
                            "preparation_run_id": preparation_run_id,
                            "corpus": "campus_notices",
                            "collection": "internal_notice",
                            "selection_mode": "verified_closeout_run",
                            "closeout_run_id": "run-verified",
                            "cleaning_policy_version": "authenticated_notice_projection_v1",
                            "chunk_policy_version": "internal_notice_semantic_v1",
                            "prepared_at": "2026-04-09T00:00:00+00:00",
                            "document_count": 1,
                            "chunk_count": 1,
                            "document_version_ids_hash": "hash-a",
                            "document_units_keys_hash": "hash-b",
                            "validation_status": "passed",
                            "validation_summary_object_key": None,
                            "document_report_object_key": None,
                            "documents": [
                                {
                                    "document_id": attachment_record.document_id,
                                    "revision_track": attachment_record.revision_track,
                                    "version_id": attachment_record.version_id,
                                    "document_units_object_key": attachment_record.document_units_object_key,
                                }
                            ],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                ("campus-rag-derived", staged_key): _attachment_rows(
                    record=attachment_record,
                    title="专项申请表.docx",
                    filename="专项申请表.docx",
                    extraction_class="text_extractable",
                    body_blocks=("申请人姓名：张三\n学院：信息工程学院",),
                ),
            }
        )

        scan_result = scan_internal_notice_chunking(
            env=chunking_test_env(),
            registry=_ManifestOnlyRegistry((attachment_record,)),
            object_store=object_store,
            preparation_run_id=preparation_run_id,
            closeout_store=closeout_store,
        )

        self.assertEqual(scan_result.inputs.selection_mode, "preparation_manifest")
        self.assertEqual(scan_result.inputs.closeout_run_id, "run-verified")
        self.assertEqual(len(scan_result.documents), 1)
        self.assertEqual(scan_result.documents[0].record.document_units_object_key, staged_key)

    def test_scan_internal_notice_chunking_rejects_unverified_closeout_run(self) -> None:
        attachment_record = _make_notice_record(
            document_id="notice_attachment:muc_internal_portal:355119:attachment-0001",
            source_uri="https://portal.example.edu/notice/355119/attachments/1",
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0001/source-faithful/2026/document-units.jsonl"
            ),
        )
        closeout_store = _FakeCloseoutStore(
            run=_make_closeout_run(run_id="run-running", state="running"),
            staged_documents=(
                _build_staged_document(
                    record=attachment_record,
                    staged_document_units_key="ops/document-units.jsonl",
                ),
            ),
        )

        with self.assertRaisesRegex(ValueError, "verified"):
            scan_internal_notice_chunking(
                env=chunking_test_env(),
                registry=_ManifestOnlyRegistry((attachment_record,)),
                object_store=_FakeObjectStore(),
                closeout_run_id="run-running",
                closeout_store=closeout_store,
            )
