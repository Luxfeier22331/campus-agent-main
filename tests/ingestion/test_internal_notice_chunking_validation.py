from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.models import DocumentRegistryRecord
from tests.support.in_memory_registry import InMemoryDocumentRegistry


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[(bucket, key)] = data


class _ManifestOnlyRegistry(InMemoryDocumentRegistry):
    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        raise AssertionError("manifest-based validation must not scan the full registry scope")


class _FakeCloseoutStore:
    def __init__(self, *, run, staged_documents: tuple[dict[str, object], ...]) -> None:
        self.run = run
        self.staged_documents = staged_documents

    def get_run(self, run_id: str):
        if self.run is None or self.run.run_id != run_id:
            return None
        return self.run

    def get_staged_documents(self, run_id: str) -> tuple[dict[str, object], ...]:
        if self.run is None or self.run.run_id != run_id:
            return ()
        return self.staged_documents


def _make_notice_record(*, document_id: str, source_uri: str, object_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=f"sha256:{document_id.split(':')[-1]}-version",
        source_uri=source_uri,
        content_hash=f"sha256:{document_id.split(':')[-1]}-content",
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        ingestion_timestamp="2026-04-06T00:00:00+00:00",
        parser_version="authenticated_notice_import_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        document_units_object_key=object_key,
        processed_object_keys=(object_key,),
        import_source="authenticated_notice_source_projection",
    )


def _jsonl_bytes(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _make_closeout_run(*, run_id: str, state: str = "verified"):
    from campus_ingestion_core.authenticated_notice_closeout import CloseoutRun
    from campus_ingestion_core.authenticated_notice_closeout_models import CloseoutRunState

    run = CloseoutRun(
        run_id=run_id,
        bundle_path="/tmp/not-used.json",
        manifest_path=None,
        expected_notice_count=1,
        expected_document_count=1,
        operations_prefix=f"campus_notices/operations/authenticated-notice-closeout/{run_id}",
        corpus="campus_notices",
        collection="internal_notice",
    )
    if state == "verified":
        return run.mark_planned().mark_running().mark_verifying().mark_verified(
            {"staged_document_count": 1}
        )
    return replace(run, state=CloseoutRunState(state))


def _build_staged_document(
    *,
    record: DocumentRegistryRecord,
    staged_document_units_key: str,
) -> dict[str, object]:
    return {
        "document": {
            "document_id": record.document_id,
            "revision_track": record.revision_track,
            "version_id": record.version_id,
            "source_label": record.source_uri,
            "metadata": {
                "document_id": record.document_id,
                "version_id": record.version_id,
                "source_url": record.source_uri,
                "entitlement_groups": list(record.entitlement_groups),
                "visibility_scope": record.visibility_scope,
                "visibility_level": record.visibility_level,
                "policy_projection_version": record.policy_projection_version,
            },
            "import_source": record.import_source,
            "source_channel": record.source_channel,
            "is_current": record.is_current,
            "corpus": record.corpus,
            "collection": record.collection,
            "visibility_scope": record.visibility_scope,
            "status": record.status,
            "raw_source_uri": record.source_uri,
            "raw_asset_id": None,
            "raw_version_id": None,
            "provider_response_object_key": record.provider_response_object_key,
            "layout_elements_object_key": record.layout_elements_object_key,
            "additional_processed_object_keys": [],
            "processed_object_keys": list(record.processed_object_keys),
            "title": record.document_id,
            "year": None,
            "parser_version": record.parser_version,
            "embedding_model": record.embedding_model,
            "cleaning_policy_version": record.cleaning_policy_version,
        },
        "staged_object_keys": {"document_units": staged_document_units_key},
        "final_object_keys": {"document_units": str(record.document_units_object_key)},
        "content_hash": record.content_hash,
        "staged_object_metadata": {
            "document_units": {"sha256": record.content_hash, "content_length": 128}
        },
    }


def _make_inventory_entry(
    *,
    record: DocumentRegistryRecord,
    notice_risk_label: str,
    attachment_mix_score: int,
    attachment_ref_count: int,
    has_text_table_attachment: bool = False,
    has_spatial_attachment: bool = False,
    has_reference_only_attachment: bool = False,
) -> dict[str, object]:
    notice_id = record.document_id.split(":")[2]
    return {
        "corpus": record.corpus,
        "collection": record.collection,
        "notice_id": notice_id,
        "site_id": "muc_internal_portal",
        "document_id": f"notice:muc_internal_portal:{notice_id}",
        "revision_track": "source-faithful",
        "version_id": f"sha256:{notice_id}-inventory",
        "raw_asset_id": f"raw-{notice_id}",
        "raw_version_id": "v1",
        "source_home_url": "https://portal.example.edu",
        "embedding_model": record.embedding_model,
        "notice_manifest_key": f"source-truth/{notice_id}/notice-manifest.json",
        "content_blocks_key": f"source-truth/{notice_id}/content-blocks.jsonl",
        "attachment_refs_key": f"source-truth/{notice_id}/attachment-refs.jsonl",
        "attachment_document_count": 0,
        "attachment_ref_count": attachment_ref_count,
        "text_extractable_count": 1 if has_text_table_attachment else 0,
        "ocr_required_count": 0,
        "reference_only_count": 1 if has_reference_only_attachment else 0,
        "manual_review_required_count": 1 if has_spatial_attachment else 0,
        "notice_risk_label": notice_risk_label,
        "attachment_mix_score": attachment_mix_score,
        "has_text_table_attachment": has_text_table_attachment,
        "has_spatial_attachment": has_spatial_attachment,
        "has_reference_only_attachment": has_reference_only_attachment,
        "planning_weight": 1,
        "parent_snapshot": {
            "notice_id": notice_id,
            "document_id": f"notice:muc_internal_portal:{notice_id}",
            "notice_risk_label": notice_risk_label,
            "attachment_mix_score": attachment_mix_score,
            "attachment_ref_count": attachment_ref_count,
            "has_text_table_attachment": has_text_table_attachment,
            "has_spatial_attachment": has_spatial_attachment,
            "has_reference_only_attachment": has_reference_only_attachment,
        },
    }


def _make_frozen_inventory_payload(
    *,
    run_id: str,
    notice_id: str,
    notice_risk_label: str,
    attachment_mix_score: int,
    attachment_ref_count: int,
    has_text_table_attachment: bool = False,
    has_spatial_attachment: bool = False,
    has_reference_only_attachment: bool = False,
) -> bytes:
    return json.dumps(
        {
            "run_id": run_id,
            "input_kind": "source_truth_replay",
            "selected_notice_ids": [notice_id],
            "notice_risk_counts": {notice_risk_label: 1},
            "high_risk_notice_count": 1 if has_spatial_attachment else 0,
            "site_id": "muc_internal_portal",
            "source_home_url": "https://portal.example.edu",
            "embedding_model": "Qwen3-Embedding-4B",
            "expected_notice_count": 1,
            "expected_document_count": 1,
            "expected_attachment_document_count": 0,
            "expected_ocr_candidate_count": 0,
            "expected_raw_asset_count": 1,
            "parents": [
                {
                    "notice_id": notice_id,
                    "document_id": f"notice:muc_internal_portal:{notice_id}",
                    "notice_risk_label": notice_risk_label,
                    "attachment_mix_score": attachment_mix_score,
                    "attachment_ref_count": attachment_ref_count,
                    "has_text_table_attachment": has_text_table_attachment,
                    "has_spatial_attachment": has_spatial_attachment,
                    "has_reference_only_attachment": has_reference_only_attachment,
                }
            ],
        },
        ensure_ascii=False,
    ).encode("utf-8")


def _parent_notice_rows(
    *,
    record: DocumentRegistryRecord,
    title: str,
    body_lines: tuple[str, ...],
    with_title_unit: bool = True,
    title_in_body_metadata: bool = True,
) -> bytes:
    rows: list[dict[str, object]] = []
    if with_title_unit:
        rows.append(
            {
                "doc_id": record.document_id,
                "version_id": record.version_id,
                "chunk_id": "title-001",
                "root_unit_id": "title-001",
                "unit_type": "policy_page",
                "text": title,
                "raw_text": title,
                "clean_text": title,
                "anchor": {"source_uri": record.source_uri, "section_path": ["通知正文"]},
                "metadata": {"block_role": "title", **({"title": title} if title_in_body_metadata else {})},
            }
        )
    for index, line in enumerate(body_lines, start=1):
        rows.append(
            {
                "doc_id": record.document_id,
                "version_id": record.version_id,
                "chunk_id": f"body-{index:03d}",
                "root_unit_id": f"body-{index:03d}",
                "unit_type": "article_body",
                "text": line,
                "raw_text": line,
                "clean_text": line,
                "anchor": {"source_uri": record.source_uri, "section_path": ["通知正文"]},
                "metadata": {"block_role": "paragraph", **({"title": title} if title_in_body_metadata else {})},
            }
        )
    return _jsonl_bytes(rows)


def _attachment_rows(
    *,
    record: DocumentRegistryRecord,
    title: str,
    filename: str,
    extraction_class: str,
    body_blocks: tuple[str, ...],
) -> bytes:
    shared_metadata = {
        "projection_name": "internal_notice_attachment_documents",
        "parent_document_id": "notice:muc_internal_portal:355119",
        "attachment_ref_id": "attachment-0001",
        "attachment_kind": "office_document_attachment",
        "attachment_role": "notice_attachment_document",
        "attachment_filename": filename,
        "attachment_mime_type": (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            if extraction_class == "text_extractable"
            else "image/png"
        ),
        "extraction_class": extraction_class,
    }
    rows = [
        {
            "doc_id": record.document_id,
            "version_id": record.version_id,
            "chunk_id": "attachment-title",
            "root_unit_id": "attachment-title",
            "unit_type": "attachment_title",
            "text": title,
            "raw_text": title,
            "clean_text": title,
            "anchor": {"source_uri": record.source_uri, "attachment_ref_id": "attachment-0001"},
            "metadata": dict(shared_metadata),
        }
    ]
    for index, block in enumerate(body_blocks, start=1):
        rows.append(
            {
                "doc_id": record.document_id,
                "version_id": record.version_id,
                "chunk_id": f"attachment-body-{index:04d}",
                "root_unit_id": f"attachment-body-{index:04d}",
                "unit_type": "attachment_body",
                "text": block,
                "raw_text": block,
                "clean_text": block,
                "anchor": {"source_uri": record.source_uri, "attachment_ref_id": "attachment-0001"},
                "metadata": dict(shared_metadata),
            }
        )
    return _jsonl_bytes(rows)


class InternalNoticeChunkingValidationTest(unittest.TestCase):
    def _env(self) -> dict[str, str]:
        return {
            "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
            "OBJECT_STORE_ACCESS_KEY": "minioadmin",
            "OBJECT_STORE_SECRET_KEY": "minioadmin",
            "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
        }

    def test_scan_internal_notice_chunking_classifies_parent_and_attachment_lanes(self) -> None:
        from campus_ingestion_core import scan_internal_notice_chunking

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
        registry = InMemoryDocumentRegistry((parent_record, text_attachment_record, ocr_attachment_record))
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent_record.document_units_object_key): _parent_notice_rows(
                    record=parent_record,
                    title="关于开展专项申请的通知",
                    body_lines=("请于本周内完成登记并提交材料。",),
                ),
                ("campus-rag-derived", text_attachment_record.document_units_object_key): _attachment_rows(
                    record=text_attachment_record,
                    title="专项申请表.docx",
                    filename="专项申请表.docx",
                    extraction_class="text_extractable",
                    body_blocks=("申请人姓名：张三\n学院：信息工程学院",),
                ),
                ("campus-rag-derived", ocr_attachment_record.document_units_object_key): _attachment_rows(
                    record=ocr_attachment_record,
                    title="现场流程图.png",
                    filename="现场流程图.png",
                    extraction_class="ocr_required",
                    body_blocks=("提交纸质材料后至学院办公室核验。",),
                ),
            }
        )

        scan_result = scan_internal_notice_chunking(
            env=self._env(),
            registry=registry,
            object_store=object_store,
        )

        self.assertEqual(len(scan_result.documents), 3)
        lane_map = {document.record.document_id: document.lane for document in scan_result.documents}
        self.assertEqual(lane_map[parent_record.document_id], "notice_body")
        self.assertEqual(lane_map[text_attachment_record.document_id], "attachment_text_extractable")
        self.assertEqual(lane_map[ocr_attachment_record.document_id], "attachment_ocr_required")

    def test_validate_internal_notice_chunking_fails_when_parent_chunks_miss_title_propagation(self) -> None:
        from campus_ingestion_core import validate_internal_notice_chunking

        record = _make_notice_record(
            document_id="notice:muc_internal_portal:355119",
            source_uri="https://portal.example.edu/notice/355119",
            object_key="campus_notices/documents/internal_notice/notice-355119/source-faithful/2026/document-units.jsonl",
        )
        registry = InMemoryDocumentRegistry((record,))
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", record.document_units_object_key): _parent_notice_rows(
                    record=record,
                    title="关于开展专项申请的通知",
                    body_lines=("请于本周内完成登记并提交材料。",),
                    with_title_unit=False,
                    title_in_body_metadata=False,
                )
            }
        )

        report = validate_internal_notice_chunking(
            env=self._env(),
            registry=registry,
            object_store=object_store,
        )

        self.assertFalse(report.passed)
        self.assertGreater(report.missing_title_chunk_count, 0)

    def test_validate_internal_notice_chunking_flags_ocr_noise_and_header_dominance(self) -> None:
        from campus_ingestion_core import validate_internal_notice_chunking

        record = _make_notice_record(
            document_id="notice_attachment:muc_internal_portal:355119:attachment-0002",
            source_uri="https://portal.example.edu/notice/355119/attachments/2",
            object_key=(
                "campus_notices/documents/internal_notice/"
                "notice-355119-attachment-0002/source-faithful/2026/document-units.jsonl"
            ),
        )
        registry = InMemoryDocumentRegistry((record,))
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", record.document_units_object_key): _attachment_rows(
                    record=record,
                    title="报名流程图.png",
                    filename="报名流程图.png",
                    extraction_class="ocr_required",
                    body_blocks=("----\n??\n..\n--\n",),
                )
            }
        )

        report = validate_internal_notice_chunking(
            env=self._env(),
            registry=registry,
            object_store=object_store,
        )

        self.assertFalse(report.passed)
        self.assertGreater(report.header_dominant_ocr_chunk_count, 0)
        self.assertGreater(report.noisy_ocr_chunk_count, 0)

    def test_validate_internal_notice_chunking_reports_notice_risk_counts_from_inventory(self) -> None:
        from campus_ingestion_core import validate_internal_notice_chunking
        from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
            AuthenticatedNoticeSourceTruthInventoryEntry,
            InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
        )

        record = _make_notice_record(
            document_id="notice:muc_internal_portal:355119",
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
                ("campus-rag-derived", record.document_units_object_key): _parent_notice_rows(
                    record=record,
                    title="关于现场审核安排的通知",
                    body_lines=("请按照附件位置图前往现场办理。",),
                )
            }
        )

        report = validate_internal_notice_chunking(
            env=self._env(),
            registry=registry,
            object_store=object_store,
            source_truth_inventory_store=inventory_store,
        )

        self.assertEqual(
            report.notice_risk_counts,
            {"body_with_spatial_attachments": 1},
        )
        self.assertEqual(report.high_risk_notice_count, 1)

    def test_scan_internal_notice_chunking_can_freeze_selection_from_preparation_manifest(self) -> None:
        from campus_ingestion_core import scan_internal_notice_chunking

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
                ("campus-rag-derived", parent_record.document_units_object_key): _parent_notice_rows(
                    record=parent_record,
                    title="关于开展专项申请的通知",
                    body_lines=("请于本周内完成登记并提交材料。",),
                ),
                ("campus-rag-derived", attachment_record.document_units_object_key): _attachment_rows(
                    record=attachment_record,
                    title="专项申请表.docx",
                    filename="专项申请表.docx",
                    extraction_class="text_extractable",
                    body_blocks=("申请人姓名：张三\n学院：信息工程学院",),
                ),
            }
        )

        scan_result = scan_internal_notice_chunking(
            env=self._env(),
            registry=registry,
            object_store=object_store,
            preparation_run_id=preparation_run_id,
        )

        self.assertEqual(len(scan_result.documents), 1)
        self.assertEqual(scan_result.documents[0].record.document_id, attachment_record.document_id)
        self.assertEqual(scan_result.inputs.selection_mode, "preparation_manifest")
        self.assertEqual(scan_result.inputs.records, (attachment_record,))

    def test_scan_internal_notice_chunking_can_freeze_selection_from_verified_closeout_run(self) -> None:
        from campus_ingestion_core import scan_internal_notice_chunking

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
            env=self._env(),
            registry=registry,
            object_store=object_store,
            closeout_run_id="run-verified",
            closeout_store=closeout_store,
        )

        self.assertEqual(len(scan_result.documents), 1)
        self.assertEqual(scan_result.documents[0].record.document_id, attachment_record.document_id)
        self.assertEqual(scan_result.inputs.selection_mode, "verified_closeout_run")
        self.assertEqual(scan_result.inputs.closeout_run_id, "run-verified")
        self.assertEqual(
            scan_result.documents[0].record.document_units_object_key,
            staged_key,
        )
        self.assertIsNone(scan_result.documents[0].read_failure)

    def test_scan_internal_notice_chunking_uses_closeout_backed_preparation_manifest_before_promote(self) -> None:
        from campus_ingestion_core import scan_internal_notice_chunking

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
            env=self._env(),
            registry=_ManifestOnlyRegistry((attachment_record,)),
            object_store=object_store,
            preparation_run_id=preparation_run_id,
            closeout_store=closeout_store,
        )

        self.assertEqual(scan_result.inputs.selection_mode, "preparation_manifest")
        self.assertEqual(scan_result.inputs.closeout_run_id, "run-verified")
        self.assertEqual(len(scan_result.documents), 1)
        self.assertEqual(
            scan_result.documents[0].record.document_units_object_key,
            staged_key,
        )

    def test_scan_internal_notice_chunking_rejects_unverified_closeout_run(self) -> None:
        from campus_ingestion_core import scan_internal_notice_chunking

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
                env=self._env(),
                registry=_ManifestOnlyRegistry((attachment_record,)),
                object_store=_FakeObjectStore(),
                closeout_run_id="run-running",
                closeout_store=closeout_store,
            )

    def test_export_internal_notice_chunk_samples_writes_lane_specific_evidence(self) -> None:
        from campus_ingestion_core import export_internal_notice_chunk_samples, scan_internal_notice_chunking

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
        registry = InMemoryDocumentRegistry((parent_record, attachment_record))
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent_record.document_units_object_key): _parent_notice_rows(
                    record=parent_record,
                    title="关于开展专项申请的通知",
                    body_lines=("请于本周内完成登记并提交材料。",),
                ),
                ("campus-rag-derived", attachment_record.document_units_object_key): _attachment_rows(
                    record=attachment_record,
                    title="专项申请表.docx",
                    filename="专项申请表.docx",
                    extraction_class="text_extractable",
                    body_blocks=("申请人姓名：张三\n学院：信息工程学院",),
                ),
            }
        )
        scan_result = scan_internal_notice_chunking(
            env=self._env(),
            registry=registry,
            object_store=object_store,
        )

        with TemporaryDirectory() as temp_dir:
            output_dir = export_internal_notice_chunk_samples(
                output_dir=Path(temp_dir),
                scan_result=scan_result,
                sample_seed=20260406,
            )
            manifest = json.loads((output_dir / "samples.json").read_text(encoding="utf-8"))
            sample_files = [Path(path) for path in manifest["sample_files"]]

            self.assertTrue(sample_files)
            first_sample = (output_dir / sample_files[0]).read_text(encoding="utf-8")
            self.assertIn("Lane:", first_sample)
            self.assertIn("Chunk Text", first_sample)

    def test_export_internal_notice_chunk_samples_writes_notice_risk_metadata_and_high_risk_bucket(self) -> None:
        from campus_ingestion_core import export_internal_notice_chunk_samples, scan_internal_notice_chunking
        from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
            AuthenticatedNoticeSourceTruthInventoryEntry,
            InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
        )

        parent_record = _make_notice_record(
            document_id="notice:muc_internal_portal:355120",
            source_uri="https://portal.example.edu/notice/355120",
            object_key="campus_notices/documents/internal_notice/notice-355120/source-faithful/2026/document-units.jsonl",
        )
        registry = InMemoryDocumentRegistry((parent_record,))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                AuthenticatedNoticeSourceTruthInventoryEntry.from_dict(
                    _make_inventory_entry(
                        record=parent_record,
                        notice_risk_label="mixed_high_risk",
                        attachment_mix_score=3,
                        attachment_ref_count=2,
                        has_text_table_attachment=True,
                        has_spatial_attachment=True,
                    )
                ),
            )
        )
        object_store = _FakeObjectStore(
            objects={
                ("campus-rag-derived", parent_record.document_units_object_key): _parent_notice_rows(
                    record=parent_record,
                    title="关于现场办理导览的通知",
                    body_lines=("请先阅读通知正文，再结合附件导览总图到对应窗口办理。",),
                ),
            }
        )
        scan_result = scan_internal_notice_chunking(
            env=self._env(),
            registry=registry,
            object_store=object_store,
            source_truth_inventory_store=inventory_store,
        )

        with TemporaryDirectory() as temp_dir:
            output_dir = export_internal_notice_chunk_samples(
                output_dir=Path(temp_dir),
                scan_result=scan_result,
                sample_seed=20260406,
            )
            manifest = json.loads((output_dir / "samples.json").read_text(encoding="utf-8"))

            self.assertIn("notice-risk-mixed-high-risk", " ".join(manifest["sample_files"]))

            joined_samples = "\n".join(
                (output_dir / Path(path)).read_text(encoding="utf-8")
                for path in manifest["sample_files"]
            )
            self.assertIn("Notice Risk Label: mixed_high_risk", joined_samples)
            self.assertIn("Attachment Mix Score: 3", joined_samples)

    def test_validate_internal_notice_chunking_uses_closeout_frozen_inventory_for_notice_risk_metadata(self) -> None:
        from campus_ingestion_core import validate_internal_notice_chunking
        from campus_ingestion_core.authenticated_notice_closeout_models import CloseoutRun

        attachment_record = _make_notice_record(
            document_id="notice_attachment:muc_internal_portal:355121:attachment-0001",
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
        run = CloseoutRun(
            run_id="run-verified",
            bundle_path="/tmp/not-used.json",
            manifest_path=None,
            expected_notice_count=1,
            expected_document_count=1,
            operations_prefix="campus_notices/operations/authenticated-notice-closeout/run-verified",
            source_truth_inventory_object_key=inventory_key,
        ).mark_planned().mark_running().mark_verifying().mark_verified({"staged_document_count": 1})
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
                ("campus-rag-derived", staged_key): _attachment_rows(
                    record=attachment_record,
                    title="办理位置图.png",
                    filename="办理位置图.png",
                    extraction_class="ocr_required",
                    body_blocks=("请按图示前往一号楼大厅。",),
                ),
                ("campus-rag-derived", inventory_key): _make_frozen_inventory_payload(
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
            env=self._env(),
            registry=_ManifestOnlyRegistry((attachment_record,)),
            object_store=object_store,
            closeout_run_id="run-verified",
            closeout_store=closeout_store,
        )

        self.assertEqual(
            report.notice_risk_counts,
            {"body_with_spatial_attachments": 1},
        )
        self.assertEqual(report.high_risk_notice_count, 1)


if __name__ == "__main__":
    unittest.main()
