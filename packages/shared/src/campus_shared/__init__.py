from __future__ import annotations

from importlib import import_module
from typing import Any

_EXPORTS: dict[str, tuple[str, str]] = {
    "APP_NAME": ("campus_shared.constants", "APP_NAME"),
    "HEALTH_ROUTE": ("campus_shared.constants", "HEALTH_ROUTE"),
    "READY_ROUTE": ("campus_shared.constants", "READY_ROUTE"),
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
    "get_repo_env_bootstrap_state": (
        "campus_shared.env_bootstrap",
        "get_repo_env_bootstrap_state",
    ),
    "load_repo_env": ("campus_shared.env_bootstrap", "load_repo_env"),
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
