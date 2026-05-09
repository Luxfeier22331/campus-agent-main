from __future__ import annotations

from dataclasses import replace

from campus_ingestion_core.index_release_acceptance import (
    evaluate_release_chunk_quality,
)

from tests.ingestion.index_release_acceptance_test_support import (
    _make_chunk,
    _make_record,
)


class IndexReleaseAcceptanceChunkQualitySemanticsSuite:
    def test_release_chunk_quality_reports_procedure_action_role_conflicts(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-eligibility",
                        "parent_unit_id": "student_rules:handbook:article-eligibility",
                        "clause_unit_id": "student_rules:handbook:article-eligibility:1",
                        "display_text": "申请人应当符合基本条件。",
                        "final_token_count": 18,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "generic_condition",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": (
                            "student_rules:handbook:article-eligibility:generic_condition"
                        ),
                        "condition_polarity": "positive",
                        "procedure_action": "submit_materials",
                        "procedure_action_taxonomy_version": "procedure_action.v1",
                        "procedure_action_provenance": "metadata:procedure_action",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_procedure_action_role_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_missing_condition_polarity(self) -> None:
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
                        "display_text": "学生提交申请材料。",
                        "final_token_count": 12,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "procedure_step",
                        "content_role": "procedure",
                        "claim_type": "procedure_step",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "application_procedure",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "answer_role:procedure_step",
                        "condition_group_id": (
                            "student_rules:handbook:article-procedure:application_procedure"
                        ),
                        "procedure_step_index": 1,
                        "procedure_actor": "student",
                        "procedure_action": "submit_materials",
                        "procedure_action_taxonomy_version": "procedure_action.v1",
                        "procedure_action_provenance": "metadata:procedure_action",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_polarity_missing",
            report.summary["answer_ready_required_field_failures"],
        )

    def test_release_chunk_quality_reports_unknown_procedure_actor(self) -> None:
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
                        "display_text": "申请人提交材料后进入审核。",
                        "final_token_count": 18,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "procedure_step",
                        "content_role": "procedure",
                        "claim_type": "procedure_step",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "application_procedure",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "answer_role:procedure_step",
                        "condition_group_id": (
                            "student_rules:handbook:article-procedure:application_procedure"
                        ),
                        "condition_polarity": "positive",
                        "procedure_step_index": 1,
                        "procedure_actor": "one_off_actor",
                        "procedure_action": "submit_materials",
                        "procedure_action_taxonomy_version": "procedure_action.v1",
                        "procedure_action_provenance": "metadata:procedure_action",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_procedure_actor_unknown",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_unknown_procedure_next_actor(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-procedure",
                        "parent_unit_id": "student_rules:handbook:article-procedure",
                        "clause_unit_id": "student_rules:handbook:article-procedure:2",
                        "display_text": "学生提交后由学院审核。",
                        "final_token_count": 18,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "procedure_step",
                        "content_role": "procedure",
                        "claim_type": "procedure_step",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "application_procedure",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "answer_role:procedure_step",
                        "condition_group_id": (
                            "student_rules:handbook:article-procedure:application_procedure"
                        ),
                        "condition_polarity": "positive",
                        "procedure_step_index": 2,
                        "procedure_actor": "student",
                        "procedure_action": "submit_materials",
                        "procedure_action_taxonomy_version": "procedure_action.v1",
                        "procedure_action_provenance": "metadata:procedure_action",
                        "procedure_next_actor": "unknown_followup_actor",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_procedure_next_actor_unknown",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_generic_fallback_procedure_actor(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-procedure",
                        "parent_unit_id": "student_rules:handbook:article-procedure",
                        "clause_unit_id": "student_rules:handbook:article-procedure:3",
                        "display_text": "由责任主体受理申请。",
                        "final_token_count": 12,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "procedure_step",
                        "content_role": "procedure",
                        "claim_type": "procedure_step",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "application_procedure",
                        "condition_group_subject": "application_procedure",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "answer_role:procedure_step",
                        "condition_group_id": (
                            "student_rules:handbook:article-procedure:application_procedure"
                        ),
                        "condition_polarity": "positive",
                        "procedure_step_index": 3,
                        "procedure_actor": "responsible_party",
                        "procedure_action": "process",
                        "procedure_action_taxonomy_version": "procedure_action.v1",
                        "procedure_action_provenance": "keyword:处理",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_procedure_actor_generic_fallback",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_generic_fallback_procedure_action(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "article_body",
                        "root_unit_id": "student_rules:handbook:article-procedure",
                        "parent_unit_id": "student_rules:handbook:article-procedure",
                        "clause_unit_id": "student_rules:handbook:article-procedure:4",
                        "display_text": "申请人按规定办理。",
                        "final_token_count": 12,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "procedure_step",
                        "content_role": "procedure",
                        "claim_type": "procedure_step",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "application_procedure",
                        "condition_group_subject": "application_procedure",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "answer_role:procedure_step",
                        "condition_group_id": (
                            "student_rules:handbook:article-procedure:application_procedure"
                        ),
                        "condition_polarity": "positive",
                        "procedure_step_index": 4,
                        "procedure_actor": "student",
                        "procedure_action": "procedure_step",
                        "procedure_action_taxonomy_version": "procedure_action.v1",
                        "procedure_action_provenance": "resolved:procedure_step",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_procedure_action_generic_fallback",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_condition_subject_taxonomy_version_unknown(
        self,
    ) -> None:
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
                        "condition_subject_taxonomy_version": "condition_subject.experimental",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": "student_rules:handbook:article-rank:rank_threshold",
                        "condition_polarity": "positive",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_subject_taxonomy_version_unknown",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_unknown_intro_target_roles(self) -> None:
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
                        "is_answer_bearing": False,
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
                        "intro_target_roles": ["one_off_chinese_cue"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_intro_target_roles_unknown",
            report.summary["answer_ready_semantic_failures"],
        )
