from __future__ import annotations

from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    Mock,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    qdrant_models,
    unittest,
)


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    return {
        INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
            "evidence_contract_version": "answer_ready_evidence.v3",
            "parent_unit_id": "handbook:student-card:article-6",
            "answer_role": "procedure_step",
            "condition_group_id": "handbook:student-card:article-6:application_procedure",
            "condition_group_subject": "application_procedure",
            "condition_subject_taxonomy_version": "condition_subject.v1",
            "condition_subject_provenance": "test-fixture:explicit",
            "procedure_step_index": 1,
            "procedure_actor": "student",
            "procedure_action": "apply",
            "procedure_action_taxonomy_version": "procedure_action.v1",
            "procedure_action_provenance": "test-fixture:explicit",
            "condition_polarity": "positive",
            **metadata,
        },
        "section_path": ["中央民族大学本科(预科)学生证管理办法"],
    }


class BackendQdrantDocumentScrollFallbackTest(unittest.TestCase):
    def test_backend_does_not_scroll_target_document_after_no_hit_fail_closed(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(
            points=[
                qdrant_models.ScoredPoint(
                    id="point-campus-network-title",
                    version=0,
                    score=1.0,
                    payload={
                        "document_id": "official_web_regulation:b23aa5f14642eb92",
                        "revision_track": "current-effective",
                        "version_id": "owregver:network",
                        "chunk_id": "official_web_regulation:b23aa5f14642eb92:chunk-0001",
                        "corpus": "regulations",
                        "collection": "institutional_rules",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/institutional/network",
                        "canonical_url": "https://campus.example/institutional/network",
                        "latest_url": "https://campus.example/institutional/network",
                        "source_channel": "official_web",
                        "is_current": True,
                        "title": "中央民族大学校园网接入管理办法",
                        "unit_type": "regulation_title",
                        "content_role": "regulation_title",
                        "is_answer_bearing": False,
                        "anchor": {"section_path": ["中央民族大学校园网接入管理办法"]},
                        "display_text": "中央民族大学校园网接入管理办法",
                    },
                ),
            ]
        )
        backend = _backend(qdrant_client=qdrant_client)

        result = backend.retrieve(
            RetrievalRequest(
                query_text="中央民族大学星际通勤飞船管理办法",
                corpus="regulations",
                collection="institutional_rules",
                target_document_ids=(
                    "official_web_regulation:b23aa5f14642eb92",
                    "official_web_regulation:5defea25436a134e",
                ),
                top_k=3,
            )
        )

        self.assertEqual(result.sources, ())
        qdrant_client.scroll.assert_not_called()

    def test_backend_does_not_supplement_target_regulation_document_with_incomplete_v3_source(
        self,
    ) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(points=[])
        qdrant_client.scroll.return_value = (
            [
                qdrant_models.Record(
                    id="point-student-card-policy-page",
                    payload={
                        "document_id": "handbook:student-card",
                        "revision_track": "source-faithful",
                        "version_id": "v1:student-card",
                        "chunk_id": "handbook:student-card:chunk-0001",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/handbook/student-card",
                        "canonical_url": "https://campus.example/handbook/student-card",
                        "latest_url": "https://campus.example/handbook/student-card",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "title": "中央民族大学本科(预科)学生证管理办法",
                        "unit_type": "policy_page",
                        "content_role": "procedure",
                        "is_answer_bearing": True,
                        "anchor": {"section_path": ["中央民族大学本科(预科)学生证管理办法"]},
                        "display_text": ("学生证遗失后，应及时挂失，并提交书面申请办理补办手续。"),
                    },
                )
            ],
            None,
        )
        backend = _backend(qdrant_client=qdrant_client)

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办？",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=("handbook:student-card",),
                top_k=3,
            )
        )

        self.assertEqual(result.sources, ())
        qdrant_client.scroll.assert_called_once()

    def test_backend_supplements_target_regulation_document_with_complete_v3_source(
        self,
    ) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(points=[])
        qdrant_client.scroll.return_value = (
            [
                qdrant_models.Record(
                    id="point-student-card-policy-page",
                    payload={
                        "document_id": "handbook:student-card",
                        "revision_track": "source-faithful",
                        "version_id": "v1:student-card",
                        "chunk_id": "handbook:student-card:chunk-0001",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/handbook/student-card",
                        "canonical_url": "https://campus.example/handbook/student-card",
                        "latest_url": "https://campus.example/handbook/student-card",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "title": "中央民族大学本科(预科)学生证管理办法",
                        "unit_type": "policy_page",
                        "content_role": "procedure",
                        "is_answer_bearing": True,
                        "anchor": _answer_ready_anchor(
                            condition_subject="application_procedure",
                            semantic_role="procedure_step",
                            polarity="positive",
                            action_type="student_card_reissue",
                            claim_type="procedure",
                        ),
                        "display_text": ("学生证遗失后，应及时挂失，并提交书面申请办理补办手续。"),
                    },
                )
            ],
            None,
        )
        backend = _backend(qdrant_client=qdrant_client)

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办？",
                corpus="regulations",
                collection="student_rules",
                target_document_ids=("handbook:student-card",),
                top_k=3,
            )
        )

        self.assertEqual(qdrant_client.query_points.call_count, 1)
        qdrant_client.scroll.assert_called_once()
        self.assertEqual(
            tuple(source.chunk_id for source in result.sources),
            ("handbook:student-card:chunk-0001",),
        )
        scroll_filter = qdrant_client.scroll.call_args.kwargs["scroll_filter"]
        document_conditions = [
            condition
            for condition in scroll_filter.must or ()
            if getattr(condition, "key", None) == "document_id"
        ]
        self.assertEqual(len(document_conditions), 1)
        self.assertEqual(
            getattr(getattr(document_conditions[0], "match", None), "value", None),
            "handbook:student-card",
        )

    def test_backend_supplements_exact_curriculum_title_lookup_with_same_document_overview(
        self,
    ) -> None:
        title = "民族学本科人才培养方案"
        doc_id = f"curriculum:{title}"
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(
            points=[
                qdrant_models.ScoredPoint(
                    id="point-ethnology-table",
                    version=0,
                    score=0.91,
                    payload={
                        "document_id": doc_id,
                        "revision_track": "source-faithful",
                        "version_id": "v1:ethnology",
                        "chunk_id": f"{doc_id}:chunk-0012",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/ethnology",
                        "canonical_url": "https://campus.example/curriculum/ethnology",
                        "latest_url": "https://campus.example/curriculum/ethnology",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [title, "五、课程设置和修读建议"],
                            "table_group_id": "page-12-table-1",
                        },
                        "text": (
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "课程号 | 课程名称 | 学分 | 学时 | 修读学期\n"
                            "0304-1-05-04 | 民族学前沿研究 | 2 | 36 | 4"
                        ),
                    },
                ),
            ]
        )
        qdrant_client.scroll.return_value = (
            [
                qdrant_models.Record(
                    id="point-ethnology-overview",
                    payload={
                        "document_id": doc_id,
                        "revision_track": "source-faithful",
                        "version_id": "v1:ethnology",
                        "chunk_id": f"{doc_id}:chunk-0001",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/ethnology",
                        "canonical_url": "https://campus.example/curriculum/ethnology",
                        "latest_url": "https://campus.example/curriculum/ethnology",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "title": title,
                        "unit_type": "section_text",
                        "content_role": "lead_overview",
                        "is_answer_bearing": True,
                        "anchor": {"section_path": [title, "一、培养目标"]},
                        "text": (
                            "民族学本科人才培养方案 一、培养目标 "
                            "本专业培养具有民族学理论基础和田野调查能力的人才。"
                        ),
                    },
                ),
                qdrant_models.Record(
                    id="point-ethnology-table",
                    payload={
                        "document_id": doc_id,
                        "revision_track": "source-faithful",
                        "version_id": "v1:ethnology",
                        "chunk_id": f"{doc_id}:chunk-0012",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/ethnology",
                        "canonical_url": "https://campus.example/curriculum/ethnology",
                        "latest_url": "https://campus.example/curriculum/ethnology",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [title, "五、课程设置和修读建议"],
                            "table_group_id": "page-12-table-1",
                        },
                        "text": (
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "课程号 | 课程名称 | 学分 | 学时 | 修读学期\n"
                            "0304-1-05-04 | 民族学前沿研究 | 2 | 36 | 4"
                        ),
                    },
                ),
            ],
            None,
        )
        backend = _backend(qdrant_client=qdrant_client)

        result = backend.retrieve(
            RetrievalRequest(
                query_text=title,
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=3,
            )
        )

        self.assertEqual(qdrant_client.query_points.call_count, 1)
        qdrant_client.scroll.assert_called_once()
        self.assertIn(f"{doc_id}:chunk-0001", tuple(source.chunk_id for source in result.sources))
        self.assertIn("培养目标", " ".join(source.snippet for source in result.sources))


def _backend(*, qdrant_client: object) -> QdrantRetrievalBackend:
    embedding_model = Mock()
    embedding_model.get_query_embedding.return_value = (0.1, 0.2, 0.3)
    sparse_embedding_model = Mock()
    sparse_embedding_model.build_query.return_value = "sparse-query"
    return QdrantRetrievalBackend(
        settings=RetrievalSettings(
            qdrant_url=":memory:",
            document_registry_database_url="postgresql://registry.example/postgres",
        ),
        registry=InMemoryDocumentRegistry(),
        qdrant_client=qdrant_client,
        embedding_model=embedding_model,
        sparse_embedding_model=sparse_embedding_model,
    )


if __name__ == "__main__":
    unittest.main()
