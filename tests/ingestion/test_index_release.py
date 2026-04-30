from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime
from unittest.mock import Mock

from campus_ingestion_core.index_release import (
    build_index_release_manifest,
    default_release_id,
    resolve_alias_target,
    validate_scope_release,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk, build_indexable_chunks_from_jsonl
from campus_ingestion_core.scope_catalog import QdrantIndexBinding


def _make_chunk(
    *,
    chunk_id: str,
    text: str,
    section_path: list[str],
    tokens: int,
    unit_type: str = "section_text",
    corpus: str = "curriculum",
    collection: str = "curriculum_plan",
    document_id: str = "curriculum:test",
    page_family: str | None = None,
    extra_metadata: dict[str, object] | None = None,
) -> IndexableChunk:
    metadata = {
        "unit_type": unit_type,
        "final_token_count": tokens,
        "segment_total": 1,
    }
    if page_family is not None:
        metadata["page_family"] = page_family
    if extra_metadata:
        metadata.update(extra_metadata)
    return IndexableChunk(
        document_id=document_id,
        revision_track="source-faithful",
        version_id="sha256:test",
        chunk_id=chunk_id,
        chunk_order=1,
        corpus=corpus,
        collection=collection,
        entitlement_groups=("students",),
        visibility_scope="main",
        visibility_level="restricted",
        source_uri=f"https://campus.example/{document_id}",
        source_chunk_id=None,
        anchor={"section_path": section_path, "page_start": 1, "page_end": 1},
        text=text,
        source_channel="official_web" if corpus == "official_web" else "pdf_ocr",
        is_current=True,
        parser_version="official_web_projection_v1"
        if corpus == "official_web"
        else "raw-online-ocr-v1",
        embedding_model="Qwen3-Embedding-4B",
        metadata=metadata,
    )


class IndexReleaseValidationTest(unittest.TestCase):
    def test_default_release_id_is_unique_within_same_second(self) -> None:
        now = datetime(2026, 4, 30, 12, 0, 0, tzinfo=UTC)

        first = default_release_id(now=now)
        second = default_release_id(now=now)

        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("r20260430_120000"))
        self.assertTrue(second.startswith("r20260430_120000"))

    def test_chunk_embedding_model_uses_actual_runtime_embedding_model(self) -> None:
        record = DocumentRegistryRecord(
            document_id="official_web:muc_public_pages:news-001",
            revision_track="source-faithful",
            version_id="owver:news-001",
            source_uri="https://www.muc.edu.cn/news-001.htm",
            content_hash="sha256:news-001",
            corpus="official_web",
            collection="muc_public_pages",
            cleaning_policy_version="official_web_cleaning_v1",
            status="active",
            ingestion_timestamp="2026-04-02T10:00:00+00:00",
            parser_version="official_web_projection_v1",
            embedding_model="stale-registry-model",
            source_channel="official_web",
            is_current=True,
            document_units_object_key="official_web/news-001/document-units.jsonl",
            processed_object_keys=("official_web/news-001/document-units.jsonl",),
            import_source="official_web_sync",
        )
        row = {
            "doc_id": record.document_id,
            "version_id": record.version_id,
            "chunk_id": "news-001:legacy:0001",
            "clean_text": "中央民族大学官网新闻正文。",
            "anchor": {"section_path": ["Official Web", "News"]},
            "acl": {"level": "public", "allow_groups": []},
            "metadata": {
                "page_family": "article_detail",
                "unit_type": "page_content",
                "serving_intent": "promotable",
                "content_role": "primary_content",
            },
        }

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=(json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8"),
            embedding_model=_NamedEmbeddingModel(model_name="actual-runtime-model"),
        )

        self.assertTrue(chunks)
        self.assertEqual({chunk.embedding_model for chunk in chunks}, {"actual-runtime-model"})

    def test_index_release_manifest_records_runtime_embedding_identity(self) -> None:
        manifest = build_index_release_manifest(
            release_id="r20260430_120000_abcd",
            corpus="curriculum",
            collection="curriculum_plan",
            binding=QdrantIndexBinding(
                alias_name="curriculum_plan",
                collection_prefix="curriculum_plan",
            ),
            physical_collection_name="curriculum_plan__r20260430_120000_abcd",
            previous_physical_collection_name=None,
            records=(
                DocumentRegistryRecord(
                    document_id="curriculum:test",
                    revision_track="source-faithful",
                    version_id="sha256:test",
                    source_uri="https://campus.example/curriculum:test",
                    content_hash="sha256:test",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    status="active",
                    ingestion_timestamp="2026-04-30T00:00:00+00:00",
                    parser_version="test_parser_v1",
                    embedding_model="stale-registry-model",
                    source_channel="pdf_ocr",
                    is_current=True,
                    document_units_object_key="curriculum/test/document-units.jsonl",
                    processed_object_keys=("curriculum/test/document-units.jsonl",),
                    import_source="test",
                ),
            ),
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="课程简介正文。",
                    section_path=["课程简介"],
                    tokens=32,
                    document_id="curriculum:test",
                    extra_metadata={"chunk_policy_version": "curriculum_semantic_v1"},
                ),
            ),
            validation=validate_scope_release(
                corpus="curriculum",
                collection="curriculum_plan",
                chunks=(
                    _make_chunk(
                        chunk_id="chunk-0001",
                        text="课程简介正文。",
                        section_path=["课程简介"],
                        tokens=32,
                        document_id="curriculum:test",
                    ),
                ),
            ),
            indexed_at="2026-04-30T00:00:00+00:00",
            published_at=None,
            validation_summary_object_key=None,
            embedding_provider="mock",
            embedding_dimensions=3,
        )

        self.assertEqual(manifest.embedding_provider, "mock")
        self.assertEqual(manifest.embedding_dimensions, 3)

    def test_resolve_alias_target_does_not_fall_back_to_same_named_collection(self) -> None:
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = True

        self.assertIsNone(
            resolve_alias_target(
                qdrant_client=qdrant_client,
                alias_name="curriculum_plan",
            )
        )

    def test_curriculum_validation_allows_concise_fact_sections(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="五、学制 两年",
                    section_path=["民族学本科第二学士学位人才培养方案", "五、学制 两年"],
                    tokens=6,
                ),
                _make_chunk(
                    chunk_id="chunk-0002",
                    text="八、教学进程计划表\n\n专业代码:060104",
                    section_path=["八、教学进程计划表"],
                    tokens=22,
                ),
            ),
        )

        self.assertEqual(validation.status, "passed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 0)

    def test_curriculum_validation_keeps_suspicious_tiny_chunks_as_failures(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="课程号 | 学分",
                    section_path=["六、课程地图"],
                    tokens=8,
                    unit_type="table_unit",
                ),
            ),
        )

        self.assertEqual(validation.status, "failed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 1)

    def test_curriculum_validation_allows_course_map_title_chunks_as_observations(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="六、课程地图\n\n经济学拔尖人才创新班本科课程结果拓扑图",
                    section_path=["经济学拔尖人才创新班人才培养方案", "六、课程地图"],
                    tokens=12,
                ),
            ),
        )

        self.assertEqual(validation.status, "passed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 0)
        self.assertEqual(validation.summary["course_map_chunks"], 1)

    def test_curriculum_validation_allows_short_course_map_reference_note(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="六、课程地图\n\n参见各专业培养方案的课程地图。",
                    section_path=["理工科交叉创新人才培养实验班本科人才培养方案", "六、课程地图"],
                    tokens=15,
                ),
            ),
        )

        self.assertEqual(validation.status, "passed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 0)

    def test_curriculum_validation_allows_title_with_version_note_opener(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="文物与博物馆学本科第二学士学位人才培养方案\n(2020版)",
                    section_path=["文物与博物馆学本科第二学士学位人才培养方案"],
                    tokens=19,
                ),
            ),
        )

        self.assertEqual(validation.status, "passed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 0)

    def test_curriculum_validation_allows_page_split_subsection_fragment(self) -> None:
        validation = validate_scope_release(
            corpus="curriculum",
            collection="curriculum_plan",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="二、毕业要求\n(二)知识\n究。\n(三)能力",
                    section_path=["法学（民族实验班）本科人才培养方案", "二、毕业要求"],
                    tokens=16,
                ),
            ),
        )

        self.assertEqual(validation.status, "passed")
        self.assertEqual(validation.summary["tiny_chunks_lt24"], 0)

    def test_official_web_validation_fails_when_release_has_too_few_documents(self) -> None:
        validation = validate_scope_release(
            corpus="official_web",
            collection="muc_public_pages",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    section_path=["新闻详情"],
                    tokens=32,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:article:doc-001",
                    page_family="article_detail",
                ),
            ),
        )

        self.assertEqual(validation.status, "failed")
        self.assertEqual(validation.summary["document_count"], 1)
        self.assertEqual(validation.summary["documents_below_minimum"], 1)

    def test_official_web_stable_reference_validation_uses_official_web_gate(self) -> None:
        validation = validate_scope_release(
            corpus="official_web",
            collection="stable_reference",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="中央民族大学本科教育坚持厚基础、宽口径与多学科交叉培养。",
                    section_path=["本科培养"],
                    tokens=30,
                    corpus="official_web",
                    collection="stable_reference",
                    document_id="official_web:muc_public:article:doc-001",
                    page_family="article_detail",
                    extra_metadata={"serving_intent": "promotable"},
                ),
            ),
        )

        self.assertEqual(validation.status, "failed")
        self.assertEqual(validation.summary["document_count"], 1)
        self.assertEqual(validation.summary["documents_below_minimum"], 1)

    def test_official_web_validation_fails_when_disallowed_page_families_are_present(self) -> None:
        validation = validate_scope_release(
            corpus="official_web",
            collection="muc_public_pages",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    section_path=["新闻详情"],
                    tokens=32,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:article:doc-001",
                    page_family="article_detail",
                ),
                _make_chunk(
                    chunk_id="chunk-0002",
                    text="学校召开就业工作推进会\n2026年招生宣传工作启动",
                    section_path=["新闻网"],
                    tokens=28,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:listing:doc-002",
                    page_family="listing_page",
                    unit_type="link_list",
                ),
            ),
        )

        self.assertEqual(validation.status, "failed")
        self.assertEqual(validation.summary["document_count"], 2)
        self.assertEqual(validation.summary["disallowed_page_family_chunks"], 1)
        self.assertEqual(validation.summary["page_family_counts"]["listing_page"], 1)

    def test_official_web_validation_passes_for_article_and_directory_documents(self) -> None:
        validation = validate_scope_release(
            corpus="official_web",
            collection="muc_public_pages",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    section_path=["新闻详情"],
                    tokens=32,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:article:doc-001",
                    page_family="article_detail",
                    extra_metadata={"serving_intent": "promotable"},
                ),
                _make_chunk(
                    chunk_id="chunk-0002",
                    text="中央民族大学法学院举办专题讲座，围绕法治建设展开研讨。",
                    section_path=["学院新闻"],
                    tokens=34,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:article:doc-002",
                    page_family="article_detail",
                    extra_metadata={"serving_intent": "promotable"},
                ),
                _make_chunk(
                    chunk_id="chunk-0003",
                    text="法学院办公室 010-68930000",
                    section_path=["联系方式"],
                    tokens=14,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:directory:doc-003",
                    page_family="directory_page",
                    unit_type="directory_entry",
                    extra_metadata={"serving_intent": "promotable"},
                ),
            ),
        )

        self.assertEqual(validation.status, "passed")
        self.assertEqual(validation.summary["document_count"], 3)
        self.assertEqual(validation.summary["documents_below_minimum"], 0)
        self.assertEqual(validation.summary["disallowed_page_family_chunks"], 0)
        self.assertEqual(validation.summary["page_family_counts"]["article_detail"], 2)
        self.assertEqual(validation.summary["page_family_counts"]["directory_page"], 1)

    def test_official_web_validation_fails_when_audit_only_chunks_are_present(self) -> None:
        validation = validate_scope_release(
            corpus="official_web",
            collection="muc_public_pages",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    section_path=["新闻详情"],
                    tokens=32,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:article:doc-001",
                    page_family="article_detail",
                    extra_metadata={"serving_intent": "promotable"},
                ),
                _make_chunk(
                    chunk_id="chunk-0002",
                    text="中央民族大学法学院举办专题讲座，围绕法治建设展开研讨。",
                    section_path=["学院新闻"],
                    tokens=34,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:article:doc-002",
                    page_family="article_detail",
                    extra_metadata={
                        "serving_intent": "audit_only",
                        "promotion_block_reason": "manual_review_pending",
                    },
                ),
            ),
        )

        self.assertEqual(validation.status, "failed")
        self.assertEqual(validation.summary["audit_only_chunks"], 1)
        self.assertEqual(validation.summary["serving_intent_counts"]["promotable"], 1)
        self.assertEqual(validation.summary["serving_intent_counts"]["audit_only"], 1)

    def test_official_web_validation_fails_when_serving_intent_is_missing(self) -> None:
        validation = validate_scope_release(
            corpus="official_web",
            collection="muc_public_pages",
            chunks=(
                _make_chunk(
                    chunk_id="chunk-0001",
                    text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    section_path=["新闻详情"],
                    tokens=32,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:article:doc-001",
                    page_family="article_detail",
                    extra_metadata={"serving_intent": "promotable"},
                ),
                _make_chunk(
                    chunk_id="chunk-0002",
                    text="中央民族大学法学院举办专题讲座，围绕法治建设展开研讨。",
                    section_path=["学院新闻"],
                    tokens=34,
                    corpus="official_web",
                    collection="muc_public_pages",
                    document_id="official_web:muc_public:article:doc-002",
                    page_family="article_detail",
                ),
            ),
        )

        self.assertEqual(validation.status, "failed")
        self.assertEqual(validation.summary["non_promotable_serving_intent_chunks"], 1)
        self.assertEqual(validation.summary["unknown_serving_intent_chunks"], 1)
        self.assertEqual(validation.summary["serving_intent_counts"]["promotable"], 1)
        self.assertEqual(validation.summary["serving_intent_counts"]["unknown"], 1)


if __name__ == "__main__":
    unittest.main()


class _NamedEmbeddingModel:
    def __init__(self, *, model_name: str) -> None:
        self.model_name = model_name

    def get_text_embedding_batch(self, texts: list[str]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in texts]
