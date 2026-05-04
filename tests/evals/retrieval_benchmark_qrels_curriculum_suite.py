from __future__ import annotations

from tests.evals.retrieval_benchmark_test_support import (
    CURRICULUM_ANNOTATION_TEMPLATE_PATH,
    CURRICULUM_MANIFEST_PATH,
    CURRICULUM_QRELS_FIXTURE_PATH,
    KnowledgeScope,
    RetrievalQrelsDataset,
    json,
    load_retrieval_qrels_dataset,
    unittest,
    validate_retrieval_qrels_fixture,
)


class RetrievalCurriculumQrelsFixtureTest(unittest.TestCase):
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

    def test_curriculum_qrels_fixture_uses_source_faithful_scope_with_only_explicit_authz_overrides(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)

        self.assertTrue(
            all(
                case.scope == KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                for case in dataset.cases
            )
        )
        allowed_request_overrides_by_case = {
            "curriculum-title-social-practice": {
                "entitlement_groups": ["campus_members"],
                "visibility_level": "restricted",
            }
        }
        self.assertEqual(
            {
                case.case_id: case.request_overrides
                for case in dataset.cases
                if case.request_overrides
            },
            allowed_request_overrides_by_case,
        )

    def test_curriculum_social_practice_qrels_case_uses_campus_member_authorization(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)
        case_by_id = {case.case_id: case for case in dataset.cases}

        social_practice_case = case_by_id["curriculum-title-social-practice"]

        self.assertEqual(
            social_practice_case.expected_sources[0].doc_id,
            "curriculum:中央民族大学大学生社会实践环节实施方案",
        )
        self.assertEqual(
            social_practice_case.request_overrides,
            {
                "entitlement_groups": ["campus_members"],
                "visibility_level": "restricted",
            },
        )

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

    def test_curriculum_maturity_expansion_covers_core_program_families(self) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)
        release_acceptance = json.loads(
            (
                CURRICULUM_QRELS_FIXTURE_PATH.parent / "curriculum_plan_release_acceptance.v1.json"
            ).read_text(encoding="utf-8")
        )
        case_ids = {case.case_id for case in dataset.cases}
        release_case_ids = {case["case_id"] for case in release_acceptance["cases"]}
        unique_expected_doc_ids = {
            source.doc_id for case in dataset.cases for source in case.expected_sources
        }

        expected_maturity_case_ids = {
            "curriculum-title-general-chinese-culture",
            "curriculum-title-general-information-literacy",
            "curriculum-title-general-national-security",
            "curriculum-title-general-physical-education",
            "curriculum-title-accounting-second-degree",
            "curriculum-title-sports-education",
            "curriculum-title-russian-central-asian",
            "curriculum-title-information-computing",
            "curriculum-title-information-computing-ethnic",
            "curriculum-title-optical-information",
            "curriculum-title-public-management",
            "curriculum-title-law-undergraduate",
            "curriculum-title-law-second-degree",
            "curriculum-title-computer-science-ethnic",
            "curriculum-title-computer-category",
        }

        self.assertGreaterEqual(len(dataset.cases), 60)
        self.assertGreaterEqual(len(unique_expected_doc_ids), 45)
        self.assertGreaterEqual(len(release_acceptance["cases"]), 30)
        self.assertTrue(expected_maturity_case_ids.issubset(case_ids))
        self.assertTrue(
            {
                "curriculum-title-general-chinese-culture",
                "curriculum-title-general-information-literacy",
                "curriculum-title-information-computing",
                "curriculum-title-public-management",
            }.issubset(release_case_ids)
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
