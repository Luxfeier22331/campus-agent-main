from __future__ import annotations

import unittest
from pathlib import Path

RAG_AGENT_PACKAGE = Path("packages/rag-agent/src/campus_rag_agent")
RAG_SERVICE = RAG_AGENT_PACKAGE / "service.py"
RAG_SERVICE_COMMON = RAG_AGENT_PACKAGE / "service_common.py"
RAG_SERVICE_OUTCOMES = RAG_AGENT_PACKAGE / "service_outcomes.py"
RAG_SERVICE_PROMPTING = RAG_AGENT_PACKAGE / "service_prompting.py"
RAG_SERVICE_PROMPT_RUNTIME = RAG_AGENT_PACKAGE / "service_prompt_runtime.py"
RAG_SERVICE_CLARIFICATION = RAG_AGENT_PACKAGE / "service_clarification.py"
RAG_SERVICE_RETRIEVAL = RAG_AGENT_PACKAGE / "service_retrieval.py"
RAG_SERVICE_SYNTHESIS = RAG_AGENT_PACKAGE / "service_answer_synthesis.py"
RAG_SERVICE_DIAGNOSTICS = RAG_AGENT_PACKAGE / "service_diagnostics.py"
RAG_SERVICE_DIAGNOSTICS_ADEQUACY = RAG_AGENT_PACKAGE / "service_diagnostics_adequacy.py"
RAG_SERVICE_DIAGNOSTICS_CURRICULUM = RAG_AGENT_PACKAGE / "service_diagnostics_curriculum.py"
RAG_SERVICE_DIAGNOSTICS_PAYLOAD = RAG_AGENT_PACKAGE / "service_diagnostics_payload.py"
RAG_SERVICE_DIAGNOSTICS_RETRIEVAL = RAG_AGENT_PACKAGE / "service_diagnostics_retrieval.py"
RAG_SERVICE_VERSIONING = RAG_AGENT_PACKAGE / "service_versioning.py"
RAG_SERVICE_VERSIONING_CONTEXT = RAG_AGENT_PACKAGE / "service_versioning_context.py"
RAG_SERVICE_VERSIONING_EVIDENCE = RAG_AGENT_PACKAGE / "service_versioning_evidence.py"
RAG_SERVICE_VERSIONING_RESPONSE = RAG_AGENT_PACKAGE / "service_versioning_response.py"
RAG_SERVICE_SCOPE = RAG_AGENT_PACKAGE / "service_scope.py"
RAG_SERVICE_SCOPE_CURRICULUM = RAG_AGENT_PACKAGE / "service_scope_curriculum.py"
RAG_SERVICE_SCOPE_HANDBOOK = RAG_AGENT_PACKAGE / "service_scope_handbook.py"
RAG_SERVICE_SCOPE_PLANS = RAG_AGENT_PACKAGE / "service_scope_plans.py"
RAG_SERVICE_PIPELINE = RAG_AGENT_PACKAGE / "service_pipeline.py"
RAG_SERVICE_PREFLIGHT_RESPONSES = RAG_AGENT_PACKAGE / "service_preflight_responses.py"
RAG_AGENT_ANSWERING = RAG_AGENT_PACKAGE / "agent_answering.py"
RAG_AGENT_ANSWERING_GENERIC = RAG_AGENT_PACKAGE / "agent_answering_generic.py"
RAG_AGENT_ANSWERING_PROCEDURE = RAG_AGENT_PACKAGE / "agent_answering_procedure.py"
RAG_AGENT_ANSWERING_SUPPORT = RAG_AGENT_PACKAGE / "agent_answering_support.py"
RAG_AGENT_CURRICULUM = RAG_AGENT_PACKAGE / "agent_curriculum.py"
RAG_AGENT_ANSWER_SHAPE = RAG_AGENT_PACKAGE / "agent_answer_shape.py"
RAG_AGENT_CURRICULUM_ANSWERING = RAG_AGENT_PACKAGE / "agent_curriculum_answering.py"
RAG_AGENT_CURRICULUM_TABLES = RAG_AGENT_PACKAGE / "agent_curriculum_tables.py"
RAG_AGENT_CURRICULUM_TERMS = RAG_AGENT_PACKAGE / "agent_curriculum_terms.py"
RAG_AGENT_CURRICULUM_TITLES = RAG_AGENT_PACKAGE / "agent_curriculum_titles.py"
RAG_AGENT_SELECTION = RAG_AGENT_PACKAGE / "agent_selection.py"
RAG_AGENT_SELECTION_QUERY = RAG_AGENT_PACKAGE / "agent_selection_query.py"
RAG_AGENT_SELECTION_ROWS = RAG_AGENT_PACKAGE / "agent_selection_rows.py"
RAG_AGENT_SELECTION_STATEMENTS = RAG_AGENT_PACKAGE / "agent_selection_statements.py"
RAG_OFFICIAL_WEB = RAG_AGENT_PACKAGE / "agent_official_web.py"
RAG_OFFICIAL_WEB_ANSWERING = RAG_AGENT_PACKAGE / "agent_official_web_answering.py"
RAG_OFFICIAL_WEB_REFERENCE = RAG_AGENT_PACKAGE / "agent_official_web_reference.py"
RAG_OFFICIAL_WEB_REFERENCE_NEWS = RAG_AGENT_PACKAGE / "agent_official_web_reference_news.py"
RAG_OFFICIAL_WEB_REFERENCE_PEOPLE = RAG_AGENT_PACKAGE / "agent_official_web_reference_people.py"
RAG_OFFICIAL_WEB_REFERENCE_SCHOOL = RAG_AGENT_PACKAGE / "agent_official_web_reference_school.py"
RAG_OFFICIAL_WEB_REFERENCE_SENTENCES = (
    RAG_AGENT_PACKAGE / "agent_official_web_reference_sentences.py"
)
RAG_OFFICIAL_WEB_TERMS = RAG_AGENT_PACKAGE / "agent_official_web_terms.py"
RAG_GROUNDING_CLAIMS = RAG_AGENT_PACKAGE / "grounding_validation_claims.py"
RAG_GROUNDING_CLAIM_BASIC = RAG_AGENT_PACKAGE / "grounding_validation_claim_basic.py"
RAG_GROUNDING_CLAIM_MODELS = RAG_AGENT_PACKAGE / "grounding_validation_claim_models.py"
RAG_GROUNDING_CLAIM_NORMALIZATION = (
    RAG_AGENT_PACKAGE / "grounding_validation_claim_normalization.py"
)
RAG_GROUNDING_CLAIM_PATTERNS = RAG_AGENT_PACKAGE / "grounding_validation_claim_patterns.py"
RAG_GROUNDING_CLAIM_REQUIREMENTS = RAG_AGENT_PACKAGE / "grounding_validation_claim_requirements.py"
RAG_GROUNDING_CLAIM_SENSITIVE = RAG_AGENT_PACKAGE / "grounding_validation_claim_sensitive.py"
RAG_GROUNDING_VALIDATION = RAG_AGENT_PACKAGE / "grounding_validation.py"
RAG_GROUNDING_VALIDATION_RESULT = RAG_AGENT_PACKAGE / "grounding_validation_result.py"
RAG_GROUNDING_VALIDATION_SOURCE_TRUST = RAG_AGENT_PACKAGE / "grounding_validation_source_trust.py"
RAG_GROUNDING_VALIDATION_SUPPORT_POLICY = (
    RAG_AGENT_PACKAGE / "grounding_validation_support_policy.py"
)
RAG_GROUNDING_VALIDATION_TRUST_POLICY = RAG_AGENT_PACKAGE / "grounding_validation_trust_policy.py"
RAG_CURRICULUM_QUERY_PLANNING = RAG_AGENT_PACKAGE / "curriculum_query_planning.py"
RAG_CURRICULUM_QUERY_CONFIG = RAG_AGENT_PACKAGE / "curriculum_query_config.py"
RAG_CURRICULUM_QUERY_COURSES = RAG_AGENT_PACKAGE / "curriculum_query_courses.py"
RAG_CURRICULUM_QUERY_MODELS = RAG_AGENT_PACKAGE / "curriculum_query_models.py"
RAG_CURRICULUM_QUERY_PROGRAMS = RAG_AGENT_PACKAGE / "curriculum_query_programs.py"
RAG_CURRICULUM_QUERY_TEXT = RAG_AGENT_PACKAGE / "curriculum_query_text.py"


class RagAgentServiceStructureTest(unittest.TestCase):
    def test_delegate_service_keeps_retrieval_pipeline_in_dedicated_module(self) -> None:
        service_source = RAG_SERVICE.read_text(encoding="utf-8")

        self.assertTrue(RAG_SERVICE_RETRIEVAL.exists())
        self.assertTrue(RAG_SERVICE_PIPELINE.exists())
        self.assertNotIn("execute_retrieval_plan", service_source)
        self.assertNotIn("build_ordered_retrieval_plan", service_source)
        self.assertNotIn("load_runtime_profile", service_source)
        self.assertNotIn("interpret_curriculum_query", service_source)
        self.assertNotIn("build_document_registry_from_env", service_source)
        self.assertNotIn("resolve_version_query", service_source)
        self.assertNotIn("campus_ingestion_core", service_source)
        self.assertNotIn("campus_retrieval_core", service_source)

    def test_delegate_service_keeps_answer_synthesis_in_dedicated_module(self) -> None:
        service_source = RAG_SERVICE.read_text(encoding="utf-8")

        self.assertTrue(RAG_SERVICE_SYNTHESIS.exists())
        self.assertNotIn("validate_prompt_answer_grounding", service_source)
        self.assertNotIn("build_rag_answer_prompt_packet", service_source)
        self.assertNotIn("should_block_remote_content_generation", service_source)
        self.assertLessEqual(len(service_source.splitlines()), 520)

    def test_sdk_synthesis_does_not_import_raw_query_task_classifier(self) -> None:
        synthesis_source = RAG_SERVICE_SYNTHESIS.read_text(encoding="utf-8")

        self.assertNotIn("infer_evidence_query_intent", synthesis_source)
        self.assertNotIn("query_requests_negative_polarity", synthesis_source)
        self.assertNotIn("plan_student_handbook_query", synthesis_source)
        self.assertIn("_rag_task_kind_from_retrieval_intent", synthesis_source)

    def test_answer_shape_module_does_not_keep_regulation_query_cue_classifier(self) -> None:
        shape_source = RAG_AGENT_ANSWER_SHAPE.read_text(encoding="utf-8")

        self.assertNotIn("_CONDITION_QUERY_HINTS =", shape_source)
        self.assertNotIn("_OVERVIEW_HINTS =", shape_source)
        self.assertNotIn("_CATEGORY_DISCOVERY_HINTS =", shape_source)
        self.assertNotIn("_DETAIL_CLAUSE_HINTS =", shape_source)
        self.assertNotIn("_JUDGMENT_CLAUSE_HINTS =", shape_source)

    def test_delegate_service_keeps_outcome_branches_in_dedicated_module(self) -> None:
        service_source = RAG_SERVICE.read_text(encoding="utf-8")

        self.assertTrue(RAG_SERVICE_OUTCOMES.exists())
        self.assertTrue(RAG_SERVICE_PREFLIGHT_RESPONSES.exists())
        self.assertNotIn("_compose_no_answer_response", service_source)
        self.assertNotIn("_compose_clarification_response", service_source)
        self.assertNotIn('status="no_answer"', service_source)
        self.assertLessEqual(len(service_source.splitlines()), 300)

    def test_preflight_response_composition_is_split_from_branch_decisions(self) -> None:
        preflight_source = RAG_SERVICE_PREFLIGHT_RESPONSES.read_text(encoding="utf-8")
        branch_source = (RAG_AGENT_PACKAGE / "service_preflight.py").read_text(encoding="utf-8")

        self.assertIn("def build_pre_retrieval_clarification_response", preflight_source)
        self.assertIn("def build_pre_retrieval_no_answer_response", preflight_source)
        self.assertNotIn("_compose_clarification_response(", branch_source)
        self.assertNotIn("_compose_no_answer_response(", branch_source)

    def test_official_web_answering_is_split_from_facade(self) -> None:
        facade_source = RAG_OFFICIAL_WEB.read_text(encoding="utf-8")

        self.assertTrue(RAG_OFFICIAL_WEB_TERMS.exists())
        self.assertTrue(RAG_OFFICIAL_WEB_REFERENCE.exists())
        self.assertTrue(RAG_OFFICIAL_WEB_ANSWERING.exists())
        self.assertNotIn("def _score_official_web_statement", facade_source)
        self.assertNotIn("def _build_official_web_school_reference_fragments", facade_source)
        self.assertNotIn("def _compose_official_web_reference_answer", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 120)

    def test_official_web_reference_is_split_from_facade(self) -> None:
        facade_source = RAG_OFFICIAL_WEB_REFERENCE.read_text(encoding="utf-8")

        self.assertTrue(RAG_OFFICIAL_WEB_REFERENCE_SENTENCES.exists())
        self.assertTrue(RAG_OFFICIAL_WEB_REFERENCE_SCHOOL.exists())
        self.assertTrue(RAG_OFFICIAL_WEB_REFERENCE_PEOPLE.exists())
        self.assertTrue(RAG_OFFICIAL_WEB_REFERENCE_NEWS.exists())
        self.assertNotIn("def _split_official_web_sentences", facade_source)
        self.assertNotIn("def _build_official_web_school_reference_fragments", facade_source)
        self.assertNotIn("def _extract_official_web_scholar_name", facade_source)
        self.assertNotIn("def _build_official_web_news_fragments", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 120)

    def test_grounding_claim_extraction_is_split_from_facade(self) -> None:
        facade_source = RAG_GROUNDING_CLAIMS.read_text(encoding="utf-8")

        self.assertTrue(RAG_GROUNDING_CLAIM_MODELS.exists())
        self.assertTrue(RAG_GROUNDING_CLAIM_PATTERNS.exists())
        self.assertTrue(RAG_GROUNDING_CLAIM_BASIC.exists())
        self.assertTrue(RAG_GROUNDING_CLAIM_REQUIREMENTS.exists())
        self.assertTrue(RAG_GROUNDING_CLAIM_SENSITIVE.exists())
        self.assertTrue(RAG_GROUNDING_CLAIM_NORMALIZATION.exists())
        self.assertNotIn("class ExtractedClaim", facade_source)
        self.assertNotIn("def _extract_title_claims", facade_source)
        self.assertNotIn("def _extract_requirement_claims", facade_source)
        self.assertNotIn("def _expand_audience_claim", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 120)

    def test_grounding_validation_policy_is_split_from_public_facade(self) -> None:
        facade_source = RAG_GROUNDING_VALIDATION.read_text(encoding="utf-8")

        self.assertTrue(RAG_GROUNDING_VALIDATION_RESULT.exists())
        self.assertTrue(RAG_GROUNDING_VALIDATION_TRUST_POLICY.exists())
        self.assertTrue(RAG_GROUNDING_VALIDATION_SUPPORT_POLICY.exists())
        self.assertTrue(RAG_GROUNDING_VALIDATION_SOURCE_TRUST.exists())
        self.assertNotIn("class GroundingValidationResult", facade_source)
        self.assertNotIn("def _build_claim_support", facade_source)
        self.assertNotIn("def _required_source_trust_tier_for_claim_type", facade_source)
        self.assertNotIn("def build_source_trust_summary", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 140)

    def test_curriculum_answering_is_split_from_facade(self) -> None:
        facade_source = RAG_AGENT_CURRICULUM.read_text(encoding="utf-8")

        self.assertTrue(RAG_AGENT_CURRICULUM_TERMS.exists())
        self.assertTrue(RAG_AGENT_CURRICULUM_TABLES.exists())
        self.assertTrue(RAG_AGENT_CURRICULUM_TITLES.exists())
        self.assertTrue(RAG_AGENT_CURRICULUM_ANSWERING.exists())
        self.assertNotIn("class _CurriculumSemesterTableLayout", facade_source)
        self.assertNotIn("class _CurriculumCourseTitleCandidate", facade_source)
        self.assertNotIn("def _extract_curriculum_semester_course_titles", facade_source)
        self.assertNotIn("def _compose_curriculum_semester_course_list_answer", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 140)

    def test_answer_support_selection_is_split_from_facade(self) -> None:
        facade_source = RAG_AGENT_SELECTION.read_text(encoding="utf-8")

        self.assertTrue(RAG_AGENT_SELECTION_QUERY.exists())
        self.assertTrue(RAG_AGENT_SELECTION_STATEMENTS.exists())
        self.assertTrue(RAG_AGENT_SELECTION_ROWS.exists())
        self.assertNotIn("def _extract_source_statements", facade_source)
        self.assertNotIn("def _score_statement", facade_source)
        self.assertNotIn("def _select_answer_support_rows", facade_source)
        self.assertNotIn("def _should_stop_after_official_web_reference_rows", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 120)

    def test_answering_modes_are_split_from_public_answering_module(self) -> None:
        answering_source = RAG_AGENT_ANSWERING.read_text(encoding="utf-8")

        self.assertTrue(RAG_AGENT_ANSWERING_GENERIC.exists())
        self.assertTrue(RAG_AGENT_ANSWERING_PROCEDURE.exists())
        self.assertTrue(RAG_AGENT_ANSWERING_SUPPORT.exists())
        self.assertNotIn("def _build_procedure_answer_parts", answering_source)
        self.assertNotIn("def _normalize_procedure_fragment", answering_source)
        self.assertNotIn("def _query_topic_label", answering_source)
        self.assertNotIn("def _render_supporting_context", answering_source)
        self.assertLessEqual(len(answering_source.splitlines()), 180)

    def test_service_diagnostics_is_split_from_facade(self) -> None:
        facade_source = RAG_SERVICE_DIAGNOSTICS.read_text(encoding="utf-8")

        self.assertTrue(RAG_SERVICE_DIAGNOSTICS_PAYLOAD.exists())
        self.assertTrue(RAG_SERVICE_DIAGNOSTICS_RETRIEVAL.exists())
        self.assertTrue(RAG_SERVICE_DIAGNOSTICS_ADEQUACY.exists())
        self.assertTrue(RAG_SERVICE_DIAGNOSTICS_CURRICULUM.exists())
        self.assertNotIn("def _build_rag_result_diagnostics", facade_source)
        self.assertNotIn("def _build_retrieval_plan_summary", facade_source)
        self.assertNotIn("def _clarification_retrieval_adequacy", facade_source)
        self.assertNotIn("def _resolve_curriculum_diagnostics_follow_up", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 120)

    def test_prompting_facade_is_split_by_runtime_and_clarification_concerns(self) -> None:
        facade_source = RAG_SERVICE_PROMPTING.read_text(encoding="utf-8")

        self.assertTrue(RAG_SERVICE_PROMPT_RUNTIME.exists())
        self.assertTrue(RAG_SERVICE_CLARIFICATION.exists())
        self.assertNotIn("def _compose_clarification_response", facade_source)
        self.assertNotIn("def _with_prompt_trace", facade_source)
        self.assertNotIn("def _retrieval_ambiguity_reason", facade_source)
        self.assertNotIn("_GENERIC_AMBIGUOUS_TOPICS =", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 80)

    def test_versioning_flow_is_split_from_facade(self) -> None:
        facade_source = RAG_SERVICE_VERSIONING.read_text(encoding="utf-8")

        self.assertTrue(RAG_SERVICE_VERSIONING_CONTEXT.exists())
        self.assertTrue(RAG_SERVICE_VERSIONING_EVIDENCE.exists())
        self.assertTrue(RAG_SERVICE_VERSIONING_RESPONSE.exists())
        self.assertNotIn("class _VersionAnswerContext", facade_source)
        self.assertNotIn("def _build_version_aware_supporting_evidence", facade_source)
        self.assertNotIn("def _build_version_aware_completed_response", facade_source)
        self.assertNotIn("def _resolve_retrieval_query_mode", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 120)

    def test_service_scope_is_split_by_handbook_and_curriculum_concerns(self) -> None:
        scope_source = RAG_SERVICE_SCOPE.read_text(encoding="utf-8")

        self.assertTrue(RAG_SERVICE_SCOPE_CURRICULUM.exists())
        self.assertTrue(RAG_SERVICE_SCOPE_HANDBOOK.exists())
        self.assertTrue(RAG_SERVICE_SCOPE_PLANS.exists())
        self.assertNotIn("def _rewrite_curriculum_follow_up_goal", scope_source)
        self.assertNotIn("def _extract_curriculum_follow_up_program_fragment", scope_source)
        self.assertNotIn("def _plan_handbook_query", scope_source)
        self.assertLessEqual(len(scope_source.splitlines()), 160)

    def test_runtime_modules_import_concrete_split_modules_not_facades(self) -> None:
        facade_modules = (
            "agent_curriculum",
            "agent_selection",
            "agent_official_web_reference",
            "grounding_validation_claims",
            "service_scope",
            "service_diagnostics",
            "service_versioning",
        )
        facade_paths = {RAG_AGENT_PACKAGE / f"{module}.py" for module in facade_modules}
        for path in sorted(RAG_AGENT_PACKAGE.glob("*.py")):
            if path in facade_paths:
                continue
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                for module in facade_modules:
                    self.assertNotIn(f"from .{module} import", source)
                    self.assertNotIn(f"from campus_rag_agent.{module} import", source)

    def test_curriculum_query_planning_is_split_from_facade(self) -> None:
        facade_source = RAG_CURRICULUM_QUERY_PLANNING.read_text(encoding="utf-8")

        self.assertTrue(RAG_CURRICULUM_QUERY_MODELS.exists())
        self.assertTrue(RAG_CURRICULUM_QUERY_TEXT.exists())
        self.assertTrue(RAG_CURRICULUM_QUERY_CONFIG.exists())
        self.assertTrue(RAG_CURRICULUM_QUERY_COURSES.exists())
        self.assertTrue(RAG_CURRICULUM_QUERY_PROGRAMS.exists())
        self.assertNotIn("class CurriculumQueryPlan", facade_source)
        self.assertNotIn("def _load_curriculum_documents", facade_source)
        self.assertNotIn("def _resolve_course_entity", facade_source)
        self.assertLessEqual(len(facade_source.splitlines()), 120)

    def test_retriever_adapter_uses_current_callable_naming(self) -> None:
        scanned_paths = (
            RAG_SERVICE,
            RAG_SERVICE_COMMON,
            RAG_SERVICE_RETRIEVAL,
        )
        for path in scanned_paths:
            if not path.exists():
                continue
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn("legacy_retriever", source)
                self.assertNotIn("_execute_retrieval_request_with_legacy_retriever", source)


if __name__ == "__main__":
    unittest.main()
