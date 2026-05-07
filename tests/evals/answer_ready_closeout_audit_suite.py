from __future__ import annotations

import unittest

from campus_evals.answer_ready_closeout_audit import (
    AnswerReadyCloseoutCase,
    audit_answer_ready_closeout,
)
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl

from tests.ingestion._handbook_chunking_test_support import build_hermetic_handbook_v3_chunk_profile
from tests.ingestion.test_handbook_chunking_pipeline import (
    _registry_record_for_document,
    _structured_row,
)


class AnswerReadyCloseoutAuditTest(unittest.TestCase):
    def test_closeout_audit_proves_student_rules_contract_through_ranking_and_selection(
        self,
    ) -> None:
        chunks = build_indexable_chunks_from_jsonl(
            record=_registry_record_for_document("handbook:test-phase6-closeout"),
            structured_jsonl_bytes=_student_rules_closeout_structured_jsonl(),
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )
        overview_chunks = tuple(
            chunk
            for chunk in build_indexable_chunks_from_jsonl(
                record=_registry_record_for_document(
                    "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"
                ),
                structured_jsonl_bytes=_scholarship_overview_structured_jsonl(),
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )
            if chunk.metadata.get("answer_role") == "category_overview"
        )

        report = audit_answer_ready_closeout(
            chunks=(*overview_chunks, *chunks),
            cases=(
                AnswerReadyCloseoutCase(
                    case_id="discipline-relief-procedure",
                    query="处分怎么消",
                    expected_top_answer_role="procedure_step",
                    expected_selected_answer_role="procedure_step",
                    expected_condition_subject="application_procedure",
                ),
                AnswerReadyCloseoutCase(
                    case_id="discipline-relief-exclusion",
                    query="哪些情况不能解除处分",
                    expected_top_answer_role="exclusion_rule",
                    expected_selected_answer_role="exclusion_rule",
                    expected_condition_subject="discipline_relief_exclusion",
                ),
                AnswerReadyCloseoutCase(
                    case_id="national-scholarship-rank",
                    query="成绩没前十还能评国奖吗",
                    expected_top_answer_role="exception_rule",
                    expected_selected_answer_role="exception_rule",
                    expected_condition_subject="rank_threshold",
                ),
                AnswerReadyCloseoutCase(
                    case_id="national-scholarship-paper",
                    query="论文能不能算国奖条件",
                    expected_top_answer_role="example_evidence",
                    expected_selected_answer_role="example_evidence",
                    expected_condition_subject="paper_or_publication",
                ),
                AnswerReadyCloseoutCase(
                    case_id="scholarship-category-discovery",
                    query="本科生有哪些奖学金能申请",
                    expected_top_answer_role="category_overview",
                    expected_selected_answer_role="category_overview",
                    expected_condition_subject="audience_scope",
                ),
            ),
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.chunk_quality_status, "passed")
        self.assertEqual(report.primary_text_cue_fallback_count, 0)
        self.assertEqual(report.failed_case_count, 0)
        self.assertIn("procedure_step", report.answer_role_counts)
        self.assertIn("exclusion_rule", report.answer_role_counts)
        self.assertIn("exception_rule", report.answer_role_counts)
        self.assertIn("example_evidence", report.answer_role_counts)
        self.assertIn("category_overview", report.answer_role_counts)


def _student_rules_closeout_structured_jsonl() -> bytes:
    record = _registry_record_for_document("handbook:test-phase6-closeout")
    rows = [
        _structured_row(
            doc_id=record.document_id,
            version_id=record.version_id,
            unit_type="article_body",
            root_unit_id="article-discipline-relief-procedure",
            clean_text="1. 学生本人提交解除处分申请材料。",
            anchor={
                "section_path": ["中央民族大学解除学生纪律处分实施办法", "解除程序"],
                "article_label": "第三条",
                "page_start": 1,
                "page_end": 1,
            },
            metadata={"title": "中央民族大学解除学生纪律处分实施办法"},
        ),
        _structured_row(
            doc_id=record.document_id,
            version_id=record.version_id,
            unit_type="article_body",
            root_unit_id="article-discipline-relief-exclusion",
            clean_text="有下列情形之一的，不予解除处分。",
            anchor={
                "section_path": ["中央民族大学解除学生纪律处分实施办法", "不予解除处分情形"],
                "article_label": "第六条",
                "page_start": 1,
                "page_end": 1,
            },
            metadata={"title": "中央民族大学解除学生纪律处分实施办法"},
        ),
        _structured_row(
            doc_id=record.document_id,
            version_id=record.version_id,
            unit_type="article_body",
            root_unit_id="article-national-scholarship-rank",
            clean_text=(
                "（二）学习成绩排名或综合测评排名超出前10%,但均位于前30%,"
                "且单科成绩不低于80分,平均成绩不低于85分。"
            ),
            anchor={
                "section_path": ["中央民族大学本科学生国家奖学金评审办法", "评审条件"],
                "article_label": "第九条",
                "page_start": 1,
                "page_end": 1,
            },
            metadata={"title": "中央民族大学本科学生国家奖学金评审办法"},
        ),
        _structured_row(
            doc_id=record.document_id,
            version_id=record.version_id,
            unit_type="article_body",
            root_unit_id="article-national-scholarship-paper",
            clean_text="2. 在学术研究上取得显著成绩,以第一作者发表高水平学术论文。",
            anchor={
                "section_path": ["中央民族大学本科学生国家奖学金评审办法", "评审条件"],
                "article_label": "第九条",
                "page_start": 1,
                "page_end": 1,
            },
            metadata={"title": "中央民族大学本科学生国家奖学金评审办法"},
        ),
    ]
    return (
        "\n".join(__import__("json").dumps(row, ensure_ascii=False) for row in rows) + "\n"
    ).encode("utf-8")


def _scholarship_overview_structured_jsonl() -> bytes:
    record = _registry_record_for_document("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15")
    row = _structured_row(
        doc_id=record.document_id,
        version_id=record.version_id,
        unit_type="article_body",
        root_unit_id="article-scholarship-overview-anchor",
        clean_text="第一条 国家奖学金每学年评审一次。",
        metadata={"title": "中央民族大学本科学生国家奖学金评审办法"},
    )
    return (__import__("json").dumps(row, ensure_ascii=False) + "\n").encode("utf-8")


if __name__ == "__main__":
    unittest.main()
