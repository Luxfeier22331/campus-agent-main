from __future__ import annotations

import json
import unittest

from campus_ingestion_core.embed import EmbeddingSettings
from campus_ingestion_core.embedding_cache import (
    CacheAwareEmbeddingModel,
    EmbeddingCacheStats,
    ObjectStoreEmbeddingCache,
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data


class _CountingProvider:
    model_name = "mock-embedding-3d"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def get_text_embedding(self, text: str) -> tuple[float, ...]:
        self.calls.append(text)
        return (1.0, 2.0, 3.0)


class EmbeddingCacheTest(unittest.TestCase):
    def test_cache_miss_calls_provider_and_writes_value(self) -> None:
        object_store = _FakeObjectStore()
        provider = _CountingProvider()
        stats = EmbeddingCacheStats()
        model = CacheAwareEmbeddingModel(
            provider_model=provider,
            cache=_cache(object_store),
            stats=stats,
        )

        self.assertEqual(model.get_text_embedding("hello"), (1.0, 2.0, 3.0))

        self.assertEqual(provider.calls, ["hello"])
        self.assertEqual(stats.miss_count, 1)
        self.assertEqual(stats.provider_call_count, 1)
        self.assertEqual(stats.write_count, 1)
        self.assertEqual(len(object_store.objects), 1)

    def test_cache_hit_avoids_provider_call(self) -> None:
        object_store = _FakeObjectStore()
        provider = _CountingProvider()
        stats = EmbeddingCacheStats()
        model = CacheAwareEmbeddingModel(
            provider_model=provider,
            cache=_cache(object_store),
            stats=stats,
        )

        first = model.get_text_embedding("hello")
        second = model.get_text_embedding("hello")

        self.assertEqual(first, second)
        self.assertEqual(provider.calls, ["hello"])
        self.assertEqual(stats.hit_count, 1)

    def test_cache_rejects_dimension_mismatch(self) -> None:
        object_store = _FakeObjectStore()
        cache = _cache(object_store)
        cache.put("hello", (1.0, 2.0, 3.0))
        key = next(iter(object_store.objects))
        payload = json.loads(object_store.objects[key].decode("utf-8"))
        payload["vector"] = [1.0, 2.0]
        object_store.objects[key] = json.dumps(payload).encode("utf-8")

        with self.assertRaisesRegex(ValueError, "vector dimensions mismatch"):
            cache.get("hello")


def _cache(object_store: _FakeObjectStore) -> ObjectStoreEmbeddingCache:
    return ObjectStoreEmbeddingCache(
        object_store=object_store,
        bucket="campus-agent-derived",
        settings=EmbeddingSettings(provider="mock", model="mock-embedding-3d", dimensions=3),
        profile_identity="regulations/student_rules|cleaning=v1|chunk=v1",
    )


if __name__ == "__main__":
    unittest.main()
