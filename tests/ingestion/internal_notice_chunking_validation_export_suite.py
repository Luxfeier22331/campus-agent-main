from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core import (
    export_internal_notice_chunk_samples,
    scan_internal_notice_chunking,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry

from .internal_notice_chunking_validation_test_support import (
    _attachment_rows,
    _FakeObjectStore,
    _make_inventory_entry,
    _make_notice_record,
    _parent_notice_rows,
    chunking_test_env,
)


class InternalNoticeChunkingValidationExportTest(unittest.TestCase):
    def test_export_internal_notice_chunk_samples_writes_lane_specific_evidence(self) -> None:
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

    def test_export_internal_notice_chunk_samples_writes_notice_risk_metadata_and_high_risk_bucket(
        self,
    ) -> None:
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
                (
                    "campus-rag-derived",
                    parent_record.document_units_object_key,
                ): _parent_notice_rows(
                    record=parent_record,
                    title="关于现场办理导览的通知",
                    body_lines=("请先阅读通知正文，再结合附件导览总图到对应窗口办理。",),
                ),
            }
        )
        scan_result = scan_internal_notice_chunking(
            env=chunking_test_env(),
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
