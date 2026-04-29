from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Callable

from campus_ingestion_core.models import DocumentRegistryRecord


def get_registry_record(
    backend,
    document_id: str,
    revision_track: str,
    version_id: str,
) -> DocumentRegistryRecord | None:
    key = (document_id, revision_track, version_id)
    return get_cached_registry_lookup(
        backend,
        cache=backend._registry_record_cache,
        key=key,
        loader=lambda: backend.registry.get(document_id, revision_track, version_id),
    )


def get_current_registry_version(
    backend,
    document_id: str,
    *,
    preferred_revision_tracks: tuple[str, ...] = (),
) -> DocumentRegistryRecord | None:
    key = (document_id, preferred_revision_tracks)
    return get_cached_registry_lookup(
        backend,
        cache=backend._registry_current_version_cache,
        key=key,
        loader=lambda: backend.registry.current_version(
            document_id,
            preferred_revision_tracks=preferred_revision_tracks,
        ),
    )


def get_cached_registry_lookup(
    backend,
    *,
    cache: OrderedDict[object, tuple[float, DocumentRegistryRecord | None]],
    key: object,
    loader: Callable[[], DocumentRegistryRecord | None],
) -> DocumentRegistryRecord | None:
    if backend.registry_lookup_cache_ttl_seconds <= 0:
        return loader()
    now = time.monotonic()
    with backend._registry_cache_lock:
        cached = cache.get(key)
        if cached is not None:
            expires_at, record = cached
            if expires_at > now:
                cache.move_to_end(key)
                return record
            cache.pop(key, None)
    record = loader()
    with backend._registry_cache_lock:
        cache[key] = (now + backend.registry_lookup_cache_ttl_seconds, record)
        cache.move_to_end(key)
        while len(cache) > backend.registry_lookup_cache_max_entries:
            cache.popitem(last=False)
    return record


__all__ = [
    "get_current_registry_version",
    "get_registry_record",
]
