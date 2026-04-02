from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import campus_evals
from campus_contracts import EvidenceSource, KnowledgeScope
from campus_evals import (
    RetrievalBenchmarkRun,
    RetrievalCaseMetrics,
    RetrievalMetricSummary,
    RetrievalObservedSource,
    RetrievalQrelsCase,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    evaluate_retrieval_case,
    evaluate_retrieval_run,
    load_retrieval_benchmark_run,
    load_retrieval_qrels_dataset,
    render_retrieval_summary_text,
    summarize_retrieval_metrics,
    validate_retrieval_qrels_fixture,
)
from campus_evals.retrieval_benchmark import main as benchmark_main


FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "student_handbook_retrieval_qrels.json"
)
HYBRID_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "student_handbook_hybrid_queries.json"
)
CURRICULUM_QRELS_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "curriculum_plan_retrieval_qrels.json"
)
CURRICULUM_HYBRID_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "curriculum_plan_hybrid_queries.json"
)
CURRICULUM_ANNOTATION_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "curriculum_plan_retrieval_annotation_template.json"
)
ANNOTATION_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "student_handbook_retrieval_annotation_template.json"
)
HANDBOOK_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "regulations"
    / "student_handbook"
    / "split-manifest.v1.json"
)
CURRICULUM_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2]
    / "configs"
    / "ingestion"
    / "curriculum"
    / "curriculum_plan"
    / "split-manifest.v1.json"
)


def _source(
    *,
    doc_id: str,
    version_id: str = "v1",
    chunk_id: str = "chunk-1",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page": 1},
        acl_level="public",
        canonical_url=f"https://example.edu/{doc_id}",
        latest_url=f"https://example.edu/{doc_id}",
        source_channel="pdf_ocr",
        collection="student_handbook",
        is_current=False,
        snippet=f"Snippet for {doc_id}",
        score=0.91,
    )


class RetrievalQrelsFixtureTest(unittest.TestCase):
    def test_load_retrieval_qrels_dataset_reads_phase1_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(dataset.scope, KnowledgeScope(corpus="regulations", collection="student_handbook"))
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
        article_case = next(case for case in dataset.cases if case.case_id == "article-number-degree-procedure")
        fixed_phrase_case = next(case for case in dataset.cases if case.case_id == "fixed-phrase-medical-reimbursement")
        policy_alias_case = next(
            case
            for case in dataset.cases
            if case.case_id == "policy-alias-national-scholarship-author-affiliation"
        )
        self.assertTrue(all(source.chunk_id is None for source in article_case.expected_sources))
        self.assertTrue(all(source.chunk_id is None for source in fixed_phrase_case.expected_sources))
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

    def test_qrels_fixture_does_not_require_acl_or_campus_cases_without_source_truth(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)
        manifest = json.loads(HANDBOOK_MANIFEST_PATH.read_text(encoding="utf-8"))
        manifest_has_acl = any(item.get("acl_groups") for item in manifest["documents"])
        manifest_has_campus_scope = any(item.get("campus_scope") for item in manifest["documents"])

        if manifest_has_acl or manifest_has_campus_scope:
            self.skipTest("student_handbook manifest now carries ACL or campus-scoped source truth")

        overridden_case_ids = {
            case.case_id
            for case in dataset.cases
            if case.request_overrides.get("acl_groups") or case.request_overrides.get("campus_scope")
        }

        self.assertEqual(overridden_case_ids, set())

    def test_load_curriculum_retrieval_qrels_dataset_reads_curriculum_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(dataset.scope, KnowledgeScope(corpus="curriculum", collection="curriculum_plan"))
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

        self.assertTrue(all(case.scope == KnowledgeScope(corpus="curriculum", collection="curriculum_plan") for case in dataset.cases))
        self.assertTrue(all(case.request_overrides == {} for case in dataset.cases))

    def test_curriculum_qrels_fixture_contains_disambiguation_and_paraphrase_cases(self) -> None:
        dataset = load_retrieval_qrels_dataset(CURRICULUM_QRELS_FIXTURE_PATH)

        case_ids = {case.case_id for case in dataset.cases}
        self.assertTrue(
            {
                "minority-language-strong-base-title",
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
                "fiscal-course-map-table",
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
                    "fiscal-course-map-table",
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
                "fiscal-course-map-table",
                "law-ethnic-class-fourth-semester-courses",
            }.issubset(case_ids)
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


class StudentHandbookHybridFixtureTest(unittest.TestCase):
    def test_load_hybrid_fixture_reads_phase1_baseline(self) -> None:
        self.assertTrue(hasattr(campus_evals, "load_retrieval_hybrid_query_dataset"))
        self.assertTrue(hasattr(campus_evals, "RetrievalHybridQueryDataset"))

        load_fixture = getattr(campus_evals, "load_retrieval_hybrid_query_dataset")
        dataset_type = getattr(campus_evals, "RetrievalHybridQueryDataset")

        dataset = load_fixture(HYBRID_FIXTURE_PATH)

        self.assertIsInstance(dataset, dataset_type)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(dataset.scope, KnowledgeScope(corpus="regulations", collection="student_handbook"))
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertEqual(len(dataset.cases), 7)

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

    def test_hybrid_fixture_does_not_require_acl_or_campus_scope_when_manifest_has_none(self) -> None:
        fixture = json.loads(HYBRID_FIXTURE_PATH.read_text(encoding="utf-8"))
        manifest = json.loads(HANDBOOK_MANIFEST_PATH.read_text(encoding="utf-8"))
        manifest_has_acl = any(item.get("acl_groups") for item in manifest["documents"])
        manifest_has_campus_scope = any(item.get("campus_scope") for item in manifest["documents"])

        if manifest_has_acl or manifest_has_campus_scope:
            self.skipTest("student_handbook manifest now carries ACL or campus-scoped source truth")

        scoped_case_ids = {
            case["case_id"]
            for case in fixture["cases"]
            if (case.get("scope") or {}).get("acl_groups") or (case.get("scope") or {}).get("campus_scope")
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
            cases_by_id["policy-alias-national-scholarship-author-affiliation"]["expected_keywords"],
            ["国家奖学金", "第一作者", "第二作者"],
        )

    def test_validate_hybrid_fixture_rejects_acl_campus_and_titleless_fixed_phrase_drift(self) -> None:
        self.assertTrue(hasattr(campus_evals, "validate_retrieval_hybrid_query_fixture"))
        validate_fixture = getattr(campus_evals, "validate_retrieval_hybrid_query_fixture")

        with TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "hybrid.json"
            manifest_path = Path(temp_dir) / "manifest.json"
            fixture_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "baseline": {"dense_model": "Qwen3-Embedding-4B"},
                        "cases": [
                            {
                                "case_id": "acl-case",
                                "category": "acl_filter",
                                "query": "办公室值班时间",
                                "scope": {"acl_groups": ["students"]},
                                "expected_keywords": [],
                            },
                            {
                                "case_id": "campus-case",
                                "category": "campus_scope_filter",
                                "query": "南沙校区 图书馆 开放",
                                "scope": {"campus_scope": "nansha"},
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
                            {"document_id": "handbook:1", "title": "中央民族大学关于学生宿舍照明的管理规定"},
                            {"document_id": "handbook:2", "title": "中央民族大学本科学生国家奖学金评审办法"},
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
                "case acl-case requires ACL scope, but the manifest has no ACL-bearing regulations/student_handbook documents",
                "case campus-case requires campus_scope, but the manifest has no campus-scoped regulations/student_handbook documents",
                "case fixed-case category fixed_phrase_sparse_win is not grounded in any current regulations/student_handbook title keyword",
            ),
        )

    def test_validate_hybrid_fixture_accepts_current_official_fixture(self) -> None:
        validate_fixture = getattr(campus_evals, "validate_retrieval_hybrid_query_fixture")
        errors = validate_fixture(HYBRID_FIXTURE_PATH, manifest_path=HANDBOOK_MANIFEST_PATH)

        self.assertEqual(errors, ())


class CurriculumHybridFixtureTest(unittest.TestCase):
    def test_load_curriculum_hybrid_fixture_reads_curriculum_baseline(self) -> None:
        load_fixture = getattr(campus_evals, "load_retrieval_hybrid_query_dataset")
        dataset_type = getattr(campus_evals, "RetrievalHybridQueryDataset")

        dataset = load_fixture(CURRICULUM_HYBRID_FIXTURE_PATH)

        self.assertIsInstance(dataset, dataset_type)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(dataset.scope, KnowledgeScope(corpus="curriculum", collection="curriculum_plan"))
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
                "course-map-table-hit",
                "law-ethnic-class-fourth-semester-courses",
                "cross-major-disambiguation",
                "generic-base-class-needs-clarification",
                "no-hit-impossible-query",
            }.issubset(case_ids)
        )
        self.assertTrue(
            {
                "policy_title_exact_match",
                "short_fact_section",
                "table_retrieval",
                "needs_clarification",
                "no_hit",
            }.issubset(categories)
        )

    def test_validate_curriculum_hybrid_fixture_accepts_current_fixture(self) -> None:
        validate_fixture = getattr(campus_evals, "validate_retrieval_hybrid_query_fixture")
        errors = validate_fixture(CURRICULUM_HYBRID_FIXTURE_PATH, manifest_path=CURRICULUM_MANIFEST_PATH)

        self.assertEqual(errors, ())


class RetrievalMetricsTest(unittest.TestCase):
    def test_evaluate_retrieval_case_supports_doc_level_matching(self) -> None:
        case = RetrievalQrelsCase(
            case_id="doc-level",
            split="smoke",
            query="library hours",
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            expected_sources=(
                RetrievalQrelsSourceRef(doc_id="handbook:library", grade=2, rationale="main document"),
            ),
        )

        metrics = evaluate_retrieval_case(
            case,
            (
                _source(doc_id="handbook:library", version_id="v7", chunk_id="chunk-42"),
                _source(doc_id="handbook:other", version_id="v1", chunk_id="chunk-2"),
            ),
        )

        self.assertEqual(metrics.hit_at_1, 1.0)
        self.assertEqual(metrics.hit_at_3, 1.0)
        self.assertEqual(metrics.recall_at_5, 1.0)
        self.assertEqual(metrics.precision_at_5, 0.5)
        self.assertEqual(metrics.mrr_at_5, 1.0)
        self.assertFalse(metrics.forbidden_hit)

    def test_evaluate_retrieval_case_supports_version_and_chunk_level_matching(self) -> None:
        case = RetrievalQrelsCase(
            case_id="chunk-level",
            split="regression_locked",
            query="图书馆开放时间",
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            expected_sources=(
                RetrievalQrelsSourceRef(
                    doc_id="handbook:library",
                    version_id="v2",
                    chunk_id="chunk-hours",
                    grade=2,
                    rationale="exact phrase chunk",
                ),
            ),
        )

        metrics = evaluate_retrieval_case(
            case,
            (
                _source(doc_id="handbook:library", version_id="v2", chunk_id="chunk-other"),
                _source(doc_id="handbook:library", version_id="v2", chunk_id="chunk-hours"),
            ),
        )

        self.assertEqual(metrics.hit_at_1, 0.0)
        self.assertEqual(metrics.hit_at_3, 1.0)
        self.assertEqual(metrics.recall_at_5, 1.0)
        self.assertEqual(metrics.precision_at_5, 0.5)
        self.assertEqual(metrics.mrr_at_5, 0.5)

    def test_evaluate_retrieval_case_flags_forbidden_hits(self) -> None:
        case = RetrievalQrelsCase(
            case_id="forbidden",
            split="smoke",
            query="办公室值班时间",
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            forbidden_sources=(
                RetrievalQrelsSourceRef(doc_id="handbook:restricted-office", grade=1, rationale="restricted"),
            ),
        )

        metrics = evaluate_retrieval_case(case, (_source(doc_id="handbook:restricted-office"),))

        self.assertEqual(metrics.hit_at_1, 0.0)
        self.assertEqual(metrics.recall_at_5, 0.0)
        self.assertEqual(metrics.precision_at_5, 0.0)
        self.assertEqual(metrics.mrr_at_5, 0.0)
        self.assertTrue(metrics.forbidden_hit)

    def test_evaluate_retrieval_case_treats_empty_expectation_as_no_hit_contract(self) -> None:
        case = RetrievalQrelsCase(
            case_id="no-hit",
            split="smoke",
            query="校内宇宙签证办理处",
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
        )

        empty_metrics = evaluate_retrieval_case(case, ())
        noisy_metrics = evaluate_retrieval_case(case, (_source(doc_id="handbook:loan"),))

        self.assertEqual(empty_metrics.hit_at_1, 1.0)
        self.assertEqual(empty_metrics.hit_at_3, 1.0)
        self.assertEqual(empty_metrics.recall_at_5, 1.0)
        self.assertEqual(empty_metrics.precision_at_5, 1.0)
        self.assertEqual(empty_metrics.mrr_at_5, 1.0)
        self.assertEqual(noisy_metrics.hit_at_1, 0.0)
        self.assertEqual(noisy_metrics.recall_at_5, 0.0)
        self.assertEqual(noisy_metrics.mrr_at_5, 0.0)

    def test_summarize_retrieval_metrics_aggregates_over_cases(self) -> None:
        metrics = (
            RetrievalCaseMetrics(
                case_id="case-1",
                split="smoke",
                hit_at_1=1.0,
                hit_at_3=1.0,
                recall_at_5=1.0,
                precision_at_5=0.5,
                mrr_at_5=1.0,
                forbidden_hit=False,
            ),
            RetrievalCaseMetrics(
                case_id="case-2",
                split="smoke",
                hit_at_1=0.0,
                hit_at_3=1.0,
                recall_at_5=0.5,
                precision_at_5=0.25,
                mrr_at_5=0.5,
                forbidden_hit=True,
            ),
        )

        summary = summarize_retrieval_metrics(metrics)

        self.assertIsInstance(summary, RetrievalMetricSummary)
        self.assertEqual(summary.total_cases, 2)
        self.assertAlmostEqual(summary.hit_at_1, 0.5)
        self.assertAlmostEqual(summary.hit_at_3, 1.0)
        self.assertAlmostEqual(summary.recall_at_5, 0.75)
        self.assertAlmostEqual(summary.precision_at_5, 0.375)
        self.assertAlmostEqual(summary.mrr_at_5, 0.75)
        self.assertAlmostEqual(summary.forbidden_hit_rate, 0.5)
        self.assertIn("smoke", summary.by_split)
        self.assertAlmostEqual(summary.by_split["smoke"].mrr_at_5, 0.75)

    def test_evaluate_retrieval_run_defaults_missing_cases_to_zero_metrics(self) -> None:
        dataset = RetrievalQrelsDataset(
            schema_version=1,
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            baseline={},
            cases=(
                RetrievalQrelsCase(
                    case_id="missing-case",
                    split="smoke",
                    query="library hours",
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
                    expected_sources=(RetrievalQrelsSourceRef(doc_id="handbook:library", grade=2),),
                ),
            ),
        )
        run = RetrievalBenchmarkRun(schema_version=1, cases=())

        metrics = evaluate_retrieval_run(dataset, run)

        self.assertEqual(len(metrics), 1)
        self.assertEqual(metrics[0].hit_at_1, 0.0)
        self.assertEqual(metrics[0].recall_at_5, 0.0)
        self.assertEqual(metrics[0].mrr_at_5, 0.0)


class RetrievalBenchmarkCliTest(unittest.TestCase):
    def test_load_retrieval_benchmark_run_reads_observed_sources(self) -> None:
        with TemporaryDirectory() as temp_dir:
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "cases": [
                            {
                                "case_id": "case-1",
                                "retrieved_sources": [
                                    {
                                        "doc_id": "handbook:library",
                                        "version_id": "v1",
                                        "chunk_id": "chunk-1",
                                        "score": 0.9
                                    }
                                ]
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            run = load_retrieval_benchmark_run(run_path)

        self.assertIsInstance(run, RetrievalBenchmarkRun)
        self.assertEqual(run.schema_version, 1)
        self.assertEqual(run.cases[0].retrieved_sources[0], RetrievalObservedSource("handbook:library", "v1", "chunk-1", 0.9))

    def test_render_retrieval_summary_text_prints_expected_metrics(self) -> None:
        text = render_retrieval_summary_text(
            RetrievalMetricSummary(
                total_cases=2,
                hit_at_1=0.5,
                hit_at_3=1.0,
                recall_at_5=0.75,
                precision_at_5=0.375,
                mrr_at_5=0.75,
                forbidden_hit_rate=0.5,
                by_split={},
            )
        )

        self.assertIn("Retrieval Benchmark Summary", text)
        self.assertIn("hit@1: 0.500", text)
        self.assertIn("mrr@5: 0.750", text)

    def test_benchmark_main_supports_text_and_json_output(self) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "case-1",
                                "split": "smoke",
                                "query": "library hours",
                                "expected_sources": [{"doc_id": "handbook:library", "grade": 2}]
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "cases": [
                            {
                                "case_id": "case-1",
                                "retrieved_sources": [{"doc_id": "handbook:library", "score": 0.9}]
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            text_buffer = io.StringIO()
            with redirect_stdout(text_buffer):
                exit_code = benchmark_main(["--qrels", str(qrels_path), "--results", str(run_path)])
            json_buffer = io.StringIO()
            with redirect_stdout(json_buffer):
                json_exit_code = benchmark_main(
                    ["--qrels", str(qrels_path), "--results", str(run_path), "--format", "json"]
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(json_exit_code, 0)
        self.assertIn("Retrieval Benchmark Summary", text_buffer.getvalue())
        self.assertEqual(json.loads(json_buffer.getvalue())["hit_at_1"], 1.0)

    def test_benchmark_main_fast_fails_when_qrels_fixture_has_unresolved_ambiguity(self) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "qrels.json"
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
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(
                json.dumps({"schema_version": 1, "cases": []}, ensure_ascii=False),
                encoding="utf-8",
            )

            stderr_buffer = io.StringIO()
            with redirect_stderr(stderr_buffer):
                exit_code = benchmark_main(["--qrels", str(qrels_path), "--results", str(run_path)])

        self.assertEqual(exit_code, 2)
        self.assertIn("ambiguously matches", stderr_buffer.getvalue())

    def test_benchmark_main_loads_repo_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "baseline": {},
                        "cases": [],
                    }
                ),
                encoding="utf-8",
            )
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(json.dumps({"schema_version": 1, "cases": []}), encoding="utf-8")
            manifest_path = Path(temp_dir) / "manifest.json"
            manifest_path.write_text(json.dumps({"schema_version": 1, "documents": []}), encoding="utf-8")

            stdout_buffer = io.StringIO()
            with (
                patch("campus_evals.retrieval_benchmark.load_repo_env") as load_repo_env,
                redirect_stdout(stdout_buffer),
            ):
                exit_code = benchmark_main(
                    [
                        "--qrels",
                        str(qrels_path),
                        "--results",
                        str(run_path),
                        "--manifest",
                        str(manifest_path),
                    ]
                )

        self.assertEqual(exit_code, 0)
        load_repo_env.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
