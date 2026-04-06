from __future__ import annotations

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
        registry = InMemoryDocumentRegistry((parent_record, attachment_record))
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


if __name__ == "__main__":
    unittest.main()
