from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass, field
from threading import RLock
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.python_db_runtime import raise_python_db_runtime_retired
from campus_ingestion_core.scope_catalog import assert_known_scope

DEFAULT_FILE_RELEASE_INVENTORY_SCHEMA = "ingestion_projection"
DEFAULT_FILE_RELEASE_INVENTORY_TABLE = (
    f"{DEFAULT_FILE_RELEASE_INVENTORY_SCHEMA}.authenticated_notice_file_release_inventory"
)
DEFAULT_FILE_RELEASE_INVENTORY_ENV_KEY = "AUTHENTICATED_NOTICE_FILE_RELEASE_INVENTORY_DATABASE_URL"
DEFAULT_FILE_RELEASE_INVENTORY_OPERATOR_ENV_KEY = (
    "AUTHENTICATED_NOTICE_FILE_RELEASE_INVENTORY_OPERATOR_DATABASE_URL"
)
DEFAULT_FILE_RELEASE_INVENTORY_SCAN_PAGE_SIZE = 256
DEFAULT_FILE_RELEASE_INVENTORY_CORPUS = "campus_notices"
DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION = "file_release_capture"


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeFileReleaseInventoryEntry:
    corpus: str
    collection: str
    file_release_id: int
    site_id: str
    export_scope: str
    collector_contract_version: str
    source_home_url: str
    filename: str
    upfilename: str | None
    filecode: str | None
    filetime: str | None
    filedepartment: str | None
    explain_department: str | None
    file_type_id: int | None
    file_type_name: str | None
    resolved_download_url: str | None
    released_file_storage_provider: str | None
    released_file_bucket: str | None
    released_file_object_key: str | None
    released_file_sha256: str | None
    released_file_byte_size: int | None
    released_file_ingest_status: str | None
    released_file_provenance_status: str | None
    updated_at: str = field(default_factory=utc_now)
    record: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        assert_known_scope(self.corpus, self.collection)
        if int(self.file_release_id) <= 0:
            raise ValueError("file_release_id must be greater than zero")
        for label, value in (
            ("site_id", self.site_id),
            ("export_scope", self.export_scope),
            ("collector_contract_version", self.collector_contract_version),
            ("source_home_url", self.source_home_url),
            ("filename", self.filename),
            ("updated_at", self.updated_at),
        ):
            if not str(value).strip():
                raise ValueError(f"{label} is required")
        if not isinstance(self.record, dict):
            raise ValueError("record must be a dict")

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> AuthenticatedNoticeFileReleaseInventoryEntry:
        raw = dict(payload)
        raw["file_release_id"] = int(raw["file_release_id"])
        raw["file_type_id"] = _optional_int(raw.get("file_type_id"))
        raw["released_file_byte_size"] = _optional_int(raw.get("released_file_byte_size"))
        raw["record"] = dict(raw.get("record") or {})
        return cls(**raw)


class AuthenticatedNoticeFileReleaseInventoryStore(Protocol):
    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None: ...

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None: ...

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        file_release_ids: Sequence[int | str] = (),
    ) -> tuple[AuthenticatedNoticeFileReleaseInventoryEntry, ...]: ...


class InMemoryAuthenticatedNoticeFileReleaseInventoryStore:
    def __init__(self) -> None:
        self._entries: dict[tuple[str, str, int], AuthenticatedNoticeFileReleaseInventoryEntry] = {}
        self._lock = RLock()

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None:
        with self._lock:
            for record in records:
                self._entries[(record.corpus, record.collection, record.file_release_id)] = record

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    ) -> None:
        with self._lock:
            self._entries = {
                key: value
                for key, value in self._entries.items()
                if key[:2] != (corpus, collection)
            }
            for record in records:
                self._entries[(record.corpus, record.collection, record.file_release_id)] = record

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        file_release_ids: Sequence[int | str] = (),
    ) -> tuple[AuthenticatedNoticeFileReleaseInventoryEntry, ...]:
        selected_ids = {int(str(item).strip()) for item in file_release_ids if str(item).strip()}
        with self._lock:
            return tuple(
                sorted(
                    (
                        record
                        for record in self._entries.values()
                        if record.corpus == corpus
                        and record.collection == collection
                        and (not selected_ids or record.file_release_id in selected_ids)
                    ),
                    key=lambda record: record.file_release_id,
                )
            )


def build_authenticated_notice_file_release_inventory_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> AuthenticatedNoticeFileReleaseInventoryStore:
    del env, prefer_operator
    if os.environ:
        pass
    raise_python_db_runtime_retired("authenticated notice file release inventory")


def _optional_int(value: object) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


__all__ = [
    "DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION",
    "DEFAULT_FILE_RELEASE_INVENTORY_CORPUS",
    "DEFAULT_FILE_RELEASE_INVENTORY_ENV_KEY",
    "DEFAULT_FILE_RELEASE_INVENTORY_OPERATOR_ENV_KEY",
    "DEFAULT_FILE_RELEASE_INVENTORY_SCAN_PAGE_SIZE",
    "DEFAULT_FILE_RELEASE_INVENTORY_SCHEMA",
    "DEFAULT_FILE_RELEASE_INVENTORY_TABLE",
    "AuthenticatedNoticeFileReleaseInventoryEntry",
    "AuthenticatedNoticeFileReleaseInventoryStore",
    "InMemoryAuthenticatedNoticeFileReleaseInventoryStore",
    "build_authenticated_notice_file_release_inventory_store_from_env",
]
