from __future__ import annotations

import importlib
import os
import re
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from typing import Any, Protocol

from campus_ingestion_core.tokenizer_cache import resolve_prefetched_hf_tokenizer_path

DEFAULT_TOKENIZER_NAME = "regex_approximation_v1"
QWEN3_EMBEDDING_MODEL = "Qwen3-Embedding-4B"
QWEN3_EMBEDDING_REPO = "Qwen/Qwen3-Embedding-4B"
_HF_TOKENIZER_LOAD_LOCK = threading.Lock()
_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]")


class TokenCounter(Protocol):
    @property
    def name(self) -> str: ...

    def count(self, text: str) -> int: ...


class RegexApproxTokenCounter:
    def __init__(self, name: str = DEFAULT_TOKENIZER_NAME) -> None:
        self.name = name

    def count(self, text: str) -> int:
        return len(_TOKEN_RE.findall(text))


class TiktokenTokenCounter:
    def __init__(self, *, model_name: str, fallback_name: str = DEFAULT_TOKENIZER_NAME) -> None:
        self.model_name = model_name
        self.fallback_name = fallback_name

    @property
    def name(self) -> str:
        return f"tiktoken:{self.model_name}"

    def count(self, text: str) -> int:
        try:
            import tiktoken
        except ImportError:
            return RegexApproxTokenCounter(name=self.fallback_name).count(text)
        try:
            encoding = tiktoken.encoding_for_model(self.model_name)
        except Exception:
            try:
                encoding = tiktoken.get_encoding("cl100k_base")
            except Exception:
                return RegexApproxTokenCounter(name=self.fallback_name).count(text)
        try:
            return len(encoding.encode(text))
        except Exception:
            return RegexApproxTokenCounter(name=self.fallback_name).count(text)


class HuggingFaceTokenCounter:
    def __init__(self, *, tokenizer_repo: str, display_name: str) -> None:
        self.tokenizer_repo = tokenizer_repo
        self.display_name = display_name

    @property
    def name(self) -> str:
        return f"hf:{self.display_name}"

    def count(self, text: str) -> int:
        tokenizer = _load_hf_tokenizer(self.tokenizer_repo)
        return len(tokenizer.encode(text, add_special_tokens=False))


def build_token_counter(model_name: str) -> TokenCounter:
    if model_name:
        return TiktokenTokenCounter(model_name=model_name)
    return RegexApproxTokenCounter()


def build_curriculum_token_counter(model_name: str) -> TokenCounter:
    normalized_model_name = normalize_embedding_model_name(model_name)
    if normalized_model_name == QWEN3_EMBEDDING_MODEL:
        return HuggingFaceTokenCounter(
            tokenizer_repo=QWEN3_EMBEDDING_REPO,
            display_name=QWEN3_EMBEDDING_REPO,
        )
    return build_token_counter(model_name)


def build_student_handbook_v3_token_counter(model_name: str) -> TokenCounter:
    normalized_model_name = normalize_embedding_model_name(model_name)
    if normalized_model_name != QWEN3_EMBEDDING_MODEL:
        raise ValueError(
            "student_rules_semantic_v3 requires embedding model "
            f"{QWEN3_EMBEDDING_MODEL}, got {model_name or '<empty>'}"
        )
    return HuggingFaceTokenCounter(
        tokenizer_repo=QWEN3_EMBEDDING_REPO,
        display_name=QWEN3_EMBEDDING_REPO,
    )


def _load_hf_tokenizer(repo_id: str) -> Any:
    with _HF_TOKENIZER_LOAD_LOCK:
        return _load_hf_tokenizer_cached(repo_id)


@lru_cache(maxsize=4)
def _load_hf_tokenizer_cached(repo_id: str) -> Any:
    with _suppress_transformers_missing_torch_advisory():
        transformers = importlib.import_module("transformers")

    local_tokenizer_path = resolve_prefetched_hf_tokenizer_path(repo_id)
    return transformers.AutoTokenizer.from_pretrained(local_tokenizer_path, local_files_only=True)


@contextmanager
def _suppress_transformers_missing_torch_advisory() -> Iterator[None]:
    env_key = "TRANSFORMERS_NO_ADVISORY_WARNINGS"
    previous_value = os.environ.get(env_key)
    if previous_value is None:
        os.environ[env_key] = "1"
    try:
        yield
    finally:
        if previous_value is None:
            os.environ.pop(env_key, None)
        else:
            os.environ[env_key] = previous_value


_load_hf_tokenizer.cache_clear = _load_hf_tokenizer_cached.cache_clear


def normalize_embedding_model_name(model_name: str) -> str:
    normalized = model_name.strip()
    if normalized in {QWEN3_EMBEDDING_MODEL, QWEN3_EMBEDDING_REPO}:
        return QWEN3_EMBEDDING_MODEL
    return normalized


__all__ = [
    "DEFAULT_TOKENIZER_NAME",
    "QWEN3_EMBEDDING_MODEL",
    "QWEN3_EMBEDDING_REPO",
    "HuggingFaceTokenCounter",
    "RegexApproxTokenCounter",
    "TiktokenTokenCounter",
    "TokenCounter",
    "_load_hf_tokenizer",
    "build_curriculum_token_counter",
    "build_student_handbook_v3_token_counter",
    "build_token_counter",
    "normalize_embedding_model_name",
]
