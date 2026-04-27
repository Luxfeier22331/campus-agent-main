from __future__ import annotations

from importlib import import_module
from typing import Any

_EXPORTS: dict[str, tuple[str, str]] = {
    "ANSWER_ROUTE": ("campus_shared.constants", "ANSWER_ROUTE"),
    "APP_NAME": ("campus_shared.constants", "APP_NAME"),
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
    "PromptRuntimeHTTPSettings": (
        "campus_shared.prompt_runtime",
        "PromptRuntimeHTTPSettings",
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
    "build_prompt_trace": ("campus_shared.prompt_runtime", "build_prompt_trace"),
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
    "load_repo_env": ("campus_shared.env_bootstrap", "load_repo_env"),
    "normalize_provider_grounding_supports": (
        "campus_shared.prompt_runtime",
        "normalize_provider_grounding_supports",
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
