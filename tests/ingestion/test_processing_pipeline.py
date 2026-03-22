from __future__ import annotations

import json
import unittest

from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl


def _make_registry_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-001",
        version_id="v1:test-001",
        source_uri="https://campus.example/handbook/test-001",
        content_hash="sha256:test-001",
        corpus="student_handbook",
        acl_groups=("students", "staff"),
        campus_scope=None,
        status="active",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="campusrag-import-v1",
        embedding_model="text-embedding-3-large",
        structured_object_key="student_handbook/handbook:test-001/v1:test-001/processed/structured.jsonl",
        processed_object_keys=(
            "student_handbook/handbook:test-001/v1:test-001/processed/structured.jsonl",
        ),
        import_source="campusrag_existing_ocr",
    )


class ProcessingPipelineTest(unittest.TestCase):
    def test_build_indexable_chunks_from_jsonl_keeps_required_metadata(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "legacy-chunk-001",
                        "clean_text": "Student handbook library hours are from 08:00 to 22:00.",
                        "anchor": {
                            "section_path": ["Student Handbook", "Library", "Hours"],
                            "page_start": 12,
                            "page_end": 12,
                        },
                        "acl": {
                            "level": "public",
                            "allow_groups": [],
                        },
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.document_id, "handbook:test-001")
        self.assertEqual(chunk.version_id, "v1:test-001")
        self.assertEqual(chunk.chunk_id, "handbook:test-001:v1:test-001:chunk-0001")
        self.assertEqual(chunk.corpus, "student_handbook")
        self.assertEqual(chunk.acl_groups, ("students", "staff"))
        self.assertIsNone(chunk.campus_scope)
        self.assertEqual(chunk.source_chunk_id, "legacy-chunk-001")
        self.assertEqual(chunk.anchor["page_start"], 12)
        self.assertIn("library hours", chunk.text.lower())

    def test_build_indexable_chunks_from_jsonl_rejects_doc_version_mismatch(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:other-doc",
                        "version_id": "v1:test-001",
                        "clean_text": "Mismatched document id.",
                    }
                )
            ]
        ).encode("utf-8")

        with self.assertRaises(ValueError):
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_payload,
                chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            )

    def test_build_indexable_chunks_from_jsonl_falls_back_to_raw_text(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "raw_text": "Raw text fallback remains indexable.",
                        "anchor": {"page_start": 1, "page_end": 1},
                    }
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].text, "Raw text fallback remains indexable.")


if __name__ == "__main__":
    unittest.main()
