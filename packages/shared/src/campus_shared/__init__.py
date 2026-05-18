from __future__ import annotations

from importlib import import_module
from typing import Any

_EXPORTS: dict[str, tuple[str, str]] = {
    "ANSWER_ROUTE": ("campus_shared.constants", "ANSWER_ROUTE"),
    "ANSWER_READY_ALLOWED_POLARITIES": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_ALLOWED_POLARITIES",
    ),
    "ANSWER_READY_ANSWER_ROLES": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_ANSWER_ROLES",
    ),
    "ANSWER_READY_BASE_REQUIRED_FIELDS": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_BASE_REQUIRED_FIELDS",
    ),
    "ANSWER_READY_CATEGORY_OVERVIEW_REQUIRED_FIELDS": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_CATEGORY_OVERVIEW_REQUIRED_FIELDS",
    ),
    "ANSWER_READY_CATEGORY_OVERVIEW_ROLES": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_CATEGORY_OVERVIEW_ROLES",
    ),
    "ANSWER_READY_CATEGORY_REGISTRY_VERSION": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_CATEGORY_REGISTRY_VERSION",
    ),
    "ANSWER_READY_CONDITION_GROUP_SUBJECTS": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_CONDITION_GROUP_SUBJECTS",
    ),
    "ANSWER_READY_CONTRACT_REGULATION_SCOPES": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_CONTRACT_REGULATION_SCOPES",
    ),
    "ANSWER_READY_EVIDENCE_CONTRACT_VERSION": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_EVIDENCE_CONTRACT_VERSION",
    ),
    "ANSWER_READY_GROUPED_ANSWER_ROLES": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_GROUPED_ANSWER_ROLES",
    ),
    "ANSWER_READY_INTRO_REQUIRED_FIELDS": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_INTRO_REQUIRED_FIELDS",
    ),
    "ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS",
    ),
    "ANSWER_READY_JUDGMENT_ANSWER_ROLES": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_JUDGMENT_ANSWER_ROLES",
    ),
    "ANSWER_READY_PROCEDURE_ACTIONS": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_PROCEDURE_ACTIONS",
    ),
    "ANSWER_READY_PROCEDURE_ACTORS": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_PROCEDURE_ACTORS",
    ),
    "ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION",
    ),
    "ANSWER_READY_PROCEDURE_REQUIRED_FIELDS": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_PROCEDURE_REQUIRED_FIELDS",
    ),
    "ANSWER_READY_REQUIRED_FIELDS_BY_ROLE": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_REQUIRED_FIELDS_BY_ROLE",
    ),
    "ANSWER_READY_ROLE_MATRIX_VERSION": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_ROLE_MATRIX_VERSION",
    ),
    "ANSWER_READY_SCHEMA_VERSION": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_SCHEMA_VERSION",
    ),
    "ANSWER_READY_TABLE_FACT_REQUIRED_FIELDS": (
        "campus_shared.answer_ready_evidence_contract",
        "ANSWER_READY_TABLE_FACT_REQUIRED_FIELDS",
    ),
    "APP_NAME": ("campus_shared.constants", "APP_NAME"),
    "REGULATION_GROUPED_ANSWER_ROLES": (
        "campus_shared.regulation_semantic_registry",
        "REGULATION_GROUPED_ANSWER_ROLES",
    ),
    "DEFAULT_PROMPT_RUNTIME_BASE_URL": (
        "campus_shared.prompt_runtime",
        "DEFAULT_PROMPT_RUNTIME_BASE_URL",
    ),
    "HEALTH_ROUTE": ("campus_shared.constants", "HEALTH_ROUTE"),
    "READY_ROUTE": ("campus_shared.constants", "READY_ROUTE"),
    "REPO_GLOBAL_DEVELOPER_INVARIANTS_ID": (
        "campus_shared.prompt_runtime",
        "REPO_GLOBAL_DEVELOPER_INVARIANTS_ID",
    ),
    "REPO_GLOBAL_DEVELOPER_INVARIANTS_VERSION": (
        "campus_shared.prompt_runtime",
        "REPO_GLOBAL_DEVELOPER_INVARIANTS_VERSION",
    ),
    "NormalizedProviderGroundingSupport": (
        "campus_shared.prompt_runtime",
        "NormalizedProviderGroundingSupport",
    ),
    "AnswerReadyEvidenceContractRules": (
        "campus_shared.answer_ready_evidence_contract",
        "AnswerReadyEvidenceContractRules",
    ),
    "AnswerReadyEvidenceValidationResult": (
        "campus_shared.answer_ready_evidence_contract",
        "AnswerReadyEvidenceValidationResult",
    ),
    "REGULATION_CONDITION_SUBJECT_ALIASES": (
        "campus_shared.regulation_semantic_registry",
        "REGULATION_CONDITION_SUBJECT_ALIASES",
    ),
    "PromptRuntimeHTTPSettings": (
        "campus_shared.prompt_runtime",
        "PromptRuntimeHTTPSettings",
    ),
    "REGULATION_PROCEDURE_ACTION_ALIASES": (
        "campus_shared.regulation_semantic_registry",
        "REGULATION_PROCEDURE_ACTION_ALIASES",
    ),
    "REGULATION_PROCEDURE_ACTOR_ALIASES": (
        "campus_shared.regulation_semantic_registry",
        "REGULATION_PROCEDURE_ACTOR_ALIASES",
    ),
    "REGULATION_CONDITION_SUBJECT_DEFINITIONS": (
        "campus_shared.regulation_semantic_registry",
        "REGULATION_CONDITION_SUBJECT_DEFINITIONS",
    ),
    "REGULATION_PROCEDURE_ACTION_DEFINITIONS": (
        "campus_shared.regulation_semantic_registry",
        "REGULATION_PROCEDURE_ACTION_DEFINITIONS",
    ),
    "REGULATION_PROCEDURE_ACTOR_DEFINITIONS": (
        "campus_shared.regulation_semantic_registry",
        "REGULATION_PROCEDURE_ACTOR_DEFINITIONS",
    ),
    "PromptRuntimeProviderConfig": (
        "campus_shared.prompt_runtime",
        "PromptRuntimeProviderConfig",
    ),
    "PromptRuntimeValidationError": (
        "campus_shared.prompt_runtime",
        "PromptRuntimeValidationError",
    ),
    "ProviderConfigResolutionError": (
        "campus_shared.provider_config",
        "ProviderConfigResolutionError",
    ),
    "RepoEnvBootstrapState": (
        "campus_shared.env_bootstrap",
        "RepoEnvBootstrapState",
    ),
    "ResolvedEmbeddingProviderConfig": (
        "campus_shared.provider_config",
        "ResolvedEmbeddingProviderConfig",
    ),
    "ResolvedLLMProviderConfig": (
        "campus_shared.provider_config",
        "ResolvedLLMProviderConfig",
    ),
    "ResolvedProviderConfig": (
        "campus_shared.provider_config",
        "ResolvedProviderConfig",
    ),
    "ResponsesStructuredOutputExecutor": (
        "campus_shared.prompt_runtime",
        "ResponsesStructuredOutputExecutor",
    ),
    "StructuredOutputExecutionResult": (
        "campus_shared.prompt_runtime",
        "StructuredOutputExecutionResult",
    ),
    "build_prompt_runtime_http_client": (
        "campus_shared.prompt_runtime",
        "build_prompt_runtime_http_client",
    ),
    "canonical_regulation_condition_subject": (
        "campus_shared.regulation_semantic_registry",
        "canonical_regulation_condition_subject",
    ),
    "canonical_regulation_procedure_action": (
        "campus_shared.regulation_semantic_registry",
        "canonical_regulation_procedure_action",
    ),
    "canonical_regulation_procedure_actor": (
        "campus_shared.regulation_semantic_registry",
        "canonical_regulation_procedure_actor",
    ),
    "answer_ready_contract_applies": (
        "campus_shared.answer_ready_evidence_contract",
        "answer_ready_contract_applies",
    ),
    "answer_ready_contract_rules_for_scope": (
        "campus_shared.answer_ready_evidence_contract",
        "answer_ready_contract_rules_for_scope",
    ),
    "build_prompt_trace": ("campus_shared.prompt_runtime", "build_prompt_trace"),
    "condition_group_subject_from_group_id": (
        "campus_shared.regulation_semantic_registry",
        "condition_group_subject_from_group_id",
    ),
    "classify_prompt_runtime_failure": (
        "campus_shared.prompt_runtime",
        "classify_prompt_runtime_failure",
    ),
    "get_repo_env_bootstrap_state": (
        "campus_shared.env_bootstrap",
        "get_repo_env_bootstrap_state",
    ),
    "get_repo_global_developer_invariants_text": (
        "campus_shared.prompt_runtime",
        "get_repo_global_developer_invariants_text",
    ),
    "load_student_rules_discovery_config": (
        "campus_shared.regulation_semantic_registry",
        "load_student_rules_discovery_config",
    ),
    "load_repo_env": ("campus_shared.env_bootstrap", "load_repo_env"),
    "normalize_provider_grounding_supports": (
        "campus_shared.prompt_runtime",
        "normalize_provider_grounding_supports",
    ),
    "regulation_categories_for_document": (
        "campus_shared.regulation_semantic_registry",
        "regulation_categories_for_document",
    ),
    "RegulationSemanticsRegistry": (
        "campus_shared.regulation_semantic_patterns",
        "RegulationSemanticsRegistry",
    ),
    "build_category_overview_metadata": (
        "campus_shared.regulation_semantic_patterns",
        "build_category_overview_metadata",
    ),
    "compact_semantic_text": (
        "campus_shared.regulation_semantic_patterns",
        "compact_semantic_text",
    ),
    "infer_negative_semantic_role": (
        "campus_shared.regulation_semantic_patterns",
        "infer_negative_semantic_role",
    ),
    "infer_table_fact_type": (
        "campus_shared.regulation_semantic_patterns",
        "infer_table_fact_type",
    ),
    "load_default_regulation_semantics_registry": (
        "campus_shared.regulation_semantic_patterns",
        "load_default_regulation_semantics_registry",
    ),
    "looks_like_condition_claim_text": (
        "campus_shared.regulation_semantic_patterns",
        "looks_like_condition_claim_text",
    ),
    "looks_like_deadline_constraint_text": (
        "campus_shared.regulation_semantic_patterns",
        "looks_like_deadline_constraint_text",
    ),
    "looks_like_requirement_text": (
        "campus_shared.regulation_semantic_patterns",
        "looks_like_requirement_text",
    ),
    "starts_example_list": (
        "campus_shared.regulation_semantic_patterns",
        "starts_example_list",
    ),
    "starts_procedure_list": (
        "campus_shared.regulation_semantic_patterns",
        "starts_procedure_list",
    ),
    "require_non_empty_output_text": (
        "campus_shared.prompt_runtime",
        "require_non_empty_output_text",
    ),
    "reset_repo_env_bootstrap_state": (
        "campus_shared.env_bootstrap",
        "reset_repo_env_bootstrap_state",
    ),
    "resolve_embedding_provider_config": (
        "campus_shared.provider_config",
        "resolve_embedding_provider_config",
    ),
    "resolve_regulation_intro_list_role_hint": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_intro_list_role_hint",
    ),
    "resolve_regulation_action_type": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_action_type",
    ),
    "resolve_regulation_group_intro_kind": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_group_intro_kind",
    ),
    "resolve_regulation_heading_role_hint": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_heading_role_hint",
    ),
    "resolve_regulation_procedure_actor": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_procedure_actor",
    ),
    "resolve_regulation_intro_scope": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_intro_scope",
    ),
    "resolve_regulation_intro_subject": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_intro_subject",
    ),
    "resolve_regulation_expected_polarity": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_expected_polarity",
    ),
    "resolve_regulation_procedure_materials": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_procedure_materials",
    ),
    "resolve_regulation_procedure_next_actor": (
        "campus_shared.regulation_semantic_registry",
        "resolve_regulation_procedure_next_actor",
    ),
    "resolve_llm_provider_config": (
        "campus_shared.provider_config",
        "resolve_llm_provider_config",
    ),
    "resolve_provider_config": (
        "campus_shared.provider_config",
        "resolve_provider_config",
    ),
    "serialize_prompt_payload": (
        "campus_shared.prompt_runtime",
        "serialize_prompt_payload",
    ),
    "validate_prompt_packet_contract": (
        "campus_shared.prompt_runtime",
        "validate_prompt_packet_contract",
    ),
    "validate_prompt_trace_contract": (
        "campus_shared.prompt_runtime",
        "validate_prompt_trace_contract",
    ),
    "validate_answer_ready_evidence_metadata": (
        "campus_shared.answer_ready_evidence_contract",
        "validate_answer_ready_evidence_metadata",
    ),
}

__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
    try:
        module_name, attribute_name = _EXPORTS[name]
    except KeyError as exc:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from exc
    value = getattr(import_module(module_name), attribute_name)
    globals()[name] = value
    return value
