from __future__ import annotations

import asyncio
import json
import unittest
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
from campus_shared.provider_config import ProviderConfigResolutionError
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
    "ProviderConfigResolutionError",
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
    "httpx",
    "json",
    "patch",
    "reset_supplemental_http_runtime_state_for_tests",
    "unittest",
)
