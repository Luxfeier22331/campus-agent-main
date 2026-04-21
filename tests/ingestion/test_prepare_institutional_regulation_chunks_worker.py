from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry
from campus_ingestion_core.models import DocumentRegistryRecord

worker = importlib.import_module("campus_ingestion_worker.prepare_institutional_regulation_chunks")


def _record(*, document_id: str, version_id: str, units_key: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=version_id,
        source_uri=f"campusrag://promotion/internal_notice/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="institutional_regulations",
        cleaning_policy_version="institutional_regulations_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-19T09:00:00+00:00",
        parser_version="internal_notice_regulation_materialization_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=units_key.replace("document-units.jsonl", "canonical.md"),
        processed_object_keys=(units_key,),
        import_source="internal_notice_regulation_materialization",
        published_date="2026-03-27",
    )


def _rows(*, document_id: str, version_id: str) -> bytes:
    rows = [
        {
            "doc_id": document_id,
            "version_id": version_id,
            "chunk_id": f"{document_id}:row-0001",
            "row_id": f"{document_id}:row-0001",
            "row_type": "heading",
            "clean_text": "中央民族大学关于学生使用人工智能的指导意见 / 2026版",
            "source_pdf": "source.pdf",
            "source_url": f"https://portal.example.edu/{document_id}",
            "source": {"id": f"https://portal.example.edu/{document_id}"},
            "page_start": 1,
            "page_end": 2,
            "entitlement_groups": ["campus_members"],
            "visibility_scope": "campus",
            "visibility_level": "restricted",
            "policy_projection_version": "phase1-authorization-projection-v1",
            "unit_type": "regulation_title",
            "root_unit_id": f"{document_id}:root",
            "metadata": {
                "title": "中央民族大学关于学生使用人工智能的指导意见 / 2026版",
                "content_kind": "institutional_regulation",
                "content_role": "regulation_title",
                "promotion_class": "formal_regulation",
                "promotion_source_collection": "campus_notices/internal_notice",
                "source_notice_ids": ["355282"],
                "source_notice_document_id": "notice:muc_internal_portal:355282",
                "semantic_owner_document_id": "notice_attachment:muc_internal_portal:355282:attachment-0001",
                "semantic_owner_kind": "attachment_document",
                "source_attachment_document_id": "notice_attachment:muc_internal_portal:355282:attachment-0001",
                "regulation_title_normalized": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                "regulation_work_title": "中央民族大学关于学生使用人工智能的指导意见",
                "regulation_display_title": "中央民族大学关于学生使用人工智能的指导意见 / 2026版",
                "source_title_literal": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                "section_path": ["中央民族大学关于学生使用人工智能的指导意见 / 2026版"],
            },
        },
        {
            "doc_id": document_id,
            "version_id": version_id,
            "chunk_id": f"{document_id}:row-0002",
            "row_id": f"{document_id}:row-0002",
            "row_type": "paragraph",
            "clean_text": "第一条 为规范学生使用人工智能，制定本指导意见。第二条 本指导意见适用于全体在校学生。",
            "source_pdf": "source.pdf",
            "source_url": f"https://portal.example.edu/{document_id}",
            "source": {"id": f"https://portal.example.edu/{document_id}"},
            "page_start": 1,
            "page_end": 2,
            "entitlement_groups": ["campus_members"],
            "visibility_scope": "campus",
            "visibility_level": "restricted",
            "policy_projection_version": "phase1-authorization-projection-v1",
            "unit_type": "regulation_body",
            "root_unit_id": f"{document_id}:root",
            "metadata": {
                "title": "中央民族大学关于学生使用人工智能的指导意见 / 2026版",
                "content_kind": "institutional_regulation",
                "content_role": "regulation_body",
                "promotion_class": "formal_regulation",
                "promotion_source_collection": "campus_notices/internal_notice",
                "source_notice_ids": ["355282"],
                "source_notice_document_id": "notice:muc_internal_portal:355282",
                "semantic_owner_document_id": "notice_attachment:muc_internal_portal:355282:attachment-0001",
                "semantic_owner_kind": "attachment_document",
                "source_attachment_document_id": "notice_attachment:muc_internal_portal:355282:attachment-0001",
                "regulation_title_normalized": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                "regulation_work_title": "中央民族大学关于学生使用人工智能的指导意见",
                "regulation_display_title": "中央民族大学关于学生使用人工智能的指导意见 / 2026版",
                "source_title_literal": "中央民族大学关于学生使用人工智能的指导意见（2026版）",
                "section_path": ["中央民族大学关于学生使用人工智能的指导意见 / 2026版"],
            },
        },
    ]
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


class PrepareInstitutionalRegulationChunksWorkerCliTest(unittest.TestCase):
    def test_main_prepares_local_only_chunk_artifacts_from_snapshot_registry(self) -> None:
        record = _record(
            document_id="institutional_regulation:muc:ai-guidance:089bcf7907da",
            version_id="sha256:guidance:2026",
            units_key="regulations/documents/institutional_regulations/ai-guidance/document-units.jsonl",
        )

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry_path = root / "documents.json"
            InMemoryDocumentRegistry((record,), backing_path=registry_path)
            object_root = root / "object-store"
            derived_units_path = (
                object_root / "campus-rag-derived" / record.document_units_object_key
            )
            derived_units_path.parent.mkdir(parents=True, exist_ok=True)
            derived_units_path.write_bytes(
                _rows(document_id=record.document_id, version_id=record.version_id)
            )
            output_dir = root / "prepared"

            with (
                patch(
                    "campus_ingestion_worker.prepare_institutional_regulation_chunks.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--documents-json",
                        str(registry_path),
                        "--object-store-root",
                        str(object_root),
                        "--output-dir",
                        str(output_dir),
                        "--document-id",
                        record.document_id,
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertTrue(payload["passed"])
            self.assertEqual(payload["prepared_document_count"], 1)
            self.assertTrue(Path(payload["manifest_path"]).exists())
            self.assertTrue(Path(payload["validation_summary_path"]).exists())
            self.assertTrue(Path(payload["document_reports_path"]).exists())


if __name__ == "__main__":
    unittest.main()
