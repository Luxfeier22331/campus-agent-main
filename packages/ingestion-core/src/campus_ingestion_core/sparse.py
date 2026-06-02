from __future__ import annotations

import hashlib
import math
import os
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Protocol

from fastembed import SparseTextEmbedding
from qdrant_client.http import models as qdrant_models

DEFAULT_SPARSE_PROVIDER = "qdrant"
DEFAULT_SPARSE_MODEL = "qdrant/bm25"
DEFAULT_SPARSE_TOKENIZER = "multilingual"
DEFAULT_SPARSE_LANGUAGE = "none"

_ASCII_TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True, slots=True)
class SparseVectorData:
    indices: tuple[int, ...]
    values: tuple[float, ...]

    def to_qdrant(self) -> qdrant_models.SparseVector:
        return qdrant_models.SparseVector(indices=list(self.indices), values=list(self.values))


class SparseEmbeddingModel(Protocol):
    settings: SparseEmbeddingSettings

    def build_document(self, text: str) -> qdrant_models.Document | qdrant_models.SparseVector: ...

    def build_query(
        self, text: str
    ) -> qdrant_models.Document | qdrant_models.SparseVector | None: ...


@dataclass(frozen=True, slots=True)
class SparseEmbeddingSettings:
    provider: str = DEFAULT_SPARSE_PROVIDER
    model: str = DEFAULT_SPARSE_MODEL
    tokenizer: str = DEFAULT_SPARSE_TOKENIZER
    language: str = DEFAULT_SPARSE_LANGUAGE

    def __post_init__(self) -> None:
        if not self.provider:
            raise ValueError("SPARSE_PROVIDER is required")
        if not self.model:
            raise ValueError("SPARSE_MODEL is required")
        if not self.tokenizer:
            raise ValueError("SPARSE_TOKENIZER is required")
        if not self.language:
            raise ValueError("SPARSE_LANGUAGE is required")

    @property
    def is_mock(self) -> bool:
        return self.provider.strip().lower() == "mock"

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> SparseEmbeddingSettings:
        source = env if env is not None else os.environ
        return cls(
            provider=(source.get("SPARSE_PROVIDER") or DEFAULT_SPARSE_PROVIDER).strip()
            or DEFAULT_SPARSE_PROVIDER,
            model=(source.get("SPARSE_MODEL") or DEFAULT_SPARSE_MODEL).strip()
            or DEFAULT_SPARSE_MODEL,
            tokenizer=(source.get("SPARSE_TOKENIZER") or DEFAULT_SPARSE_TOKENIZER).strip()
            or DEFAULT_SPARSE_TOKENIZER,
            language=(source.get("SPARSE_LANGUAGE") or DEFAULT_SPARSE_LANGUAGE).strip()
            or DEFAULT_SPARSE_LANGUAGE,
        )


@dataclass(frozen=True, slots=True)
class MockSparseEmbeddingSettings:
    model: str = DEFAULT_SPARSE_MODEL
    tokenizer: str = DEFAULT_SPARSE_TOKENIZER
    language: str = DEFAULT_SPARSE_LANGUAGE


@dataclass(slots=True)
class QdrantBm25SparseEmbedding:
    settings: SparseEmbeddingSettings
    _fastembed_model: SparseTextEmbedding | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        provider = self.settings.provider.strip().lower()
        if provider not in {DEFAULT_SPARSE_PROVIDER, "mock"}:
            raise ValueError(f"unsupported sparse embedding provider: {self.settings.provider}")
        if self.settings.model.strip().lower() != DEFAULT_SPARSE_MODEL:
            raise ValueError(f"unsupported sparse embedding model: {self.settings.model}")
        if self.settings.tokenizer.strip().lower() != DEFAULT_SPARSE_TOKENIZER:
            raise ValueError(f"unsupported sparse tokenizer: {self.settings.tokenizer}")
        if self.settings.language.strip().lower() != DEFAULT_SPARSE_LANGUAGE:
            raise ValueError(f"unsupported sparse language: {self.settings.language}")

    def build_document(self, text: str) -> qdrant_models.Document | qdrant_models.SparseVector:
        if self.settings.is_mock:
            return _build_sparse_vector(text=text, query_mode=False).to_qdrant()
        return self._build_fastembed_sparse_vector(text=text)

    def build_query(self, text: str) -> qdrant_models.Document | qdrant_models.SparseVector | None:
        if self.settings.is_mock:
            sparse = _build_sparse_vector(text=text, query_mode=True).to_qdrant()
            if not sparse.indices:
                return None
            return sparse
        normalized = text.strip()
        if not normalized:
            return None
        return self._build_fastembed_sparse_vector(text=normalized)

    def _build_fastembed_sparse_vector(self, *, text: str) -> qdrant_models.SparseVector:
        fastembed_model = self._get_fastembed_model()
        vector = next(iter(fastembed_model.embed([text])))
        return qdrant_models.SparseVector(
            indices=[int(index) for index in vector.indices.tolist()],
            values=[float(value) for value in vector.values.tolist()],
        )

    def _get_fastembed_model(self) -> SparseTextEmbedding:
        if self._fastembed_model is None:
            self._fastembed_model = SparseTextEmbedding(
                model_name=_fastembed_model_name(self.settings)
            )
        return self._fastembed_model


def build_sparse_embedding_model(settings: SparseEmbeddingSettings) -> SparseEmbeddingModel:
    return QdrantBm25SparseEmbedding(settings)


def build_mock_sparse_embedding_model(
    settings: MockSparseEmbeddingSettings | None = None,
) -> SparseEmbeddingModel:
    resolved = settings or MockSparseEmbeddingSettings()
    return QdrantBm25SparseEmbedding(
        SparseEmbeddingSettings(
            provider="mock",
            model=resolved.model,
            tokenizer=resolved.tokenizer,
            language=resolved.language,
        )
    )


def _fastembed_model_name(settings: SparseEmbeddingSettings) -> str:
    if settings.model.strip().lower() == DEFAULT_SPARSE_MODEL:
        return "Qdrant/bm25"
    return settings.model.strip()


def _build_bm25_config(settings: SparseEmbeddingSettings) -> qdrant_models.Bm25Config:
    return qdrant_models.Bm25Config(
        tokenizer=qdrant_models.TokenizerType(settings.tokenizer.strip().lower()),
        language=settings.language,
        lowercase=True,
        ascii_folding=False,
    )


def _build_sparse_vector(*, text: str, query_mode: bool) -> SparseVectorData:
    tokens = _tokenize_multilingual(text)
    if not tokens:
        return SparseVectorData(indices=(), values=())

    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1

    encoded: list[tuple[int, float]] = []
    for token, count in counts.items():
        index = int.from_bytes(
            hashlib.blake2s(token.encode("utf-8"), digest_size=4).digest(), "big"
        )
        value = 1.0 if query_mode else 1.0 + math.log1p(count)
        encoded.append((index, value))
    encoded.sort(key=lambda item: item[0])
    return SparseVectorData(
        indices=tuple(index for index, _ in encoded),
        values=tuple(value for _, value in encoded),
    )


def _tokenize_multilingual(text: str) -> tuple[str, ...]:
    normalized = unicodedata.normalize("NFKC", text).lower()
    tokens: list[str] = []
    ascii_buffer: list[str] = []
    cjk_buffer: list[str] = []

    def flush_ascii() -> None:
        if not ascii_buffer:
            return
        token = "".join(ascii_buffer)
        ascii_buffer.clear()
        tokens.extend(_ASCII_TOKEN_RE.findall(token))

    def flush_cjk() -> None:
        if not cjk_buffer:
            return
        segment = "".join(cjk_buffer)
        cjk_buffer.clear()
        tokens.extend(_expand_cjk_segment(segment))

    for char in normalized:
        if char.isascii() and char.isalnum():
            flush_cjk()
            ascii_buffer.append(char)
            continue
        if _is_cjk_char(char):
            flush_ascii()
            cjk_buffer.append(char)
            continue
        flush_ascii()
        flush_cjk()

    flush_ascii()
    flush_cjk()
    return tuple(token for token in tokens if token)


def _expand_cjk_segment(segment: str) -> tuple[str, ...]:
    if not segment:
        return ()
    tokens: list[str] = []
    if len(segment) <= 16:
        tokens.append(segment)
    tokens.extend(segment[index] for index in range(len(segment)))
    if len(segment) >= 2:
        tokens.extend(segment[index : index + 2] for index in range(len(segment) - 1))
    if len(segment) >= 3 and len(segment) <= 12:
        tokens.extend(segment[index : index + 3] for index in range(len(segment) - 2))
    return tuple(tokens)


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )
