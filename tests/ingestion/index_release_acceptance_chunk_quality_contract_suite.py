from __future__ import annotations

from dataclasses import replace

from campus_ingestion_core.index_release_acceptance import (
    evaluate_release_chunk_quality,
)

from tests.ingestion.index_release_acceptance_test_support import (
    _make_chunk,
    _make_record,
)


class IndexReleaseAcceptanceChunkQualityContractSuite:
    def test_release_chunk_quality_reports_answer_ready_contract_failure_class(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-rank",
                        "parent_unit_id": "student_rules:handbook:article-rank",
                        "display_text": "学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
                        "final_token_count": 32,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertEqual(report.summary["answer_ready_contract_status"], "failed")
        self.assertEqual(
            report.summary["answer_ready_contract_version"],
            "answer_ready_evidence.v3",
        )
        self.assertEqual(report.summary["fallback_budget_status"], "not_applicable")
        self.assertIn("chunk_contract_missing", report.summary["failure_classes"])
        self.assertIn(
            "answer_ready_condition_subject_missing",
            report.summary["answer_ready_required_field_failures"],
        )
        self.assertEqual(report.summary["answer_ready_semantic_failures"], [])
        self.assertIn(
            "answer_ready_condition_subject_missing",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-0001"],
        )

    def test_release_chunk_quality_reports_static_polarity_role_conflicts(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-discipline",
                        "parent_unit_id": "student_rules:handbook:article-discipline",
                        "clause_unit_id": "student_rules:handbook:article-discipline:2",
                        "display_text": "有下列情形之一的，不予解除处分。",
                        "final_token_count": 32,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "exclusion_rule",
                        "content_role": "eligibility",
                        "claim_type": "cannot_do",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "discipline_relief_exclusion",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": (
                            "student_rules:handbook:article-discipline:discipline_relief_exclusion"
                        ),
                        "condition_polarity": "positive",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_polarity_role_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_intro_answer_bearing_conflict(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-scholarship",
                        "parent_unit_id": "student_rules:handbook:article-scholarship",
                        "display_text": "参评学生还应符合下列条件之一：",
                        "final_token_count": 18,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_intro",
                        "content_role": "eligibility",
                        "claim_type": "condition_intro",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "generic_condition",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "answer_role:eligibility_intro",
                        "condition_group_id": (
                            "student_rules:handbook:article-scholarship:group-01:generic_condition"
                        ),
                        "intro_scope": "eligibility_group",
                        "introduced_condition_group_id": (
                            "student_rules:handbook:article-scholarship:group-01:generic_condition"
                        ),
                        "intro_target_roles": ["eligibility_condition", "exception_rule"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_intro_answer_bearing_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_intro_missing_explicit_non_answer_bearing_status(
        self,
    ) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-scholarship",
                        "parent_unit_id": "student_rules:handbook:article-scholarship",
                        "display_text": "参评学生还应符合下列条件之一：",
                        "final_token_count": 18,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_intro",
                        "content_role": "eligibility",
                        "claim_type": "condition_intro",
                        "role_confidence": "high",
                        "condition_subject": "generic_condition",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "answer_role:eligibility_intro",
                        "condition_group_id": (
                            "student_rules:handbook:article-scholarship:group-01:generic_condition"
                        ),
                        "intro_scope": "eligibility_group",
                        "introduced_condition_group_id": (
                            "student_rules:handbook:article-scholarship:group-01:generic_condition"
                        ),
                        "intro_target_roles": ["eligibility_condition", "exception_rule"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_intro_answer_bearing_missing",
            report.summary["answer_ready_required_field_failures"],
        )

    def test_release_chunk_quality_reports_condition_subject_role_conflicts(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-discipline",
                        "parent_unit_id": "student_rules:handbook:article-discipline",
                        "clause_unit_id": "student_rules:handbook:article-discipline:1",
                        "display_text": "受处分满考察期后，可以申请解除处分。",
                        "final_token_count": 24,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "discipline_relief_exclusion",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": (
                            "student_rules:handbook:article-discipline:discipline_relief_exclusion"
                        ),
                        "condition_polarity": "positive",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_subject_role_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_condition_group_subject_conflicts(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-rank",
                        "parent_unit_id": "student_rules:handbook:article-rank",
                        "clause_unit_id": "student_rules:handbook:article-rank:1",
                        "display_text": "学习成绩排名位于前10%。",
                        "final_token_count": 18,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "rank_threshold",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "keyword:排名综测",
                        "condition_group_id": (
                            "student_rules:handbook:article-rank:paper_or_publication"
                        ),
                        "condition_polarity": "positive",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_group_subject_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_unknown_condition_group_subjects(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-rank",
                        "parent_unit_id": "student_rules:handbook:article-rank",
                        "clause_unit_id": "student_rules:handbook:article-rank:1",
                        "display_text": "学习成绩排名位于前10%。",
                        "final_token_count": 18,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "example_evidence",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "rank_threshold",
                        "condition_group_subject": "one_off_chinese_cue",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": "student_rules:handbook:article-rank:one_off_chinese_cue",
                        "condition_polarity": "positive",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_group_subject_unknown",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_missing_condition_group_subject_for_procedure_step(
        self,
    ) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-procedure",
                        "parent_unit_id": "student_rules:handbook:article-procedure",
                        "clause_unit_id": "student_rules:handbook:article-procedure:1",
                        "display_text": "学生本人提交申请材料。",
                        "final_token_count": 10,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "procedure_step",
                        "content_role": "procedure",
                        "claim_type": "procedure",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "application_procedure",
                        "condition_group_id": (
                            "student_rules:handbook:article-procedure:application_procedure"
                        ),
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "answer_role:procedure_step",
                        "condition_polarity": "positive",
                        "procedure_step_index": 1,
                        "procedure_actor": "student",
                        "procedure_action": "submit_materials",
                        "procedure_action_taxonomy_version": "procedure_action.v1",
                        "procedure_action_provenance": "keyword:提交+材料",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_group_subject_missing",
            report.summary["answer_ready_required_field_failures"],
        )

    def test_release_chunk_quality_reports_condition_group_parent_conflicts(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-rank",
                        "parent_unit_id": "student_rules:handbook:article-rank",
                        "clause_unit_id": "student_rules:handbook:article-rank:1",
                        "display_text": "综合测评成绩排名应位于前10%。",
                        "final_token_count": 16,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "rank_threshold",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": "student_rules:handbook:article-other:rank_threshold",
                        "condition_polarity": "positive",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_group_parent_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_bridge_group_key_leaks(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-materials",
                        "parent_unit_id": "student_rules:handbook:article-materials",
                        "display_text": "申请材料如下：",
                        "final_token_count": 12,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_intro",
                        "content_role": "eligibility",
                        "claim_type": "condition_intro",
                        "role_confidence": "high",
                        "is_answer_bearing": False,
                        "condition_subject": "material_requirement",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:introduced_condition_subject",
                        "condition_group_id": (
                            "student_rules:handbook:article-materials:material_requirement"
                        ),
                        "condition_group_key": "material_requirement",
                        "intro_scope": "material_list",
                        "introduced_condition_group_id": (
                            "student_rules:handbook:article-materials:material_requirement"
                        ),
                        "introduced_condition_group_key": "material_requirement",
                        "intro_target_roles": ["material_requirement"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_group_key_leaked",
            report.summary["answer_ready_semantic_failures"],
        )
        self.assertIn(
            "answer_ready_introduced_condition_group_key_leaked",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_intro_condition_subject_conflicts(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "institutional_rules:rule:article-time",
                        "parent_unit_id": "institutional_rules:rule:article-time",
                        "display_text": "申诉期限如下：",
                        "final_token_count": 12,
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_intro",
                        "content_role": "eligibility",
                        "claim_type": "condition_intro",
                        "role_confidence": "high",
                        "is_answer_bearing": False,
                        "condition_subject": "material_requirement",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:introduced_condition_subject",
                        "condition_group_id": (
                            "institutional_rules:rule:article-time:material_requirement"
                        ),
                        "intro_scope": "time_list",
                        "introduced_condition_group_id": (
                            "institutional_rules:rule:article-time:deadline"
                        ),
                        "intro_target_roles": ["time_constraint"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_intro_condition_subject_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_intro_condition_group_id_conflicts(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "institutional_rules:rule:article-time",
                        "parent_unit_id": "institutional_rules:rule:article-time",
                        "display_text": "申诉期限如下：",
                        "final_token_count": 12,
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_intro",
                        "content_role": "eligibility",
                        "claim_type": "condition_intro",
                        "role_confidence": "high",
                        "is_answer_bearing": False,
                        "condition_subject": "deadline",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:introduced_condition_subject",
                        "condition_group_id": (
                            "institutional_rules:rule:article-time:group-01:deadline"
                        ),
                        "intro_scope": "time_list",
                        "introduced_condition_group_id": (
                            "institutional_rules:rule:article-time:group-02:deadline"
                        ),
                        "intro_target_roles": ["time_constraint"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_intro_condition_group_id_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_intro_group_parent_conflicts(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "institutional_rules:rule:article-time",
                        "parent_unit_id": "institutional_rules:rule:article-time",
                        "display_text": "申诉期限如下：",
                        "final_token_count": 12,
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_intro",
                        "content_role": "eligibility",
                        "claim_type": "condition_intro",
                        "role_confidence": "high",
                        "is_answer_bearing": False,
                        "condition_subject": "deadline",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:introduced_condition_subject",
                        "condition_group_id": "institutional_rules:rule:article-time:deadline",
                        "intro_scope": "time_list",
                        "introduced_condition_group_id": (
                            "institutional_rules:rule:article-other:deadline"
                        ),
                        "intro_target_roles": ["time_constraint"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_intro_group_parent_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_table_fact_missing_group_id(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "table_unit",
                        "root_unit_id": "student_rules:handbook:table-award",
                        "parent_unit_id": "student_rules:handbook:table-award",
                        "display_text": "一等奖 | 8000元",
                        "final_token_count": 12,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "table_fact",
                        "content_role": "table_fact",
                        "claim_type": "amount_or_quota",
                        "table_fact_type": "amount_or_quota",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "amount_or_quota",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "table_fact_type:amount_or_quota",
                        "condition_polarity": "positive",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_group_id_missing",
            report.summary["answer_ready_required_field_failures"],
        )
