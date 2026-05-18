from __future__ import annotations

import unittest

from .processing_pipeline_test_support import *


class ProcessingPipelineMetadataAndAuthzTest(unittest.TestCase):
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
            chunk_profile=ChunkProfile(
                chunk_size=128, max_chunk_size=192, chunk_overlap=16, min_chunk_size=32
            ),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.document_id, "handbook:test-001")
        self.assertEqual(chunk.revision_track, "source-faithful")
        self.assertEqual(chunk.version_id, "v1:test-001")
        self.assertEqual(chunk.chunk_id, "handbook:test-001:source-faithful:v1:test-001:chunk-0001")
        self.assertEqual(chunk.corpus, "regulations")
        self.assertEqual(chunk.entitlement_groups, ("students", "staff"))
        self.assertIsNone(chunk.visibility_scope)
        self.assertEqual(chunk.visibility_level, "restricted")
        self.assertEqual(chunk.policy_projection_version, "phase1-authorization-projection-v1")
        self.assertEqual(chunk.source_chunk_id, "legacy-chunk-001")
        self.assertEqual(chunk.anchor["page_start"], 12)
        self.assertEqual(chunk.source_channel, "pdf_ocr")
        self.assertFalse(chunk.is_current)
        self.assertEqual(chunk.metadata["unit_type"], "policy_page")
        self.assertEqual(chunk.metadata["root_unit_id"], "legacy-chunk-001")
        self.assertEqual(chunk.metadata["segment_index"], 1)
        self.assertEqual(chunk.metadata["segment_total"], 1)
        self.assertIsNone(chunk.metadata["split_reason"])
        self.assertIsNone(chunk.metadata["boundary_rule"])
        self.assertEqual(chunk.metadata["strategy_name"], "structure_first_default_v1")
        self.assertEqual(chunk.metadata["split_strategy"], "structure_first")
        self.assertEqual(chunk.metadata["chunk_policy_version"], DEFAULT_CHUNK_POLICY_VERSION)
        self.assertEqual(chunk.metadata["cleaning_policy_version"], DEFAULT_CLEANING_POLICY_VERSION)
        self.assertEqual(chunk.metadata["source_document_ids"], ["handbook:test-001"])
        self.assertEqual(
            chunk.metadata["display_text"],
            "Student handbook library hours are from 08:00 to 22:00.",
        )
        self.assertFalse(chunk.metadata["contextualized_text"])
        self.assertIn("library hours", chunk.text.lower())
        node = chunk.to_node()
        self.assertEqual(node.metadata["entitlement_groups"], ["students", "staff"])
        self.assertEqual(node.metadata["visibility_scope"], None)
        self.assertEqual(node.metadata["visibility_level"], "restricted")
        self.assertEqual(
            node.metadata["policy_projection_version"],
            "phase1-authorization-projection-v1",
        )
        self.assertNotIn("acl_groups", node.metadata)
        self.assertNotIn("campus_scope", node.metadata)
        self.assertNotIn("acl_level", node.metadata)

    def test_build_indexable_chunks_from_jsonl_defaults_to_runtime_curriculum_profile(self) -> None:
        record = _make_curriculum_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0001-block-0001",
                        "row_id": "page-0001-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "一、培养目标",
                        "page_start": 1,
                        "page_end": 1,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0001-block-0002",
                        "row_id": "page-0001-block-0002",
                        "row_type": "paragraph",
                        "clean_text": "培养具有国际视野和跨学科协同能力的复合型人才。",
                        "page_start": 1,
                        "page_end": 1,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(
            chunks[0].metadata["chunk_policy_version"], CURRICULUM_V2_CHUNK_POLICY_VERSION
        )
        self.assertEqual(
            chunks[0].metadata["cleaning_policy_version"], CURRICULUM_CLEANING_POLICY_VERSION
        )
        self.assertEqual(chunks[0].metadata["strategy_name"], "curriculum_plan_structure_v2")
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")

    def test_build_indexable_chunks_from_jsonl_prefers_canonical_document_authorization_projection(
        self,
    ) -> None:
        record = DocumentRegistryRecord(
            document_id="handbook:test-authz",
            revision_track="source-faithful",
            version_id="v1:test-authz",
            source_uri="https://campus.example/handbook/test-authz",
            content_hash="sha256:test-authz",
            corpus="regulations",
            collection="student_rules",
            entitlement_groups=("students",),
            visibility_scope="main",
            status="active",
            ingestion_timestamp="2026-04-02T10:00:00+00:00",
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="pdf_ocr",
            document_units_object_key=build_processed_artifact_key(
                corpus="regulations",
                collection="student_rules",
                document_id="handbook:test-authz",
                revision_track="source-faithful",
                version_id="v1:test-authz",
                title=None,
                year=None,
                filename="document-units.jsonl",
            ),
            processed_object_keys=(
                build_processed_artifact_key(
                    corpus="regulations",
                    collection="student_rules",
                    document_id="handbook:test-authz",
                    revision_track="source-faithful",
                    version_id="v1:test-authz",
                    title=None,
                    year=None,
                    filename="document-units.jsonl",
                ),
            ),
            import_source="raw_online_ocr",
        )
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "legacy-chunk-001",
                        "row_id": "legacy-chunk-001",
                        "row_type": "policy_page",
                        "clean_text": "Campus notice for enrolled students only.",
                        "page_start": 1,
                        "page_end": 1,
                        "source_pdf": "authz.pdf",
                        "source_url": record.source_uri,
                        "acl": {"level": "public", "allow_groups": []},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128, max_chunk_size=192, chunk_overlap=16, min_chunk_size=32
            ),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.entitlement_groups, ("students",))
        self.assertEqual(chunk.visibility_scope, "main")
        self.assertEqual(chunk.visibility_level, "restricted")

    def test_build_indexable_chunks_from_jsonl_reads_canonical_row_authorization_projection(
        self,
    ) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "canonical-row-001",
                        "row_id": "canonical-row-001",
                        "row_type": "policy_page",
                        "clean_text": "Campus notice for enrolled students only.",
                        "page_start": 1,
                        "page_end": 1,
                        "source_pdf": "authz.pdf",
                        "source_url": record.source_uri,
                        "entitlement_groups": ["students"],
                        "visibility_scope": "main",
                        "visibility_level": "restricted",
                        "policy_projection_version": "phase1-authorization-projection-v1",
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128, max_chunk_size=192, chunk_overlap=16, min_chunk_size=32
            ),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.entitlement_groups, ("students", "staff"))
        self.assertIsNone(chunk.visibility_scope)
        self.assertEqual(chunk.visibility_level, "restricted")

    def test_build_indexable_chunks_from_jsonl_does_not_read_non_canonical_row_visibility_metadata(
        self,
    ) -> None:
        record = _make_public_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "legacy-acl-row-001",
                        "row_id": "legacy-acl-row-001",
                        "row_type": "policy_page",
                        "clean_text": "This row should remain public without canonical authz projection.",
                        "page_start": 1,
                        "page_end": 1,
                        "acl": {"level": "restricted", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128, max_chunk_size=192, chunk_overlap=16, min_chunk_size=32
            ),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].entitlement_groups, ())
        self.assertEqual(chunks[0].visibility_level, "public")

    def test_indexable_chunk_defaults_visibility_level_from_entitlements(self) -> None:
        chunk = IndexableChunk(
            document_id="handbook:test-authz",
            revision_track="source-faithful",
            version_id="v1:test-authz",
            chunk_id="handbook:test-authz:source-faithful:v1:test-authz:chunk-0001",
            chunk_order=1,
            corpus="regulations",
            collection="student_rules",
            source_uri="https://campus.example/handbook/test-authz",
            source_chunk_id="legacy-chunk-001",
            anchor={"page_start": 1, "page_end": 1},
            text="Campus notice for enrolled students only.",
            source_channel="pdf_ocr",
            is_current=True,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            entitlement_groups=("students",),
            visibility_scope="main",
            visibility_level="",
        )

        self.assertEqual(chunk.entitlement_groups, ("students",))
        self.assertEqual(chunk.visibility_scope, "main")
        self.assertEqual(chunk.visibility_level, "restricted")

    def test_chunk_lineage_payload_rejects_missing_source_document_ids(self) -> None:
        chunk = IndexableChunk(
            document_id="handbook:test-authz",
            revision_track="source-faithful",
            version_id="v1:test-authz",
            chunk_id="handbook:test-authz:source-faithful:v1:test-authz:chunk-0001",
            chunk_order=1,
            corpus="regulations",
            collection="student_rules",
            source_uri="https://campus.example/handbook/test-authz",
            source_chunk_id="legacy-chunk-001",
            anchor={"page_start": 1, "page_end": 1},
            text="Campus notice for enrolled students only.",
            source_channel="pdf_ocr",
            is_current=True,
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            entitlement_groups=("students",),
            visibility_scope="main",
            visibility_level="restricted",
        )

        with self.assertRaisesRegex(ValueError, "source_document_ids"):
            _chunk_lineage_payload_defaults(chunk=chunk, metadata={})

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
                chunk_profile=ChunkProfile(
                    chunk_size=128, max_chunk_size=192, chunk_overlap=16, min_chunk_size=32
                ),
            )

    def test_build_indexable_chunks_from_jsonl_rejects_missing_clean_text(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "raw_text": "Raw text must not substitute clean_text.",
                        "anchor": {"page_start": 1, "page_end": 1},
                    }
                )
            ]
        ).encode("utf-8")

        with self.assertRaisesRegex(ValueError, "structured unit must contain clean_text"):
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_payload,
                chunk_profile=ChunkProfile(
                    chunk_size=128, max_chunk_size=192, chunk_overlap=16, min_chunk_size=32
                ),
                embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            )

    def test_build_indexable_chunks_from_jsonl_rejects_synthetic_document_summary_row(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "document-0000",
                        "clean_text": "Synthetic whole-document summary text.",
                    }
                )
            ]
        ).encode("utf-8")

        with self.assertRaisesRegex(ValueError, "document-0000"):
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_payload,
            )

    def test_build_indexable_chunks_from_jsonl_uses_batch_dense_embeddings_when_available(
        self,
    ) -> None:
        class _BatchOnlyEmbeddingModel:
            def __init__(self) -> None:
                self.batch_calls: list[tuple[str, ...]] = []

            def get_text_embedding(self, text: str) -> list[float]:
                raise AssertionError(
                    "single-item embedding should not be used when batch embeddings are available"
                )

            def get_text_embedding_batch(self, texts: list[str]) -> list[list[float]]:
                self.batch_calls.append(tuple(texts))
                return [
                    [float(index), float(index) + 0.5] for index, _ in enumerate(texts, start=1)
                ]

        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": "handbook:test-001",
                        "version_id": "v1:test-001",
                        "chunk_id": "article-001",
                        "unit_type": "article_body",
                        "root_unit_id": "article-001",
                        "clean_text": " ".join(f"token-{index:04d}" for index in range(520)),
                        "anchor": {
                            "section_path": ["学生管理", "奖惩办法"],
                            "article_label": "第十二条",
                            "page_start": 9,
                            "page_end": 9,
                        },
                        "acl": {"level": "public", "allow_groups": []},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")
        embedding_model = _BatchOnlyEmbeddingModel()

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            embedding_model=embedding_model,
        )

        self.assertGreater(len(chunks), 1)
        self.assertEqual(len(embedding_model.batch_calls), 1)
        self.assertEqual(embedding_model.batch_calls[0], tuple(chunk.text for chunk in chunks))
        self.assertEqual(
            tuple(chunk.embedding for chunk in chunks),
            tuple((float(index), float(index) + 0.5) for index in range(1, len(chunks) + 1)),
        )
