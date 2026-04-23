from __future__ import annotations

from tests.evals.retrieval_benchmark_test_support import (
    CURRICULUM_HYBRID_FIXTURE_PATH,
    CURRICULUM_MANIFEST_PATH,
    HANDBOOK_MANIFEST_PATH,
    HYBRID_FIXTURE_PATH,
    KnowledgeScope,
    Path,
    TemporaryDirectory,
    campus_evals,
    json,
    unittest,
)


class StudentHandbookHybridFixtureTest(unittest.TestCase):
    def test_load_hybrid_fixture_reads_phase1_baseline(self) -> None:
        self.assertTrue(hasattr(campus_evals, "load_retrieval_hybrid_query_dataset"))
        self.assertTrue(hasattr(campus_evals, "RetrievalHybridQueryDataset"))

        load_fixture = campus_evals.load_retrieval_hybrid_query_dataset
        dataset_type = campus_evals.RetrievalHybridQueryDataset

        dataset = load_fixture(HYBRID_FIXTURE_PATH)

        self.assertIsInstance(dataset, dataset_type)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="regulations", collection="student_rules")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertEqual(len(dataset.cases), 7)

    def test_load_hybrid_fixture_rejects_unsupported_category(self) -> None:
        load_fixture = campus_evals.load_retrieval_hybrid_query_dataset

        with TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "hybrid.json"
            fixture_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {"dense_model": "Qwen3-Embedding-4B"},
                        "cases": [
                            {
                                "case_id": "unsupported-category",
                                "category": "restricted_scope_filter",
                                "query": "办公室值班时间",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "unsupported hybrid query category"):
                load_fixture(fixture_path)

    def test_load_hybrid_fixture_accepts_canonical_scope_keys(self) -> None:
        load_fixture = campus_evals.load_retrieval_hybrid_query_dataset

        with TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "hybrid.json"
            fixture_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {"dense_model": "Qwen3-Embedding-4B"},
                        "cases": [
                            {
                                "case_id": "canonical-scope",
                                "category": "restricted_visibility_scope_filter",
                                "query": "办公室值班时间",
                                "scope": {
                                    "entitlement_groups": ["students"],
                                    "visibility_scope": "main",
                                },
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            dataset = load_fixture(fixture_path)

        self.assertEqual(
            dataset.cases[0].scope,
            {
                "entitlement_groups": ["students"],
                "visibility_scope": "main",
            },
        )

    def test_load_hybrid_fixture_rejects_unsupported_scope_keys(self) -> None:
        load_fixture = campus_evals.load_retrieval_hybrid_query_dataset

        with TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "hybrid.json"
            fixture_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {"dense_model": "Qwen3-Embedding-4B"},
                        "cases": [
                            {
                                "case_id": "unsupported-scope",
                                "category": "restricted_entitlement_filter",
                                "query": "办公室值班时间",
                                "scope": {"unsupported_scope": ["students"]},
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "unsupported hybrid fixture scope keys"):
                load_fixture(fixture_path)

    def test_hybrid_fixture_stays_within_current_handbook_boundary(self) -> None:
        fixture = json.loads(HYBRID_FIXTURE_PATH.read_text(encoding="utf-8"))
        case_ids = {case["case_id"] for case in fixture["cases"]}
        categories = {case["category"] for case in fixture["cases"]}

        self.assertEqual(
            case_ids,
            {
                "article-number-degree-procedure",
                "policy-title-scholarship",
                "policy-alias-national-scholarship-article-nine",
                "policy-alias-national-scholarship-author-affiliation",
                "fixed-phrase-dormitory-lighting",
                "semantic-student-card-reissue",
                "no-hit-impossible-query",
            },
        )
        self.assertEqual(
            categories,
            {
                "article_number_exact_match",
                "policy_title_exact_match",
                "policy_alias_targeted",
                "fixed_phrase_sparse_win",
                "semantic_dense_win",
                "no_hit",
            },
        )

    def test_hybrid_fixture_does_not_require_restricted_scope_when_manifest_has_none(self) -> None:
        fixture = json.loads(HYBRID_FIXTURE_PATH.read_text(encoding="utf-8"))
        manifest = json.loads(HANDBOOK_MANIFEST_PATH.read_text(encoding="utf-8"))
        manifest_has_entitlement_projection = any(
            item.get("entitlement_groups") for item in manifest["documents"]
        )
        manifest_has_visibility_scope = any(
            item.get("visibility_scope") for item in manifest["documents"]
        )

        if manifest_has_entitlement_projection or manifest_has_visibility_scope:
            self.skipTest("student_rules manifest now carries restricted source truth")

        scoped_case_ids = {
            case["case_id"]
            for case in fixture["cases"]
            if (case.get("scope") or {}).get("entitlement_groups")
            or (case.get("scope") or {}).get("visibility_scope")
        }
        self.assertEqual(scoped_case_ids, set())

    def test_hybrid_fixture_uses_queries_grounded_in_current_manifest_titles(self) -> None:
        fixture = json.loads(HYBRID_FIXTURE_PATH.read_text(encoding="utf-8"))
        cases_by_id = {case["case_id"]: case for case in fixture["cases"]}

        self.assertEqual(
            cases_by_id["policy-title-scholarship"]["query"],
            "中央民族大学本科学生国家奖学金评审办法",
        )
        self.assertEqual(
            cases_by_id["fixed-phrase-dormitory-lighting"]["query"],
            "宿舍照明",
        )
        self.assertEqual(
            cases_by_id["semantic-student-card-reissue"]["query"],
            "学生证丢了怎么办",
        )
        self.assertEqual(
            cases_by_id["policy-alias-national-scholarship-article-nine"]["forbidden_doc_ids"],
            ["handbook:651a8dbf99f52b997bc74ae8fd6cd287887f74a7"],
        )
        self.assertEqual(
            cases_by_id["policy-alias-national-scholarship-author-affiliation"][
                "expected_keywords"
            ],
            ["国家奖学金", "第一作者", "第二作者"],
        )

    def test_validate_hybrid_fixture_rejects_restricted_scope_and_titleless_fixed_phrase_drift(
        self,
    ) -> None:
        self.assertTrue(hasattr(campus_evals, "validate_retrieval_hybrid_query_fixture"))
        validate_fixture = campus_evals.validate_retrieval_hybrid_query_fixture

        with TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "hybrid.json"
            manifest_path = Path(temp_dir) / "manifest.json"
            fixture_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {"dense_model": "Qwen3-Embedding-4B"},
                        "cases": [
                            {
                                "case_id": "restricted-entitlement-case",
                                "category": "restricted_entitlement_filter",
                                "query": "办公室值班时间",
                                "scope": {"entitlement_groups": ["students"]},
                                "expected_keywords": [],
                            },
                            {
                                "case_id": "restricted-visibility-case",
                                "category": "restricted_visibility_scope_filter",
                                "query": "南沙校区 图书馆 开放",
                                "scope": {"visibility_scope": "nansha"},
                                "expected_keywords": ["南沙"],
                            },
                            {
                                "case_id": "fixed-case",
                                "category": "fixed_phrase_sparse_win",
                                "query": "图书馆开放时间",
                                "expected_keywords": ["图书馆", "开放时间"],
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            manifest_path.write_text(
                json.dumps(
                    {
                        "documents": [
                            {
                                "document_id": "handbook:1",
                                "title": "中央民族大学关于学生宿舍照明的管理规定",
                            },
                            {
                                "document_id": "handbook:2",
                                "title": "中央民族大学本科学生国家奖学金评审办法",
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            errors = validate_fixture(fixture_path, manifest_path=manifest_path)

        self.assertEqual(
            errors,
            (
                "case restricted-entitlement-case requires entitlement scope, but the manifest has no entitlement-projected regulations/student_rules documents",
                "case restricted-visibility-case requires visibility_scope, but the manifest has no visibility-scoped regulations/student_rules documents",
                "case fixed-case category fixed_phrase_sparse_win is not grounded in any current regulations/student_rules title keyword",
            ),
        )

    def test_validate_hybrid_fixture_accepts_current_official_fixture(self) -> None:
        validate_fixture = campus_evals.validate_retrieval_hybrid_query_fixture
        errors = validate_fixture(HYBRID_FIXTURE_PATH, manifest_path=HANDBOOK_MANIFEST_PATH)

        self.assertEqual(errors, ())


class CurriculumHybridFixtureTest(unittest.TestCase):
    def test_load_curriculum_hybrid_fixture_reads_curriculum_baseline(self) -> None:
        load_fixture = campus_evals.load_retrieval_hybrid_query_dataset
        dataset_type = campus_evals.RetrievalHybridQueryDataset

        dataset = load_fixture(CURRICULUM_HYBRID_FIXTURE_PATH)

        self.assertIsInstance(dataset, dataset_type)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertGreaterEqual(len(dataset.cases), 8)

    def test_curriculum_hybrid_fixture_covers_key_categories(self) -> None:
        fixture = json.loads(CURRICULUM_HYBRID_FIXTURE_PATH.read_text(encoding="utf-8"))
        case_ids = {case["case_id"] for case in fixture["cases"]}
        categories = {case["category"] for case in fixture["cases"]}

        self.assertTrue(
            {
                "ethnology-plan-title",
                "academic-years-short-fact",
                "course-settings-table-hit",
                "minority-language-strong-base-fixed-phrase",
                "law-ethnic-class-fourth-semester-courses",
                "cross-major-disambiguation",
                "generic-base-class-needs-clarification",
                "no-hit-impossible-query",
            }.issubset(case_ids)
        )
        self.assertTrue(
            {
                "policy_title_exact_match",
                "fixed_phrase_sparse_win",
                "short_fact_section",
                "table_retrieval",
                "needs_clarification",
                "no_hit",
            }.issubset(categories)
        )

    def test_validate_curriculum_hybrid_fixture_accepts_current_fixture(self) -> None:
        validate_fixture = campus_evals.validate_retrieval_hybrid_query_fixture
        errors = validate_fixture(
            CURRICULUM_HYBRID_FIXTURE_PATH, manifest_path=CURRICULUM_MANIFEST_PATH
        )

        self.assertEqual(errors, ())
