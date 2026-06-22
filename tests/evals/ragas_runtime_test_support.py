from __future__ import annotations

import asyncio
import json
import os
import stat
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx
from campus_evals import (
    RagasProjection,
    RagasSettings,
    build_default_ragas_metric_names,
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    build_ragas_dataset,
    build_ragas_scorer,
    build_ragas_supplemental_adapter_from_env,
)
from campus_evals.faithfulness_runtime import bind_faithfulness_artifact_context
from campus_evals.ragas_adapter import build_default_ragas_metrics
from campus_evals.settings import SupplementalHTTPSettings
from campus_evals.supplemental_http import (
    OpenAICompatibleChatCompletionsLLM,
    OpenAICompatibleResponsesLLM,
    SupplementalPreflightFailedError,
    _retry_delay_seconds,
    reset_supplemental_http_runtime_state_for_tests,
)
from langchain_core.prompt_values import StringPromptValue
from pydantic import BaseModel as PydanticBaseModel
from ragas.llms.base import InstructorBaseRagasLLM
from ragas.metrics._faithfulness import (
    NLIStatementOutput,
    StatementFaithfulnessAnswer,
    StatementGeneratorOutput,
)

__all__ = (
    "InstructorBaseRagasLLM",
    "NLIStatementOutput",
    "OpenAICompatibleChatCompletionsLLM",
    "OpenAICompatibleResponsesLLM",
    "Path",
    "PydanticBaseModel",
    "RagasProjection",
    "RagasSettings",
    "StatementFaithfulnessAnswer",
    "StatementGeneratorOutput",
    "StringPromptValue",
    "SupplementalHTTPSettings",
    "SupplementalPreflightFailedError",
    "TemporaryDirectory",
    "_retry_delay_seconds",
    "asyncio",
    "bind_faithfulness_artifact_context",
    "build_default_ragas_metric_names",
    "build_default_ragas_metrics",
    "build_http_ragas_embeddings",
    "build_http_ragas_llm",
    "build_ragas_dataset",
    "build_ragas_scorer",
    "build_ragas_supplemental_adapter_from_env",
    "env_with_eval_provider_projection",
    "httpx",
    "json",
    "os",
    "patch",
    "reset_supplemental_http_runtime_state_for_tests",
    "stat",
    "unittest",
    "write_eval_provider_projection",
)


def write_eval_provider_projection(path: Path) -> None:
    _write_eval_provider_projection(path, env=None, use_env_provider_handles=False)


def _write_eval_provider_projection(
    path: Path,
    *,
    env: dict[str, str] | None,
    use_env_provider_handles: bool,
) -> None:
    source = env or {}
    llm_api_key = (
        _read_first(source, "EVAL_LLM_API_KEY", "LLM_API_KEY") if use_env_provider_handles else None
    ) or "llm-key"
    llm_base_url = (
        _read_first(source, "EVAL_LLM_BASE_URL", "LLM_BASE_URL")
        if use_env_provider_handles
        else None
    ) or "https://llm.example/v1"
    embedding_api_key = (
        _read_first(source, "EVAL_EMBEDDING_API_KEY", "EMBEDDING_API_KEY")
        if use_env_provider_handles
        else None
    ) or "embed-key"
    embedding_base_url = (
        _read_first(source, "EVAL_EMBEDDING_BASE_URL", "EMBEDDING_BASE_URL")
        if use_env_provider_handles
        else None
    ) or "https://embed.example/v1"
    path.write_text(
        json.dumps(
            {
                "schema_version": "provider_config_projection.v1",
                "generated_at": "2026-06-22T00:00:00Z",
                "profiles": {
                    "eval_ragas_llm": {
                        "api_key": llm_api_key,
                        "base_url": llm_base_url,
                        "kind": "prompt",
                        "model": "gpt-5.4",
                        "profile_id": "provider_profile_eval_ragas_llm",
                        "provider": "openai",
                        "revision": 3,
                        "role": "eval_ragas_llm",
                        "timeout_ms": 30000,
                        "transport": "responses",
                    },
                    "eval_ragas_embedding": {
                        "api_key": embedding_api_key,
                        "base_url": embedding_base_url,
                        "dimensions": 2560,
                        "kind": "embedding",
                        "model": "Qwen3-Embedding-4B",
                        "profile_id": "provider_profile_eval_ragas_embedding",
                        "provider": "openai-compatible",
                        "revision": 4,
                        "role": "eval_ragas_embedding",
                        "timeout_ms": 30000,
                        "transport": "embeddings",
                    },
                    "eval_judge_llm": {
                        "api_key": llm_api_key if use_env_provider_handles else "judge-key",
                        "base_url": llm_base_url
                        if use_env_provider_handles
                        else "https://judge.example/v1",
                        "kind": "prompt",
                        "model": "gpt-5.4",
                        "profile_id": "provider_profile_eval_judge_llm",
                        "provider": "openai",
                        "revision": 5,
                        "role": "eval_judge_llm",
                        "timeout_ms": 30000,
                        "transport": "responses",
                    },
                },
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


@contextmanager
def env_with_eval_provider_projection(
    env: dict[str, str] | None = None,
    *,
    use_env_provider_handles: bool = False,
) -> Iterator[dict[str, str]]:
    with TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "provider-projection.json"
        next_env = dict(env or {})
        _write_eval_provider_projection(
            path,
            env=next_env,
            use_env_provider_handles=use_env_provider_handles,
        )
        next_env["CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH"] = str(path)
        yield next_env


def ragas_settings_from_projection(
    env: dict[str, str] | None = None,
    **kwargs: object,
) -> RagasSettings:
    with env_with_eval_provider_projection(env, use_env_provider_handles=True) as resolved:
        return RagasSettings.from_env(resolved, **kwargs)


def _read_first(source: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key, "").strip()
        if value:
            return value
    return None
