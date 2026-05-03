from __future__ import annotations

from tests.evals.retrieval_benchmark_test_support import (
    ANNOTATION_TEMPLATE_PATH,
    FIXTURE_PATH,
    HANDBOOK_MANIFEST_PATH,
    INSTITUTIONAL_RULES_GOLDEN_QRELS_FIXTURE_PATH,
    INSTITUTIONAL_RULES_QRELS_FIXTURE_PATH,
    INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH,
    KnowledgeScope,
    RetrievalQrelsDataset,
    campus_evals,
    json,
    load_retrieval_qrels_dataset,
    resolve_retrieval_fixture_manifest_path,
    unittest,
    validate_retrieval_qrels_fixture,
)


class BenchmarkModuleAndHandbookQrelsTest(unittest.TestCase):
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
            "RetrievalTuningCandidateReport",
            "RetrievalTuningReport",
            "build_retrieval_tuning_report",
            "render_retrieval_tuning_report_text",
        ):
            self.assertTrue(hasattr(benchmark_module, name), name)


class RetrievalHandbookQrelsFixtureTest(unittest.TestCase):
    def test_load_retrieval_qrels_dataset_reads_phase1_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="regulations", collection="student_rules")
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
        self.assertEqual(template["collection"], "student_rules")
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
            self.skipTest("student_rules manifest now carries restricted source truth")

        overridden_case_ids = {
            case.case_id
            for case in dataset.cases
            if case.request_overrides.get("entitlement_groups")
            or case.request_overrides.get("visibility_scope")
        }

        self.assertEqual(overridden_case_ids, set())


class RetrievalInstitutionalRulesQrelsFixtureTest(unittest.TestCase):
    RELEASE_30_REPORT_PATH = (
        INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH.parents[4]
        / ".planning"
        / "workstreams"
        / "regulation-rag-release-lane"
        / "evidence"
        / "phase-09-institutional-30-release"
        / "release-admission.report.json"
    )
    RELEASE_30_READER_MANIFEST_PATH = RELEASE_30_REPORT_PATH.parent / (
        "institutional-reader-manifest.json"
    )

    def test_load_institutional_rules_retrieval_qrels_dataset_reads_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(INSTITUTIONAL_RULES_QRELS_FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(
            dataset.scope, KnowledgeScope(corpus="regulations", collection="institutional_rules")
        )
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertGreaterEqual(len(dataset.cases), 32)

    def test_institutional_rules_qrels_cover_all_released_institutional_titles(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(INSTITUTIONAL_RULES_QRELS_FIXTURE_PATH)
        release_docs = self._load_release_30_documents()
        title_cases = {
            case.query: case
            for case in dataset.cases
            if case.expected_sources
            and case.case_id.startswith("institutional-title-exact-")
        }

        self.assertEqual(len(release_docs), 30)
        self.assertEqual(set(title_cases), {item["title"] for item in release_docs})
        for item in release_docs:
            case = title_cases[item["title"]]
            self.assertEqual(case.split, "release_gate")
            self.assertEqual(
                case.request_overrides,
                {
                    "entitlement_groups": ["campus_members"],
                    "visibility_scope": "campus",
                    "visibility_level": "restricted",
                },
            )
            self.assertEqual(len(case.expected_sources), 1)
            expected = case.expected_sources[0]
            self.assertEqual(expected.doc_id, item["document_id"])
            self.assertEqual(expected.version_id, item["version_id"])
            self.assertIsNone(expected.chunk_id)

    def test_institutional_rules_eval_manifest_covers_release_30_current_versions(
        self,
    ) -> None:
        manifest = json.loads(INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH.read_text())
        release_docs = self._load_release_30_documents()
        manifest_by_doc_id = {item["document_id"]: item for item in manifest["documents"]}

        self.assertEqual(set(manifest_by_doc_id), {item["document_id"] for item in release_docs})
        for item in release_docs:
            manifest_item = manifest_by_doc_id[item["document_id"]]
            self.assertEqual(manifest_item["version_id"], item["version_id"])
            self.assertEqual(manifest_item["title"], item["title"])
            self.assertEqual(manifest_item["entitlement_groups"], ["campus_members"])
            self.assertEqual(manifest_item["visibility_scope"], "campus")
            self.assertEqual(manifest_item["visibility_level"], "restricted")

    def test_institutional_rules_qrels_cover_authz_version_and_no_hit(self) -> None:
        dataset = load_retrieval_qrels_dataset(INSTITUTIONAL_RULES_QRELS_FIXTURE_PATH)
        cases = {case.case_id: case for case in dataset.cases}
        title_cases = [
            case
            for case in dataset.cases
            if case.case_id.startswith("institutional-title-exact-")
        ]

        self.assertEqual(len(title_cases), 30)
        self.assertTrue(
            all(
                source.version_id is not None
                for case in title_cases
                for source in case.expected_sources
            )
        )
        self.assertIn("institutional-graduate-employment-reward-effective-scope", cases)
        self.assertIn("institutional-student-association-management-authz-deny", cases)
        self.assertIn("no-hit-impossible-institutional-rule", cases)
        self.assertEqual(
            cases["institutional-graduate-employment-reward-effective-scope"].request_overrides[
                "entitlement_groups"
            ],
            ["campus_members"],
        )
        self.assertFalse(
            cases["institutional-student-association-management-authz-deny"].expected_sources
        )
        self.assertTrue(
            cases["institutional-student-association-management-authz-deny"].forbidden_sources
        )

    def test_institutional_rules_qrels_expected_doc_ids_align_with_eval_manifest(self) -> None:
        dataset = load_retrieval_qrels_dataset(INSTITUTIONAL_RULES_QRELS_FIXTURE_PATH)
        manifest = json.loads(INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH.read_text())
        manifest_doc_ids = {item["document_id"] for item in manifest["documents"]}
        referenced_doc_ids = {
            source.doc_id
            for case in dataset.cases
            for source in (*case.expected_sources, *case.forbidden_sources)
        }

        self.assertTrue(referenced_doc_ids)
        self.assertTrue(referenced_doc_ids.issubset(manifest_doc_ids))

    def test_validate_institutional_rules_qrels_fixture_against_eval_manifest_has_no_issues(
        self,
    ) -> None:
        self.assertEqual(
            validate_retrieval_qrels_fixture(
                INSTITUTIONAL_RULES_QRELS_FIXTURE_PATH,
                manifest_path=INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH,
                ambiguity_severity="error",
            ),
            (),
        )

    def test_resolve_retrieval_fixture_manifest_path_supports_eval_manifest_fallback(
        self,
    ) -> None:
        self.assertEqual(
            resolve_retrieval_fixture_manifest_path(INSTITUTIONAL_RULES_QRELS_FIXTURE_PATH),
            INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH,
        )

    def test_institutional_rules_golden_qrels_cover_released_docs_with_consumption_queries(
        self,
    ) -> None:
        dataset = load_retrieval_qrels_dataset(INSTITUTIONAL_RULES_GOLDEN_QRELS_FIXTURE_PATH)
        release_docs = self._load_release_30_documents()
        release_doc_ids = {item["document_id"] for item in release_docs}
        cases_by_doc_id: dict[str, list[str]] = {doc_id: [] for doc_id in release_doc_ids}

        self.assertEqual(
            dataset.scope,
            KnowledgeScope(corpus="regulations", collection="institutional_rules"),
        )
        self.assertGreaterEqual(len(dataset.cases), 64)
        self.assertEqual(
            set(dataset.baseline["source_fixture"]),
            {"institutional_rules_retrieval_qrels.json"},
        )
        self.assertTrue(
            all(
                case.split == "regression_locked"
                for case in dataset.cases
                if case.expected_sources
            )
        )

        title_by_doc_id = {item["document_id"]: item["title"] for item in release_docs}
        for case in dataset.cases:
            self.assertNotEqual(case.split, "release_gate")
            self.assertEqual(
                case.request_overrides,
                {
                    "entitlement_groups": ["campus_members"],
                    "visibility_scope": "campus",
                    "visibility_level": "restricted",
                },
            )
            if not case.expected_sources:
                continue
            self.assertEqual(len(case.expected_sources), 1)
            expected = case.expected_sources[0]
            self.assertIn(expected.doc_id, release_doc_ids)
            self.assertIsNotNone(expected.version_id)
            self.assertNotEqual(case.query, title_by_doc_id[expected.doc_id])
            cases_by_doc_id[expected.doc_id].append(case.case_id)

        missing = sorted(doc_id for doc_id, case_ids in cases_by_doc_id.items() if len(case_ids) < 2)
        self.assertEqual(missing, [])

    def test_institutional_rules_golden_qrels_validate_against_eval_manifest(
        self,
    ) -> None:
        self.assertEqual(
            validate_retrieval_qrels_fixture(
                INSTITUTIONAL_RULES_GOLDEN_QRELS_FIXTURE_PATH,
                manifest_path=INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH,
                ambiguity_severity="error",
            ),
            (),
        )

    def _load_release_30_documents(self) -> list[dict[str, str]]:
        release_payload = json.loads(self.RELEASE_30_REPORT_PATH.read_text(encoding="utf-8"))
        reader_payload = json.loads(
            self.RELEASE_30_READER_MANIFEST_PATH.read_text(encoding="utf-8")
        )
        reader_titles = {
            str(item.get("document_id") or item.get("docId")): item["title"]
            for item in reader_payload["documents"]
        }
        return [
            {
                "document_id": item["document_id"],
                "version_id": item["version_id"],
                "title": reader_titles[item["document_id"]],
            }
            for item in release_payload["admission_manifest"]["documents"]
        ]
