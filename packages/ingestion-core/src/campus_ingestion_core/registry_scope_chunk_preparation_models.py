from __future__ import annotations

from typing import Protocol

REGISTRY_SCOPE_CHUNK_PREPARATION_OPERATION = "registry-scope-chunk-preparation"


class RegistryScopePreparationObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


__all__ = [
    "REGISTRY_SCOPE_CHUNK_PREPARATION_OPERATION",
    "RegistryScopePreparationObjectStore",
]
