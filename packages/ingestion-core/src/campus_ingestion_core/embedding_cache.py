from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.embed import EmbeddingSettings


class EmbeddingCacheObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(slots=True)
class EmbeddingCacheStats:
    hit_count: int = 0
    miss_count: int = 0
    provider_call_count: int = 0
    write_count: int = 0


@dataclass(frozen=True, slots=True)
class EmbeddingCacheKey:
    provider: str
    model: str
    dimensions: int | None
    embedding_mode: str
    profile_identity: str
    text_sha256: str

    def object_key(self) -> str:
        identity = "|".join(
            (
                self.provider,
                self.model,
                str(self.dimensions or ""),
                self.embedding_mode,
                self.profile_identity,
            )
        )
        identity_hash = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        return (
            "embedding-cache/"
            f"{_safe_segment(self.provider)}/"
            f"{_safe_segment(self.model)}/"
            f"{identity_hash[:16]}/"
            f"{self.text_sha256}.json"
        )


@dataclass(slots=True)
class ObjectStoreEmbeddingCache:
    object_store: EmbeddingCacheObjectStore
    bucket: str
    settings: EmbeddingSettings
    profile_identity: str
    embedding_mode: str = "document"

    def get(self, text: str) -> tuple[float, ...] | None:
        key = self._key(text)
        try:
            raw = self.object_store.get_bytes(bucket=self.bucket, key=key.object_key())
        except Exception:
            return None
        payload = json.loads(raw.decode("utf-8"))
        if payload.get("provider") != self.settings.provider:
            raise ValueError("embedding cache provider mismatch")
        if payload.get("model") != self.settings.model:
            raise ValueError("embedding cache model mismatch")
        dimensions = payload.get("dimensions")
        if dimensions != self.settings.dimensions:
            raise ValueError("embedding cache dimensions mismatch")
        if payload.get("text_sha256") != key.text_sha256:
            raise ValueError("embedding cache text hash mismatch")
        vector = tuple(float(item) for item in payload.get("vector") or ())
        if self.settings.dimensions is not None and len(vector) != self.settings.dimensions:
            raise ValueError("embedding cache vector dimensions mismatch")
        return vector

    def put(self, text: str, vector: tuple[float, ...]) -> None:
        key = self._key(text)
        if self.settings.dimensions is not None and len(vector) != self.settings.dimensions:
            raise ValueError("embedding cache vector dimensions mismatch")
        payload = {
            "schema_version": "embedding_cache_value.v1",
            "provider": self.settings.provider,
            "model": self.settings.model,
            "dimensions": self.settings.dimensions,
            "embedding_mode": self.embedding_mode,
            "profile_identity": self.profile_identity,
            "text_sha256": key.text_sha256,
            "vector": list(vector),
        }
        self.object_store.put_bytes(
            bucket=self.bucket,
            key=key.object_key(),
            data=(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode(
                "utf-8"
            ),
            content_type="application/json",
        )

    def _key(self, text: str) -> EmbeddingCacheKey:
        return EmbeddingCacheKey(
            provider=self.settings.provider,
            model=self.settings.model,
            dimensions=self.settings.dimensions,
            embedding_mode=self.embedding_mode,
            profile_identity=self.profile_identity,
            text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        )


@dataclass(slots=True)
class CacheAwareEmbeddingModel:
    provider_model: object
    cache: ObjectStoreEmbeddingCache
    stats: EmbeddingCacheStats

    @property
    def model_name(self) -> str:
        return str(getattr(self.provider_model, "model_name", "") or self.cache.settings.model)

    def get_text_embedding(self, text: str) -> tuple[float, ...]:
        cached = self.cache.get(text)
        if cached is not None:
            self.stats.hit_count += 1
            return cached
        self.stats.miss_count += 1
        self.stats.provider_call_count += 1
        vector = tuple(float(item) for item in self.provider_model.get_text_embedding(text))
        self.cache.put(text, vector)
        self.stats.write_count += 1
        return vector

    def get_text_embedding_batch(self, texts: list[str]) -> list[tuple[float, ...]]:
        return [self.get_text_embedding(text) for text in texts]


def build_cache_profile_identity(*, corpus: str, collection: str, cleaning: str, chunk: str) -> str:
    return f"{corpus}/{collection}|cleaning={cleaning}|chunk={chunk}"


def _safe_segment(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip())[:80] or "unknown"


__all__ = [
    "CacheAwareEmbeddingModel",
    "EmbeddingCacheStats",
    "ObjectStoreEmbeddingCache",
    "build_cache_profile_identity",
]
