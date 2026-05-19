from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

LLM_API_KEY_PRECEDENCE = ("EVAL_LLM_API_KEY", "LLM_API_KEY")
LLM_BASE_URL_PRECEDENCE = ("EVAL_LLM_BASE_URL", "LLM_BASE_URL")
EMBEDDING_API_KEY_PRECEDENCE = ("EVAL_EMBEDDING_API_KEY", "EMBEDDING_API_KEY")
EMBEDDING_BASE_URL_PRECEDENCE = ("EVAL_EMBEDDING_BASE_URL", "EMBEDDING_BASE_URL")


class ProviderConfigResolutionError(ValueError):
    def __init__(
        self,
        *,
        surface_name: str,
        logical_name: str,
        checked_keys: tuple[str, ...],
    ) -> None:
        self.surface_name = surface_name
        self.logical_name = logical_name
        self.checked_keys = checked_keys
        checked_order = " > ".join(checked_keys)
        super().__init__(
            f"missing {logical_name} for surface {surface_name}; checked {checked_order}"
        )


@dataclass(frozen=True, slots=True)
class ResolvedLLMProviderConfig:
    surface_name: str
    api_key: str
    api_key_source: str
    base_url: str | None
    base_url_source: str | None


@dataclass(frozen=True, slots=True)
class ResolvedEmbeddingProviderConfig:
    surface_name: str
    api_key: str
    api_key_source: str
    base_url: str | None
    base_url_source: str | None


@dataclass(frozen=True, slots=True)
class ResolvedProviderConfig:
    surface_name: str
    llm_api_key: str
    llm_api_key_source: str
    llm_base_url: str | None
    llm_base_url_source: str | None
    embedding_api_key: str
    embedding_api_key_source: str
    embedding_base_url: str | None
    embedding_base_url_source: str | None


def resolve_provider_config(
    surface_name: str,
    *,
    env: Mapping[str, str] | None = None,
) -> ResolvedProviderConfig:
    llm_provider = resolve_llm_provider_config(surface_name, env=env)
    embedding_provider = resolve_embedding_provider_config(surface_name, env=env)
    return ResolvedProviderConfig(
        surface_name=llm_provider.surface_name,
        llm_api_key=llm_provider.api_key,
        llm_api_key_source=llm_provider.api_key_source,
        llm_base_url=llm_provider.base_url,
        llm_base_url_source=llm_provider.base_url_source,
        embedding_api_key=embedding_provider.api_key,
        embedding_api_key_source=embedding_provider.api_key_source,
        embedding_base_url=embedding_provider.base_url,
        embedding_base_url_source=embedding_provider.base_url_source,
    )


def resolve_llm_provider_config(
    surface_name: str,
    *,
    env: Mapping[str, str] | None = None,
) -> ResolvedLLMProviderConfig:
    normalized_surface_name = surface_name.strip()
    if not normalized_surface_name:
        raise ValueError("surface_name must not be empty")

    source = env if env is not None else os.environ
    llm_api_key, llm_api_key_source = _read_required_env_value(
        source,
        surface_name=normalized_surface_name,
        logical_name="llm_api_key",
        checked_keys=LLM_API_KEY_PRECEDENCE,
    )
    llm_base_url, llm_base_url_source = _read_optional_env_value(
        source,
        checked_keys=LLM_BASE_URL_PRECEDENCE,
    )
    return ResolvedLLMProviderConfig(
        surface_name=normalized_surface_name,
        api_key=llm_api_key,
        api_key_source=llm_api_key_source,
        base_url=llm_base_url,
        base_url_source=llm_base_url_source,
    )


def resolve_embedding_provider_config(
    surface_name: str,
    *,
    env: Mapping[str, str] | None = None,
) -> ResolvedEmbeddingProviderConfig:
    normalized_surface_name = surface_name.strip()
    if not normalized_surface_name:
        raise ValueError("surface_name must not be empty")

    source = env if env is not None else os.environ
    embedding_api_key, embedding_api_key_source = _read_required_env_value(
        source,
        surface_name=normalized_surface_name,
        logical_name="embedding_api_key",
        checked_keys=EMBEDDING_API_KEY_PRECEDENCE,
    )
    embedding_base_url, embedding_base_url_source = _read_optional_env_value(
        source,
        checked_keys=EMBEDDING_BASE_URL_PRECEDENCE,
    )
    return ResolvedEmbeddingProviderConfig(
        surface_name=normalized_surface_name,
        api_key=embedding_api_key,
        api_key_source=embedding_api_key_source,
        base_url=embedding_base_url,
        base_url_source=embedding_base_url_source,
    )


def _read_required_env_value(
    source: Mapping[str, str],
    *,
    surface_name: str,
    logical_name: str,
    checked_keys: tuple[str, ...],
) -> tuple[str, str]:
    resolved_value, resolved_key = _read_optional_env_value(source, checked_keys=checked_keys)
    if resolved_value is None or resolved_key is None:
        raise ProviderConfigResolutionError(
            surface_name=surface_name,
            logical_name=logical_name,
            checked_keys=checked_keys,
        )
    return resolved_value, resolved_key


def _read_optional_env_value(
    source: Mapping[str, str],
    *,
    checked_keys: tuple[str, ...],
) -> tuple[str | None, str | None]:
    for key in checked_keys:
        raw_value = source.get(key)
        if raw_value is None:
            continue
        normalized_value = raw_value.strip()
        if not normalized_value:
            continue
        return normalized_value, key
    return None, None
