from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.curriculum_budget_evaluation import (
    CurriculumBudgetCandidate,
    CurriculumBudgetProfileSpec,
    CurriculumBudgetEvaluationDocument,
    CurriculumBudgetProbeCase,
    build_default_curriculum_budget_candidates,
    evaluate_curriculum_budget_candidates,
    load_default_curriculum_budget_evaluation_documents,
    load_historical_curriculum_budget_evaluation_documents,
)
from campus_ingestion_core.models import DocumentRegistryRecord


def _make_curriculum_record(*, document_id: str, version_id: str, title: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=f"campusrag://rag-data/canonical/curriculum_plan/docs/{title}.md",
        content_hash=f"sha256:{document_id}",
        corpus="curriculum",
        collection="curriculum_plan",
        cleaning_policy_version="curriculum_plan_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-27T12:00:00+00:00",
        parser_version="raw-online-ocr-v1",
        embedding_model="",
        source_channel="pdf_ocr",
        is_current=True,
        document_units_object_key=f"curriculum/documents/{document_id}/document-units.jsonl",
        processed_object_keys=(f"curriculum/documents/{document_id}/document-units.jsonl",),
        import_source="raw_online_ocr",
    )


def _table_row(*, doc_id: str, version_id: str, row_id: str, row_type: str, text: str, **extra: object) -> str:
    payload = {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": row_id,
        "row_id": row_id,
        "row_type": row_type,
        "clean_text": text,
        "page_start": 1,
        "page_end": 1,
        "acl": {"level": "public", "allow_groups": []},
        **extra,
    }
    return json.dumps(payload, ensure_ascii=False)


class CurriculumBudgetEvaluationTest(unittest.TestCase):
    def test_build_default_curriculum_budget_candidates_includes_v2_split_table_profiles(self) -> None:
        candidates = build_default_curriculum_budget_candidates()

        by_name = {candidate.name: candidate for candidate in candidates}

        self.assertIn("baseline-uniform", by_name)
        self.assertIn("v2-table-balanced", by_name)
        self.assertIn("v2-table-relaxed", by_name)
        self.assertEqual(by_name["v2-table-balanced"].default_profile, by_name["baseline-uniform"].default_profile)
        self.assertEqual(
            by_name["v2-table-balanced"].table_profile,
            CurriculumBudgetProfileSpec(
                chunk_size=420,
                max_chunk_size=640,
                chunk_overlap=72,
                min_chunk_size=64,
            ),
        )
        self.assertEqual(
            by_name["v2-table-relaxed"].table_profile,
            CurriculumBudgetProfileSpec(
                chunk_size=480,
                max_chunk_size=720,
                chunk_overlap=96,
                min_chunk_size=64,
            ),
        )

    def test_evaluate_curriculum_budget_candidates_supports_split_table_budget_and_writes_reports(self) -> None:
        record = _make_curriculum_record(
            document_id="curriculum:test-budget-doc",
            version_id="sha256:test-budget-doc",
            title="测试培养方案",
        )
        structured_payload = "\n".join(
            [
                _table_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    row_id="page-0001-block-0001",
                    row_type="heading",
                    text="四、课程设置",
                    heading_level=2,
                ),
                _table_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    row_id="page-0001-block-0002",
                    row_type="heading",
                    text="（一）专业核心课程与进阶模块安排",
                    heading_level=3,
                ),
                _table_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    row_id="page-0001-block-0003",
                    row_type="table_caption",
                    text="表 1 专业核心课程安排",
                    owner_row_id="page-0001-block-0004",
                    relation_type="caption_of",
                    continuation_group_id="table-001",
                ),
                _table_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    row_id="page-0001-block-0004",
                    row_type="table",
                    text="<table></table>",
                    html="<table></table>",
                    continuation_group_id="table-001",
                    table_cells=[
                        {"row": 1, "col": 1, "text": "课程名称", "rowspan": 1, "colspan": 1, "is_header": True},
                        {"row": 1, "col": 2, "text": "学分", "rowspan": 1, "colspan": 1, "is_header": True},
                        {
                            "row": 2,
                            "col": 1,
                            "text": "国际经济学导论与政策分析",
                            "rowspan": 1,
                            "colspan": 1,
                            "is_header": False,
                        },
                        {"row": 2, "col": 2, "text": "3", "rowspan": 1, "colspan": 1, "is_header": False},
                        {
                            "row": 3,
                            "col": 1,
                            "text": "全球产业链专题研讨与案例分析",
                            "rowspan": 1,
                            "colspan": 1,
                            "is_header": False,
                        },
                        {"row": 3, "col": 2, "text": "3", "rowspan": 1, "colspan": 1, "is_header": False},
                        {
                            "row": 4,
                            "col": 1,
                            "text": "跨境贸易规则与实践工作坊",
                            "rowspan": 1,
                            "colspan": 1,
                            "is_header": False,
                        },
                        {"row": 4, "col": 2, "text": "2", "rowspan": 1, "colspan": 1, "is_header": False},
                    ],
                ),
            ]
        ).encode("utf-8")
        document = CurriculumBudgetEvaluationDocument(
            tier="runtime",
            label="synthetic-runtime",
            title="测试培养方案",
            record=record,
            structured_jsonl_bytes=structured_payload,
            probe_cases=(
                CurriculumBudgetProbeCase(
                    case_id="table-heading-retention",
                    query="四、课程设置里跨境贸易规则与实践工作坊的学分",
                    expected_keywords=("跨境贸易规则与实践工作坊", "2"),
                    required_headings=("四、课程设置", "（一）专业核心课程与进阶模块安排"),
                    preferred_unit_type="table_unit",
                ),
            ),
        )
        baseline = CurriculumBudgetCandidate(
            name="uniform-small",
            default_profile=CurriculumBudgetProfileSpec(
                chunk_size=18,
                max_chunk_size=22,
                chunk_overlap=4,
                min_chunk_size=8,
            ),
        )
        split = CurriculumBudgetCandidate(
            name="table-relaxed",
            default_profile=CurriculumBudgetProfileSpec(
                chunk_size=18,
                max_chunk_size=22,
                chunk_overlap=4,
                min_chunk_size=8,
            ),
            table_profile=CurriculumBudgetProfileSpec(
                chunk_size=48,
                max_chunk_size=60,
                chunk_overlap=8,
                min_chunk_size=12,
            ),
        )

        with TemporaryDirectory() as temp_dir:
            report = evaluate_curriculum_budget_candidates(
                output_dir=Path(temp_dir),
                candidates=(baseline, split),
                documents=(document,),
            )

            by_name = {candidate.name: candidate for candidate in report.candidates}
            self.assertEqual(set(by_name), {"uniform-small", "table-relaxed"})
            self.assertLessEqual(
                by_name["table-relaxed"].aggregate.total_chunks,
                by_name["uniform-small"].aggregate.total_chunks,
            )
            self.assertGreater(
                by_name["uniform-small"].aggregate.oversize_chunk_count,
                by_name["table-relaxed"].aggregate.oversize_chunk_count,
            )
            self.assertGreater(
                by_name["uniform-small"].aggregate.missing_top_parent_count,
                by_name["table-relaxed"].aggregate.missing_top_parent_count,
            )
            self.assertGreater(
                by_name["uniform-small"].aggregate.missing_any_structural_heading_count,
                by_name["table-relaxed"].aggregate.missing_any_structural_heading_count,
            )
            self.assertEqual(by_name["uniform-small"].aggregate.probe_summary.complete_hit_at_1_count, 0)
            self.assertEqual(by_name["table-relaxed"].aggregate.probe_summary.complete_hit_at_1_count, 1)
            self.assertEqual(by_name["uniform-small"].aggregate.document_count, 1)
            self.assertEqual(by_name["table-relaxed"].aggregate.document_count, 1)

            matrix_payload = json.loads((Path(temp_dir) / "budget-eval-matrix.json").read_text(encoding="utf-8"))
            self.assertEqual(len(matrix_payload["candidates"]), 2)
            self.assertEqual(matrix_payload["candidates"][0]["documents"][0]["title"], "测试培养方案")
            self.assertIn("probe_summary", matrix_payload["candidates"][0]["documents"][0])

            markdown = (Path(temp_dir) / "budget-eval-report.md").read_text(encoding="utf-8")
            self.assertIn("uniform-small", markdown)
            self.assertIn("table-relaxed", markdown)
            self.assertIn("Probe Summary", markdown)

    def test_load_default_curriculum_budget_evaluation_documents_defaults_to_runtime_inputs(self) -> None:
        documents = load_default_curriculum_budget_evaluation_documents()

        runtime_titles = {document.title for document in documents if document.tier == "runtime"}

        self.assertEqual(len(runtime_titles), 2)
        self.assertIn("国际经济与贸易本科人才培养方案", runtime_titles)
        self.assertIn("经济学拔尖人才创新班人才培养方案", runtime_titles)
        self.assertTrue(all(document.probe_cases for document in documents))
        self.assertTrue(all(document.tier == "runtime" for document in documents))

    def test_historical_curriculum_budget_documents_require_explicit_opt_in(self) -> None:
        documents = load_historical_curriculum_budget_evaluation_documents()
        historical_labels = {document.label for document in documents if document.tier == "historical"}

        self.assertEqual(
            historical_labels,
            {"narrative", "requirement-like", "table-heavy", "mixed", "title-boundary", "normalized-title"},
        )

    def test_baseline_candidate_clears_runtime_fixture_oversize_and_structure_failures(self) -> None:
        baseline = next(
            candidate
            for candidate in build_default_curriculum_budget_candidates()
            if candidate.name == "baseline-uniform"
        )
        runtime_documents = tuple(
            document
            for document in load_default_curriculum_budget_evaluation_documents()
            if document.tier == "runtime"
        )

        with TemporaryDirectory() as temp_dir:
            report = evaluate_curriculum_budget_candidates(
                output_dir=Path(temp_dir),
                candidates=(baseline,),
                documents=runtime_documents,
            )

        self.assertEqual(len(report.candidates), 1)
        by_title = {
            document.title: document
            for document in report.candidates[0].documents
        }
        self.assertEqual(
            set(by_title),
            {"国际经济与贸易本科人才培养方案", "经济学拔尖人才创新班人才培养方案"},
        )
        for document in by_title.values():
            self.assertEqual(document.oversize_chunk_count, 0, document.title)
            self.assertEqual(document.missing_top_parent_count, 0, document.title)
            self.assertEqual(document.missing_any_structural_heading_count, 0, document.title)

    def test_baseline_candidate_clears_probe_cases_across_default_documents(self) -> None:
        baseline = next(
            candidate
            for candidate in build_default_curriculum_budget_candidates()
            if candidate.name == "baseline-uniform"
        )

        with TemporaryDirectory() as temp_dir:
            report = evaluate_curriculum_budget_candidates(
                output_dir=Path(temp_dir),
                candidates=(baseline,),
                documents=load_default_curriculum_budget_evaluation_documents(include_historical=True),
            )

        self.assertEqual(len(report.candidates), 1)
        aggregate = report.candidates[0].aggregate.probe_summary
        self.assertEqual(aggregate.total_cases, 10)
        self.assertEqual(aggregate.complete_hit_at_1_count, 10)
        self.assertEqual(aggregate.complete_hit_at_3_count, 10)


if __name__ == "__main__":
    unittest.main()
