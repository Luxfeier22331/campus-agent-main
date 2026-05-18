from __future__ import annotations

from dataclasses import replace

from campus_ingestion_core.index_release_acceptance import evaluate_release_chunk_quality

from tests.ingestion.index_release_acceptance_support import _make_chunk, _make_record


class RegistryScopeReleaseAcceptanceQualitySuite:
    def test_evaluate_release_chunk_quality_rejects_incomplete_segment_coverage(self) -> None:
        record = _make_record()
        first = replace(
            _make_chunk(record=record),
            chunk_id="student_rules:handbook:chunk-segment-1",
            chunk_order=1,
            metadata={
                "unit_type": "section_text",
                "root_unit_id": "student_rules:handbook:root-segmented",
                "segment_index": 1,
                "segment_total": 3,
                "final_token_count": 32,
                "chunk_policy_version": "student_rules_semantic_v3",
            },
        )
        third = replace(
            _make_chunk(record=record),
            chunk_id="student_rules:handbook:chunk-segment-3",
            chunk_order=2,
            metadata={
                "unit_type": "section_text",
                "root_unit_id": "student_rules:handbook:root-segmented",
                "segment_index": 3,
                "segment_total": 3,
                "final_token_count": 32,
                "chunk_policy_version": "student_rules_semantic_v3",
            },
        )

        report = evaluate_release_chunk_quality(
            chunks=(first, third),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "segment_coverage_gap",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-segment-1"],
        )
        self.assertIn(
            "segment_coverage_gap",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-segment-3"],
        )

    def test_evaluate_release_chunk_quality_dedupes_member_lineage_for_same_chunk_segment(
        self,
    ) -> None:
        record = _make_record()
        first = replace(
            _make_chunk(record=record),
            chunk_id="student_rules:handbook:chunk-segment-1",
            chunk_order=1,
            metadata={
                "unit_type": "table_unit",
                "root_unit_id": "student_rules:handbook:root-segmented",
                "segment_index": 1,
                "segment_total": 2,
                "member_segment_lineage": [
                    {
                        "root_unit_id": "student_rules:handbook:parent-heading",
                        "segment_index": 1,
                        "segment_total": 1,
                    },
                    {
                        "root_unit_id": "student_rules:handbook:root-segmented",
                        "segment_index": 1,
                        "segment_total": 2,
                    },
                ],
                "table_headers": ["课程", "学分"],
                "final_token_count": 32,
                "chunk_policy_version": "student_rules_semantic_v3",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "student_rules:handbook:root-segmented",
                "answer_role": "table_fact",
                "content_role": "table_fact",
                "claim_type": "table_fact",
                "condition_subject": "amount_or_quota",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:condition_subject",
                "table_fact_type": "amount_or_quota",
                "condition_group_id": "student_rules:handbook:root-segmented:amount_or_quota",
                "condition_polarity": "positive",
                "role_confidence": "high",
                "is_answer_bearing": True,
            },
        )
        second = replace(
            _make_chunk(record=record),
            chunk_id="student_rules:handbook:chunk-segment-2",
            chunk_order=2,
            metadata={
                "unit_type": "table_unit",
                "root_unit_id": "student_rules:handbook:root-segmented",
                "segment_index": 2,
                "segment_total": 2,
                "table_headers": ["课程", "学分"],
                "final_token_count": 32,
                "chunk_policy_version": "student_rules_semantic_v3",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "student_rules:handbook:root-segmented",
                "answer_role": "table_fact",
                "content_role": "table_fact",
                "claim_type": "table_fact",
                "condition_subject": "amount_or_quota",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:condition_subject",
                "table_fact_type": "amount_or_quota",
                "condition_group_id": "student_rules:handbook:root-segmented:amount_or_quota",
                "condition_polarity": "positive",
                "role_confidence": "high",
                "is_answer_bearing": True,
            },
        )

        report = evaluate_release_chunk_quality(
            chunks=(first, second),
            max_token_count=512,
        )

        self.assertEqual(report.status, "passed")

    def test_evaluate_release_chunk_quality_rejects_table_chunks_without_context_or_header(
        self,
    ) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="student_rules:handbook:chunk-table",
                    text="本科生 | 按学期注册",
                    metadata={
                        "unit_type": "table_unit",
                        "root_unit_id": "student_rules:handbook:table-0001",
                        "table_group_id": "student_rules:handbook:table-0001",
                        "table_row_count": 1,
                        "table_row_lines": ["本科生 | 按学期注册"],
                        "final_token_count": 16,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "missing_table_context_or_header",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-table"],
        )
