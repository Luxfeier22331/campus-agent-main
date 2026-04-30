from __future__ import annotations

from tests.evals.retrieval_benchmark_test_support import (
    OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH,
    OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH,
    OFFICIAL_WEB_MANIFEST_PATH,
    OFFICIAL_WEB_QRELS_FIXTURE_PATH,
    OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH,
    OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH,
    KnowledgeScope,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    load_retrieval_qrels_dataset,
    resolve_retrieval_fixture_manifest_path,
    unittest,
    validate_retrieval_qrels_fixture,
)


class RetrievalOfficialWebQrelsFixtureTest(unittest.TestCase):
    def test_load_official_web_retrieval_qrels_dataset_reads_current_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_QRELS_FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="official_web", collection="muc_public_pages")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertEqual(
            {case.case_id for case in dataset.cases},
            {
                "topic-law-interpretation",
                "cross-host-duplicate-employment-base",
                "stable-reference-school-profile",
                "stable-reference-current-leadership",
                "stable-reference-alumni-association-profile",
                "stable-reference-foundation-profile",
                "stable-reference-library-lecture-notice",
                "no-hit-campus-name-generic",
                "no-hit-unanchored-life-service",
            },
        )

    def test_official_web_qrels_fixture_locks_expected_sources_to_current_doc_and_version_ids(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_QRELS_FIXTURE_PATH)
        cases = {case.case_id: case for case in dataset.cases}

        self.assertEqual(
            cases["topic-law-interpretation"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:871878763a91199730493efe0cbb0358b884fe58",
                    version_id="owdocver:fa5f1f590e722118a3800d65e8e95125af62c74a",
                    grade=2,
                    rationale="明确主题问法应命中当前 registry truth 中的法治解读文章。",
                ),
            ),
        )
        self.assertEqual(
            cases["cross-host-duplicate-employment-base"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:ac8ea5921fa808dea152c171d6b0c6c0ba1cc62f",
                    version_id="owdocver:9be8a3dbe619d97df54d60cbe77d8903698b8fd3",
                    grade=2,
                    rationale="news/xxgk 跨 host 同文在 current truth 中应只保留一个逻辑文档。",
                ),
            ),
        )
        self.assertEqual(
            cases["stable-reference-school-profile"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    version_id="owdocver:934d619cea41b7add23484fa2d8c2e79c0c5666e",
                    grade=2,
                    rationale="学校简介 query 应命中当前稳定介绍页，而不是新闻正文。",
                ),
            ),
        )
        self.assertEqual(
            cases["stable-reference-school-profile"].forbidden_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    version_id="owdocver:f7ee81c9f937fe14f493a81e4e5b5b815f2995e6",
                    grade=1,
                    rationale="标题已明确指向学校简介时，不应再把学校概况作为并列 retrieval truth。",
                ),
            ),
        )
        self.assertEqual(
            cases["stable-reference-current-leadership"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:43fdab9acbf0e68e67fddba209463e97d0b2fe4e",
                    version_id="owdocver:14935f44e582597fdebffe3e8f2bcc9921e2fd06",
                    grade=2,
                    rationale="现任领导 query 应命中当前 roster/reference 页面。",
                ),
            ),
        )
        self.assertEqual(
            cases["stable-reference-current-leadership"].forbidden_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:df9f5e313546d24c7a384598d1b676d6b005d881",
                    version_id="owdocver:1970a7c8d052144896ffd12d5785055720c8fa82",
                    grade=1,
                    rationale="现任领导 query 不应误召回更泛的干部人事栏目页。",
                ),
            ),
        )

    def test_official_web_qrels_fixture_uses_no_hit_cases_for_low_signal_queries(self) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_QRELS_FIXTURE_PATH)

        no_hit_cases = {
            case.case_id
            for case in dataset.cases
            if not case.expected_sources and not case.forbidden_sources
        }
        self.assertEqual(
            no_hit_cases,
            {
                "no-hit-campus-name-generic",
                "no-hit-unanchored-life-service",
            },
        )

    def test_validate_official_web_qrels_fixture_against_current_manifest_has_no_issues(
        self,
    ) -> None:
        self.assertEqual(
            validate_retrieval_qrels_fixture(
                OFFICIAL_WEB_QRELS_FIXTURE_PATH,
                manifest_path=OFFICIAL_WEB_MANIFEST_PATH,
                ambiguity_severity="error",
            ),
            (),
        )

    def test_resolve_retrieval_fixture_manifest_path_supports_official_web_scope(self) -> None:
        self.assertEqual(
            resolve_retrieval_fixture_manifest_path(OFFICIAL_WEB_QRELS_FIXTURE_PATH),
            OFFICIAL_WEB_MANIFEST_PATH,
        )

    def test_load_official_web_stable_reference_retrieval_qrels_dataset_reads_split_baseline(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="official_web", collection="stable_reference")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertEqual(
            {case.case_id for case in dataset.cases},
            {
                "stable-reference-school-profile",
                "stable-reference-school-overview",
                "stable-reference-current-leadership",
                "stable-reference-alumni-association-profile",
                "stable-reference-foundation-profile",
                "stable-reference-undergraduate-education",
                "stable-reference-graduate-education",
                "stable-reference-postdoctoral-program",
                "stable-reference-scholars",
                "stable-reference-no-hit-fictional-service",
            },
        )

    def test_official_web_stable_reference_qrels_fixture_locks_expected_sources_to_split_doc_truth(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH)
        cases = {case.case_id: case for case in dataset.cases}

        self.assertEqual(
            cases["stable-reference-school-profile"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    version_id="owdocver:934d619cea41b7add23484fa2d8c2e79c0c5666e",
                    grade=2,
                    rationale="学校简介 query 应命中 stable_reference 的学校简介页面。",
                ),
            ),
        )
        self.assertEqual(
            cases["stable-reference-school-overview"].forbidden_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    version_id="owdocver:934d619cea41b7add23484fa2d8c2e79c0c5666e",
                    grade=1,
                    rationale="学校概况 query 不应被学校简介页面替代。",
                ),
            ),
        )
        self.assertEqual(
            cases["stable-reference-foundation-profile"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:3342689d05d43819a48bbcf7564f013f217ffe46",
                    version_id="owdocver:b804aee18c6ba82af29a8f0dca36ac0e92f550aa",
                    grade=2,
                    rationale="基金会简介 query 应命中 stable_reference 的基金会页面。",
                ),
            ),
        )
        self.assertEqual(
            cases["stable-reference-scholars"].expected_sources,
            (
                RetrievalQrelsSourceRef(
                    doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                    version_id="owdocver:80a060b7e821f9a3ca8a57d3c674f9045157b981",
                    grade=2,
                    rationale="学术名流 query 应命中 stable_reference 的学术名流页面。",
                ),
            ),
        )

    def test_validate_official_web_stable_reference_qrels_fixture_against_split_manifest_has_no_issues(
        self,
    ) -> None:
        self.assertEqual(
            validate_retrieval_qrels_fixture(
                OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH,
                manifest_path=OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH,
                ambiguity_severity="error",
            ),
            (),
        )

    def test_resolve_retrieval_fixture_manifest_path_supports_official_web_stable_reference_scope(
        self,
    ) -> None:
        self.assertEqual(
            resolve_retrieval_fixture_manifest_path(
                OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH
            ),
            OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH,
        )

    def test_load_official_web_fresh_news_retrieval_qrels_dataset_reads_seed_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="official_web", collection="fresh_news")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertEqual(len(dataset.cases), 8)

    def test_validate_official_web_fresh_news_qrels_fixture_against_split_manifest_has_no_issues(
        self,
    ) -> None:
        self.assertEqual(
            validate_retrieval_qrels_fixture(
                OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH,
                manifest_path=OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH,
                ambiguity_severity="error",
            ),
            (),
        )

    def test_resolve_retrieval_fixture_manifest_path_supports_official_web_fresh_news_scope(
        self,
    ) -> None:
        self.assertEqual(
            resolve_retrieval_fixture_manifest_path(OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH),
            OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH,
        )
