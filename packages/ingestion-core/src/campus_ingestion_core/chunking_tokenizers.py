from __future__ import annotations

import re
import threading
from functools import lru_cache
from typing import Protocol

from campus_ingestion_core.local_tokenizer import count_tokens_with_local_tokenizer

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
    def __init__(self, *, model_name: str) -> None:
        self.model_name = model_name

    @property
    def name(self) -> str:
        return f"tiktoken:{self.model_name}"

    def count(self, text: str) -> int:
        try:
            import tiktoken
        except ImportError:
            raise RuntimeError(
                f"tiktoken is required to count tokens for model {self.model_name}"
            ) from None
        try:
            encoding = tiktoken.encoding_for_model(self.model_name)
        except Exception as exc:
            raise RuntimeError(
                f"tiktoken encoding is unavailable for model {self.model_name}"
            ) from exc
        try:
            return len(encoding.encode(text))
        except Exception as exc:
            raise RuntimeError(
                f"tiktoken failed to encode text for model {self.model_name}"
            ) from exc


class HuggingFaceTokenCounter:
    def __init__(self, *, tokenizer_repo: str, display_name: str) -> None:
        self.tokenizer_repo = tokenizer_repo
        self.display_name = display_name

    @property
    def name(self) -> str:
        return f"hf:{self.display_name}"

    def count(self, text: str) -> int:
        return _count_hf_tokens(self.tokenizer_repo, text)


def build_token_counter(model_name: str) -> TokenCounter:
    normalized_model_name = normalize_embedding_model_name(model_name)
    if normalized_model_name.startswith("mock-embedding"):
        return RegexApproxTokenCounter(name=f"mock:{normalized_model_name}")
    if normalized_model_name:
        return TiktokenTokenCounter(model_name=normalized_model_name)
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


def _count_hf_tokens(repo_id: str, text: str) -> int:
    with _HF_TOKENIZER_LOAD_LOCK:
        return _count_hf_tokens_cached(repo_id, text)


@lru_cache(maxsize=4)
def _count_hf_tokens_cached(repo_id: str, text: str) -> int:
    return count_tokens_with_local_tokenizer(repo_id=repo_id, text=text)


def _clear_hf_token_cache() -> None:
    _count_hf_tokens_cached.cache_clear()
    count_tokens_with_local_tokenizer.cache_clear()


_count_hf_tokens.cache_clear = _clear_hf_token_cache


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
    "_count_hf_tokens",
    "build_curriculum_token_counter",
    "build_student_handbook_v3_token_counter",
    "build_token_counter",
    "normalize_embedding_model_name",
]
