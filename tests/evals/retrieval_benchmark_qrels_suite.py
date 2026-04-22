from __future__ import annotations

from tests.evals.retrieval_benchmark_test_support import (
    ANNOTATION_TEMPLATE_PATH,
    CURRICULUM_ANNOTATION_TEMPLATE_PATH,
    CURRICULUM_MANIFEST_PATH,
    CURRICULUM_QRELS_FIXTURE_PATH,
    FIXTURE_PATH,
    HANDBOOK_MANIFEST_PATH,
    OFFICIAL_WEB_FRESH_NEWS_MANIFEST_PATH,
    OFFICIAL_WEB_FRESH_NEWS_QRELS_FIXTURE_PATH,
    OFFICIAL_WEB_MANIFEST_PATH,
    OFFICIAL_WEB_QRELS_FIXTURE_PATH,
    OFFICIAL_WEB_STABLE_REFERENCE_MANIFEST_PATH,
    OFFICIAL_WEB_STABLE_REFERENCE_QRELS_FIXTURE_PATH,
    KnowledgeScope,
    Path,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    TemporaryDirectory,
    campus_evals,
    json,
    load_retrieval_qrels_dataset,
    resolve_retrieval_fixture_manifest_path,
    unittest,
    validate_retrieval_qrels_fixture,
)


class BenchmarkModuleFacadeTest(unittest.TestCase):
    def test_benchmark_module_keeps_public_retrieval_exports(self) -> None:
        benchmark_module = campus_evals.benchmark

        for name in (
            "RetrievalBenchmarkRun",
            "RetrievalCaseMetrics",
            "RetrievalHybridQueryCase",
            "RetrievalHybridQueryDataset",
            "RetrievalMetricSummary",
            "RetrievalObservedSource",
            "RetrievalQrelsCase",
            "RetrievalQrelsDataset",
            "RetrievalQrelsSourceRef",
            "evaluate_retrieval_case",
            "evaluate_retrieval_run",
            "load_retrieval_benchmark_run",
            "load_retrieval_hybrid_query_dataset",
            "load_retrieval_qrels_dataset",
            "render_retrieval_summary_text",
            "resolve_retrieval_fixture_manifest_path",
            "summarize_retrieval_metrics",
            "validate_retrieval_hybrid_query_fixture",
            "validate_retrieval_qrels_fixture",
        ):
            self.assertTrue(hasattr(benchmark_module, name), name)


class RetrievalQrelsFixtureTest(unittest.TestCase):
    def test_load_retrieval_qrels_dataset_reads_phase1_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="regulations", collection="student_handbook")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertGreaterEqual(len(dataset.cases), 10)

    def test_qrels_fixture_locks_handbook_truth_to_doc_level_manifest_ids(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        case_ids = {case.case_id for case in dataset.cases}
        self.assertIn("article-number-degree-procedure", case_ids)
        self.assertIn("fixed-phrase-medical-reimbursement", case_ids)
        self.assertIn("policy-title-national-encouragement-scholarship", case_ids)
        self.assertIn("policy-alias-national-scholarship-article-nine", case_ids)
        self.assertIn("policy-alias-national-scholarship-author-affiliation", case_ids)
        self.assertIn("semantic-disciplinary-relief", case_ids)
        self.assertIn("short-fact-attendance-discipline-threshold", case_ids)
        self.assertIn("structured-disciplinary-relief-materials", case_ids)
        article_case = next(
            case for case in dataset.cases if case.case_id == "article-number-degree-procedure"
        )
        fixed_phrase_case = next(
            case for case in dataset.cases if case.case_id == "fixed-phrase-medical-reimbursement"
        )
        policy_alias_case = next(
            case
            for case in dataset.cases
            if case.case_id == "policy-alias-national-scholarship-author-affiliation"
        )
        self.assertTrue(all(source.chunk_id is None for source in article_case.expected_sources))
        self.assertTrue(
            all(source.chunk_id is None for source in fixed_phrase_case.expected_sources)
        )
        self.assertEqual(
            tuple(source.doc_id for source in policy_alias_case.expected_sources),
            ("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",),
        )
        self.assertEqual(
            tuple(source.doc_id for source in policy_alias_case.forbidden_sources),
            ("handbook:651a8dbf99f52b997bc74ae8fd6cd287887f74a7",),
        )

    def test_handbook_qrels_fixture_contains_multiple_forbidden_source_cases(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        forbidden_case_ids = {case.case_id for case in dataset.cases if case.forbidden_sources}
        self.assertTrue(
            {
                "policy-title-national-encouragement-scholarship",
                "policy-alias-national-scholarship-article-nine",
                "policy-alias-national-scholarship-author-affiliation",
                "semantic-disciplinary-relief",
                "structured-disciplinary-relief-materials",
            }.issubset(forbidden_case_ids)
        )

    def test_handbook_qrels_fixture_contains_selected_version_locked_cases(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        version_locked_case_ids = {
            case.case_id
            for case in dataset.cases
            if any(source.version_id is not None for source in case.expected_sources)
        }
        self.assertTrue(
            {
                "policy-title-medical",
                "semantic-student-card-reissue",
            }.issubset(version_locked_case_ids)
        )
        self.assertTrue(
            all(
                source.chunk_id is None
                for case in dataset.cases
                if case.case_id in {"policy-title-medical", "semantic-student-card-reissue"}
                for source in case.expected_sources
            )
        )

    def test_qrels_fixture_uses_empty_request_overrides_for_handbook_scope(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        self.assertTrue(all(case.request_overrides == {} for case in dataset.cases))

    def test_annotation_template_exists_and_matches_qrels_case_count(self) -> None:
        template = json.loads(ANNOTATION_TEMPLATE_PATH.read_text(encoding="utf-8"))
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        self.assertEqual(template["schema_version"], 1)
        self.assertEqual(template["corpus"], "regulations")
        self.assertEqual(template["collection"], "student_handbook")
        self.assertEqual(len(template["cases"]), len(dataset.cases))
        self.assertIn("instructions", template)

    def test_qrels_fixture_expected_doc_ids_align_with_student_handbook_manifest(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)
        manifest = json.loads(HANDBOOK_MANIFEST_PATH.read_text(encoding="utf-8"))
        manifest_doc_ids = {item["document_id"] for item in manifest["documents"]}
        referenced_doc_ids = {
            source.doc_id
            for case in dataset.cases
            for source in (*case.expected_sources, *case.forbidden_sources)
        }

        self.assertTrue(referenced_doc_ids)
        self.assertTrue(referenced_doc_ids.issubset(manifest_doc_ids))

    def test_qrels_fixture_does_not_require_restricted_scope_cases_without_source_truth(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)
        manifest = json.loads(HANDBOOK_MANIFEST_PATH.read_text(encoding="utf-8"))
        manifest_has_entitlement_projection = any(
            item.get("entitlement_groups") for item in manifest["documents"]
        )
        manifest_has_visibility_scope = any(
            item.get("visibility_scope") for item in manifest["documents"]
        )

        if manifest_has_entitlement_projection or manifest_has_visibility_scope:
            self.skipTest("student_handbook manifest now carries restricted source truth")

        overridden_case_ids = {
            case.case_id
            for case in dataset.cases
            if case.request_overrides.get("entitlement_groups")
            or case.request_overrides.get("visibility_scope")
        }

        self.assertEqual(overridden_case_ids, set())

    def test_load_curriculum_retrieval_qrels_dataset_reads_curriculum_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertGreaterEqual(len(dataset.cases), 12)

    def test_curriculum_annotation_template_exists_and_matches_qrels_case_count(self) -> None:
        template = json.loads(CURRICULUM_ANNOTATION_TEMPLATE_PATH.read_text(encoding="utf-8"))
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)

        self.assertEqual(template["schema_version"], 1)
        self.assertEqual(template["corpus"], "curriculum")
        self.assertEqual(template["collection"], "curriculum_plan")
        self.assertEqual(len(template["cases"]), len(dataset.cases))
        self.assertIn("instructions", template)

    def test_curriculum_qrels_fixture_expected_doc_ids_align_with_curriculum_manifest(self) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)
        manifest = json.loads(CURRICULUM_MANIFEST_PATH.read_text(encoding="utf-8"))
        manifest_doc_ids = {item["document_id"] for item in manifest["documents"]}
        referenced_doc_ids = {
            source.doc_id
            for case in dataset.cases
            for source in (*case.expected_sources, *case.forbidden_sources)
        }

        self.assertTrue(referenced_doc_ids)
        self.assertTrue(referenced_doc_ids.issubset(manifest_doc_ids))

    def test_curriculum_qrels_fixture_uses_source_faithful_scope_only(self) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)

        self.assertTrue(
            all(
                case.scope == KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                for case in dataset.cases
            )
        )
        self.assertTrue(all(case.request_overrides == {} for case in dataset.cases))

    def test_curriculum_qrels_fixture_contains_disambiguation_and_paraphrase_cases(self) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)

        case_ids = {case.case_id for case in dataset.cases}
        self.assertTrue(
            {
                "minority-language-strong-base-title",
                "minority-language-strong-base-fixed-phrase",
                "semantic-minority-language-strong-base-paraphrase",
                "hanyu-international-students-title",
                "hanyu-international-students-total-credits",
                "philosophy-strong-base-title",
                "digital-economy-plan-paraphrase",
                "general-english-total-credits",
                "semantic-philosophy-strong-base-paraphrase",
            }.issubset(case_ids)
        )
        forbidden_case_ids = {case.case_id for case in dataset.cases if case.forbidden_sources}
        self.assertTrue(
            {
                "history-strong-base-title",
                "minority-language-strong-base-title",
                "semantic-minority-language-strong-base-paraphrase",
                "hanyu-international-students-title",
                "hanyu-international-students-total-credits",
                "philosophy-strong-base-title",
                "digital-economy-plan-paraphrase",
                "general-english-total-credits",
                "semantic-philosophy-strong-base-paraphrase",
            }.issubset(forbidden_case_ids)
        )

    def test_curriculum_qrels_fixture_contains_selected_version_locked_cases(self) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)

        version_locked_case_ids = {
            case.case_id
            for case in dataset.cases
            if any(source.version_id is not None for source in case.expected_sources)
        }
        self.assertTrue(
            {
                "minority-language-strong-base-title",
                "digital-economy-plan-paraphrase",
                "general-english-total-credits",
                "hanyu-international-students-total-credits",
                "education-second-degree-academic-years",
                "fiscal-course-settings-table",
            }.issubset(version_locked_case_ids)
        )
        self.assertTrue(
            all(
                source.chunk_id is None
                for case in dataset.cases
                if case.case_id
                in {
                    "minority-language-strong-base-title",
                    "digital-economy-plan-paraphrase",
                    "general-english-total-credits",
                    "hanyu-international-students-total-credits",
                    "education-second-degree-academic-years",
                    "fiscal-course-settings-table",
                }
                for source in case.expected_sources
            )
        )

    def test_curriculum_qrels_fixture_expands_short_fact_and_table_depth(self) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)

        case_ids = {case.case_id for case in dataset.cases}
        self.assertTrue(
            {
                "minority-language-total-credits",
                "hanyu-international-students-total-credits",
                "education-second-degree-academic-years",
                "fiscal-course-settings-table",
                "law-ethnic-class-fourth-semester-courses",
            }.issubset(case_ids)
        )

    def test_curriculum_qrels_fixture_contains_uniquely_grounded_sparse_fixed_phrase_case(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)
        cases = {case.case_id: case for case in dataset.cases}

        case = cases["minority-language-strong-base-fixed-phrase"]
        self.assertEqual(case.query, "古文字学方向强基计划")
        self.assertEqual(case.split, "smoke")
        self.assertEqual(
            case.expected_sources[0].doc_id,
            "curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
        )
        self.assertEqual(
            case.forbidden_sources[0].doc_id, "curriculum:中国少数民族语言文学本科人才培养方案"
        )

    def test_curriculum_qrels_fixture_validation_has_no_issues(self) -> None:
        issues = validate_retrieval_qrels_fixture(
            CURRICULUM_QRELS_FIXTURE_PATH,
            manifest_path=CURRICULUM_MANIFEST_PATH,
        )

        self.assertEqual(issues, ())

    def test_validate_retrieval_qrels_fixture_flags_ambiguous_title_fragment_truth(self) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "ambiguous-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "fixed-phrase-ethnic-experimental-class",
                                "split": "smoke",
                                "query": "民族实验班",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("fixed-phrase-ethnic-experimental-class", issues[0])
        self.assertIn("ambiguously matches", issues[0])
        self.assertIn("needs_clarification", issues[0])

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

    def test_validate_retrieval_qrels_fixture_flags_course_family_alias_collapsed_to_single_course(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-alias-collapsed",
                                "split": "smoke",
                                "query": "思政课有哪些专业要上",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "思政课 family alias should not collapse to a single-course qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-alias-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_alias_variant_collapsed_to_single_course(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-variant-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-alias-variant-collapsed",
                                "split": "smoke",
                                "query": "思政课程包括哪些课",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "course-family alias variants should not collapse to a single-course qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-alias-variant-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_schedule_alias_collapsed_to_single_doc(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-schedule-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-schedule-collapsed",
                                "split": "smoke",
                                "query": "思政课第几学期开",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "course-family schedule should not collapse to a single-doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-schedule-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_schedule_partial_alias_collapsed_to_single_doc(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-schedule-partial-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-schedule-partial-collapsed",
                                "split": "smoke",
                                "query": "思政课哪个学院开，第几学期开",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "course-family mixed schedule/offering-unit query must not collapse to a single-doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-schedule-partial-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_schedule_short_alias_collapsed_to_single_doc(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-schedule-short-alias-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-schedule-short-alias-collapsed",
                                "split": "smoke",
                                "query": "思政第几学期开",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-schedule-short-alias-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_course_family_schedule_alias_variant_collapsed_to_single_doc(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "course-family-schedule-variant-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "course-family-schedule-variant-collapsed",
                                "split": "smoke",
                                "query": "思政课程第几学期开",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                        "grade": 2,
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("course-family-schedule-variant-collapsed", issues[0])
        self.assertIn("canonical qrels must not lock this", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_program_family_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-membership-collapsed",
                                "split": "smoke",
                                "query": "基地班有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:历史学（强基计划）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "program-family membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-membership-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_generic_experimental_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-experimental-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-experimental-collapsed",
                                "split": "smoke",
                                "query": "实验班有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:孝通实验班本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "generic experimental-class membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-experimental-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_strong_base_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-strong-base-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-strong-base-collapsed",
                                "split": "smoke",
                                "query": "强基有哪些专业",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:历史学（强基计划）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "strong-base membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-strong-base-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_full_strong_base_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-strong-base-full-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-strong-base-full-collapsed",
                                "split": "smoke",
                                "query": "强基计划有哪些专业",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:历史学（强基计划）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "full strong-base membership alias must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-strong-base-full-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_second_degree_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-second-degree-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-second-degree-collapsed",
                                "split": "smoke",
                                "query": "二学位有哪些专业",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "second-degree membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-second-degree-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_full_second_degree_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-second-degree-full-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-second-degree-full-collapsed",
                                "split": "smoke",
                                "query": "第二学士学位有哪些专业",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "full second-degree membership alias must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-second-degree-full-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_innovation_experimental_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-innovation-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-innovation-collapsed",
                                "split": "smoke",
                                "query": "创新实验班有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:光电科学与工程创新实验班本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "innovation-class membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-innovation-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_ethnic_experimental_membership_alias_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-ethnic-experimental-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-ethnic-experimental-collapsed",
                                "split": "smoke",
                                "query": "民族实验班有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "ethnic experimental class membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-ethnic-experimental-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_name_pattern_experimental_membership_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-name-pattern-experimental-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-name-pattern-experimental-collapsed",
                                "split": "smoke",
                                "query": "名称里带实验班的培养方案有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:孝通实验班本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "name-pattern experimental membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-name-pattern-experimental-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_name_pattern_innovation_membership_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "program-family-name-pattern-innovation-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "program-family-name-pattern-innovation-collapsed",
                                "split": "smoke",
                                "query": "名称里带创新班的培养方案有哪些",
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "name-pattern innovation membership must not collapse to a single curriculum doc qrels truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("program-family-name-pattern-innovation-collapsed", issues[0])
        self.assertIn("family-aware completed case", issues[0])

    def test_validate_retrieval_qrels_fixture_flags_soft_personalization_only_single_doc_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "soft-personalization-qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "soft-personalization-collapsed",
                                "split": "smoke",
                                "query": "基地班",
                                "request_overrides": {
                                    "recent_goal": "我刚刚在看历史学强基计划培养方案",
                                    "confirmed_slot_terms": ["历史学"],
                                },
                                "expected_sources": [
                                    {
                                        "doc_id": "curriculum:历史学（强基计划）本科人才培养方案",
                                        "grade": 2,
                                    }
                                ],
                                "notes": "soft personalization alone must not justify canonical single-doc curriculum truth",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            issues = validate_retrieval_qrels_fixture(
                qrels_path,
                manifest_path=CURRICULUM_MANIFEST_PATH,
                ambiguity_severity="error",
            )

        self.assertEqual(len(issues), 1)
        self.assertIn("soft-personalization-collapsed", issues[0])
        self.assertIn("soft personalization alone", issues[0])
