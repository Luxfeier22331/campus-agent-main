from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    EvidenceSource,
    InMemoryDocumentRegistry,
    Mock,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    _apply_document_diversity_policy,
    _build_document_support_query_text,
    _make_runtime_profile,
    _make_source,
    qdrant_models,
    query_targets_source_title,
    unittest,
)


class BackendQdrantCurriculumRankingQueryTextTest(unittest.TestCase):
    def test_query_targets_source_title_accepts_curriculum_title_with_inserted_direction_variant(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_source_title(
                query_text="中国少数民族语言文学强基计划本科人才培养方案",
                source=_make_source(
                    doc_id="curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    chunk_id="curriculum:minority-language-strong-base:chunk-0001",
                    snippet="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案 一、培养目标。",
                    score=0.51,
                    source_title="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    structural_path=(
                        "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                        "一、培养目标",
                    ),
                    content_kind="section_text",
                ),
            )
        )

    def test_query_targets_source_title_accepts_long_semantic_curriculum_title_paraphrase(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_source_title(
                query_text="想看中国少数民族语言文学古文字学方向强基计划培养方案",
                source=_make_source(
                    doc_id="curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    chunk_id="curriculum:minority-language-strong-base:chunk-0001",
                    snippet="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案 一、培养目标。",
                    score=0.51,
                    source_title="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    structural_path=(
                        "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                        "一、培养目标",
                    ),
                    content_kind="section_text",
                ),
            )
        )

    def test_query_targets_source_title_accepts_short_official_web_page_title_with_school_prefix(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_source_title(
                query_text="中央民族大学博士后",
                source=EvidenceSource(
                    doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                    revision_track="source-faithful",
                    version_id="owdocver:test",
                    chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0001",
                    anchor={"segment_ord": 1},
                    canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                    latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                    source_channel="official_web",
                    collection="muc_public_pages",
                    is_current=True,
                    snippet="博士后 学校现有6个博士后科研流动站。",
                    score=0.61,
                    source_title="博士后",
                    structural_path=("博士后",),
                    content_kind="article_body",
                ),
            )
        )

    def test_query_targets_source_title_ignores_parent_heading_for_official_web_reference_doc(
        self,
    ) -> None:
        self.assertFalse(
            query_targets_source_title(
                query_text="中央民族大学学校概况",
                source=EvidenceSource(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    revision_track="source-faithful",
                    version_id="owdocver:test-school-profile",
                    chunk_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487:chunk-0001",
                    anchor={"segment_ord": 1, "section_path": ["学校概况", "学校简介"]},
                    canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    latest_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    source_channel="official_web",
                    collection="stable_reference",
                    is_current=True,
                    snippet="标题：学校简介 中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.61,
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="article_body",
                ),
            )
        )

    def test_build_document_support_query_text_uses_fact_hints_for_official_web_reference_pages(
        self,
    ) -> None:
        school_overview_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
            revision_track="source-faithful",
            version_id="owdocver:test-school-overview",
            chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
            anchor={"segment_ord": 1},
            canonical_url="https://www.muc.edu.cn/xxgk1.htm",
            latest_url="https://www.muc.edu.cn/xxgk1.htm",
            source_channel="official_web",
            collection="muc_public_pages",
            is_current=True,
            snippet="标题：学校概况 学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。",
            score=0.6,
            source_title="学校概况",
            structural_path=("学校概况",),
            content_kind="article_body",
        )
        postdoctoral_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
            revision_track="source-faithful",
            version_id="owdocver:test-postdoc",
            chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0001",
            anchor={"segment_ord": 1},
            canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
            latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
            source_channel="official_web",
            collection="muc_public_pages",
            is_current=True,
            snippet="标题：博士后 中央民族大学全面推动“双一流”建设和整体发展。",
            score=0.6,
            source_title="博士后",
            structural_path=("博士后",),
            content_kind="article_body",
        )
        scholar_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
            revision_track="source-faithful",
            version_id="owdocver:test-scholars",
            chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0001",
            anchor={"segment_ord": 1, "section_path": ["学校概况", "学校概况", "翦伯赞"]},
            canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
            latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
            source_channel="official_web",
            collection="muc_public_pages",
            is_current=True,
            snippet="标题：学术名流 翦伯赞先生对改造旧史学、创建马克思主义新史学做出了卓越贡献。",
            score=0.6,
            source_title="学术名流",
            structural_path=("学术名流", "翦伯赞"),
            content_kind="article_body",
        )

        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学学校概况",
                source=school_overview_source,
            ),
            "学校概况 三个校区 12个学科门类",
        )
        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学博士后",
                source=postdoctoral_source,
            ),
            "博士后 博士后科研流动站 合格率",
        )
        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学学术名流",
                source=scholar_source,
            ),
            "学术名流 历史学 社会学 民族学 人类学 语言学 音乐",
        )

    def test_build_document_support_query_text_uses_fact_hints_for_stable_reference_pages(
        self,
    ) -> None:
        school_overview_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
            revision_track="source-faithful",
            version_id="owdocver:test-school-overview-stable-reference",
            chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
            anchor={"segment_ord": 1},
            canonical_url="https://www.muc.edu.cn/xxgk1.htm",
            latest_url="https://www.muc.edu.cn/xxgk1.htm",
            source_channel="official_web",
            collection="stable_reference",
            is_current=True,
            snippet="标题：学校概况 学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。",
            score=0.6,
            source_title="学校概况",
            structural_path=("学校概况",),
            content_kind="article_body",
        )

        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学学校概况",
                source=school_overview_source,
            ),
            "学校概况 三个校区 12个学科门类",
        )

    def test_apply_document_diversity_policy_prefers_fact_rich_chunk_for_stable_reference_queries(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")
        school_overview_sources = (
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                revision_track="source-faithful",
                version_id="owdocver:test-overview-lead",
                chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
                anchor={"segment_ord": 1},
                canonical_url="https://www.muc.edu.cn/xxgk1.htm",
                latest_url="https://www.muc.edu.cn/xxgk1.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学校概况 中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。学校现有三个校区。",
                score=0.6,
                source_title="学校概况",
                structural_path=("学校概况",),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                revision_track="source-faithful",
                version_id="owdocver:test-overview-facts",
                chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0004",
                anchor={"segment_ord": 4},
                canonical_url="https://www.muc.edu.cn/xxgk1.htm",
                latest_url="https://www.muc.edu.cn/xxgk1.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学校概况 学校拥有门类综合、特色鲜明的高水平学科专业体系。目前，学校设有1个学部、26个学院，有覆盖12个学科门类的71个本科专业。",
                score=0.58,
                source_title="学校概况",
                structural_path=("学校概况",),
                content_kind="article_body",
            ),
        )
        postdoctoral_sources = (
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                revision_track="source-faithful",
                version_id="owdocver:test-postdoc-lead",
                chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0001",
                anchor={"segment_ord": 1},
                canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：博士后 中央民族大学全面推动“双一流”建设和整体发展，创新工作机制，强化服务保障。",
                score=0.62,
                source_title="博士后",
                structural_path=("博士后",),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                revision_track="source-faithful",
                version_id="owdocver:test-postdoc-facts",
                chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0003",
                anchor={"segment_ord": 3},
                canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：博士后 学校现有6个博士后科研流动站。在全国博管会组织的历次流动站评估中，我校参评的流动站合格率均为100％。",
                score=0.57,
                source_title="博士后",
                structural_path=("博士后",),
                content_kind="article_body",
            ),
        )

        school_overview_filtered = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校概况",
            sources=school_overview_sources,
        )
        postdoctoral_filtered = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学博士后",
            sources=postdoctoral_sources,
        )

        self.assertEqual(
            tuple(source.chunk_id for source in school_overview_filtered),
            (
                "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
                "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0004",
            ),
        )
        self.assertEqual(
            tuple(source.chunk_id for source in postdoctoral_filtered),
            (
                "official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0003",
            ),
        )

    def test_apply_document_diversity_policy_keeps_multiple_scholar_chunks_for_scholar_page(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")
        scholar_sources = (
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                revision_track="source-faithful",
                version_id="owdocver:test-scholar-history",
                chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0001",
                anchor={"segment_ord": 1, "section_path": ["学校概况", "学校概况", "翦伯赞"]},
                canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学术名流 翦伯赞先生与郭沫若、范文澜等一起筹建中国历史学会，对改造旧史学、创建马克思主义新史学做出了卓越贡献。",
                score=0.61,
                source_title="学术名流",
                structural_path=("学术名流", "翦伯赞"),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                revision_track="source-faithful",
                version_id="owdocver:test-scholar-social",
                chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0002",
                anchor={"segment_ord": 2, "section_path": ["学校概况", "学校概况", "吴泽霖"]},
                canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学术名流 吴泽霖先生将社会学与民族学、人类学等学科联系起来，对社会现象作跨学科研究。",
                score=0.6,
                source_title="学术名流",
                structural_path=("学术名流", "吴泽霖"),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                revision_track="source-faithful",
                version_id="owdocver:test-scholar-language",
                chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0006",
                anchor={"segment_ord": 6, "section_path": ["学校概况", "学校概况", "于道泉"]},
                canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学术名流 于道泉长期从事藏学人才培养，设计了效果良好的藏语拉丁化拼音方案。",
                score=0.59,
                source_title="学术名流",
                structural_path=("学术名流", "于道泉"),
                content_kind="article_body",
            ),
        )

        scholar_filtered = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学术名流",
            sources=scholar_sources,
        )

        self.assertEqual(
            tuple(source.chunk_id for source in scholar_filtered),
            (
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0001",
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0002",
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0006",
            ),
        )

    def test_expand_named_document_support_uses_focused_query_for_same_document_followup(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = Mock()
        embedding_model.get_query_embedding.side_effect = (
            (0.1, 0.2, 0.3),
            (0.4, 0.5, 0.6),
        )
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.side_effect = ("sparse-full", "sparse-focused")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.side_effect = (
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-intro",
                        version=0,
                        score=0.49,
                        payload={
                            "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:ethnology-second-degree",
                            "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                            "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "民族学本科第二学士学位人才培养方案",
                                    "一、培养目标",
                                ]
                            },
                            "text": "民族学本科第二学士学位人才培养方案 一、培养目标。",
                        },
                    ),
                ]
            ),
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-years",
                        version=0,
                        score=0.47,
                        payload={
                            "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:ethnology-second-degree",
                            "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                            "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "民族学本科第二学士学位人才培养方案",
                                    "五、学制 两年",
                                ]
                            },
                            "text": "五、学制 两年",
                        },
                    ),
                ]
            ),
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        backend.retrieve(
            RetrievalRequest(
                query_text="民族学本科第二学士学位人才培养方案学制几年？",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=5,
            )
        )

        self.assertEqual(embedding_model.get_query_embedding.call_count, 2)
        self.assertEqual(
            embedding_model.get_query_embedding.call_args_list[1].args[0],
            "Instruct: Given a campus policy or handbook question, retrieve relevant passages that answer the query.\nQuery: 学制",
        )
        self.assertEqual(sparse_embedding_model.build_query.call_args_list[1].args[0], "学制")

    def test_build_document_support_query_text_strips_short_fact_question_noise(self) -> None:
        self.assertEqual(
            _build_document_support_query_text(
                query_text="民族学本科第二学士学位人才培养方案学制几年？",
                source=_make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0001",
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="民族学本科第二学士学位人才培养方案",
                ),
            ),
            "学制",
        )

    def test_build_document_support_query_text_strips_table_question_noise(self) -> None:
        self.assertEqual(
            _build_document_support_query_text(
                query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
                source=_make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0001",
                    snippet="经济学拔尖人才创新班人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="经济学拔尖人才创新班人才培养方案",
                ),
            ),
            "课程地图",
        )

    def test_build_document_support_query_text_normalizes_curriculum_alias_and_semester_noise(
        self,
    ) -> None:
        self.assertEqual(
            _build_document_support_query_text(
                query_text="法学民族班培养方案里大二下有什么课",
                source=_make_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:law-ethnic-experimental:chunk-0004",
                    snippet="第四学期 国际公法、知识产权法。",
                    score=0.49,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                ),
            ),
            "第四学期",
        )
