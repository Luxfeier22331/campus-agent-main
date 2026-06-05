from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol


class _SourceObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class _DerivedObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class _TransportProjectionObjectStore(_SourceObjectStore, _DerivedObjectStore, Protocol):
    pass


class _StructuredProjectionPublisher(Protocol):
    def publish_release(
        self,
        *,
        corpus: str,
        collection: str,
        release_id: str,
        generated_at: str,
        schema_version: str,
        artifact_object_key: str,
        artifact_checksum: str,
        bundle: Mapping[str, Any],
        validation_status: str,
        promote_current: bool = True,
    ) -> object: ...


class _ProjectionReleaseReport(Protocol):
    release_id: str
    release_object_key: str
