from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path

from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.registry import _document_record_from_dict, _raw_asset_record_from_dict


class InMemoryDocumentRegistry:
    def __init__(
        self,
        records: tuple[DocumentRegistryRecord, ...] | Path = (),
        backing_path: Path | None = None,
    ) -> None:
        if isinstance(records, Path):
            backing_path = records
            records = ()
        self._records: dict[tuple[str, str, str], DocumentRegistryRecord] = {
            (record.document_id, record.revision_track, record.version_id): record
            for record in records
        }
        self.backing_path = Path(backing_path) if backing_path is not None else None
        self._sync_backing_path()

    @classmethod
    def from_json_file(cls, path: Path) -> InMemoryDocumentRegistry:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        records = tuple(_document_record_from_dict(raw) for raw in payload.values())
        return cls(records, backing_path=Path(path))

    def get(
        self,
        document_id: str,
        revision_track: str,
        version_id: str,
    ) -> DocumentRegistryRecord | None:
        return self._records.get((document_id, revision_track, version_id))

    def upsert(self, record: DocumentRegistryRecord) -> None:
        self._records[(record.document_id, record.revision_track, record.version_id)] = record
        self._sync_backing_path()

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None:
        for record in records:
            self._records[(record.document_id, record.revision_track, record.version_id)] = record
        self._sync_backing_path()

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]:
        return self.list_by_scope(corpus)

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        return tuple(
            sorted(
                (
                    record
                    for record in self._records.values()
                    if record.corpus == corpus and (collection is None or record.collection == collection)
                ),
                key=lambda record: (record.document_id, record.revision_track, record.version_id),
            )
        )

    def list_processed_object_keys_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[str, ...]:
        keys: list[str] = []
        for record in self.list_by_scope(corpus, collection):
            keys.extend(str(key) for key in record.processed_object_keys if key)
        return tuple(keys)

    def list_importable_scope_records_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        return self.list_by_scope(corpus, collection)

    def latest_versions(
        self,
        document_id: str,
        revision_track: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        records = [
            record
            for record in self._records.values()
            if record.document_id == document_id
            and (revision_track is None or record.revision_track == revision_track)
        ]
        if not records:
            return ()
        return (max(records, key=lambda record: record.ingestion_timestamp),)

    def current_version(
        self,
        document_id: str,
        preferred_revision_tracks: tuple[str, ...] = (),
    ) -> DocumentRegistryRecord | None:
        records = [record for record in self._records.values() if record.document_id == document_id]
        if not records:
            return None
        current_records = [record for record in records if record.is_current]
        for revision_track in preferred_revision_tracks:
            matching = [record for record in current_records if record.revision_track == revision_track]
            if matching:
                return max(matching, key=lambda record: record.ingestion_timestamp)
        if current_records:
            return max(current_records, key=lambda record: record.ingestion_timestamp)
        return None

    def delete_document(self, document_id: str) -> None:
        self._records = {
            key: value for key, value in self._records.items() if value.document_id != document_id
        }
        self._sync_backing_path()

    def delete_by_corpus(self, corpus: str) -> None:
        self.delete_by_scope(corpus)

    def delete_by_scope(self, corpus: str, collection: str | None = None) -> None:
        self._records = {
            key: value
            for key, value in self._records.items()
            if value.corpus != corpus or (collection is not None and value.collection != collection)
        }
        self._sync_backing_path()

    def replace_scope(
        self,
        corpus: str,
        collection: str | None,
        records: tuple[DocumentRegistryRecord, ...],
    ) -> None:
        self._records = {
            key: value
            for key, value in self._records.items()
            if value.corpus != corpus or (collection is not None and value.collection != collection)
        }
        for record in records:
            self._records[(record.document_id, record.revision_track, record.version_id)] = record
        self._sync_backing_path()

    def _sync_backing_path(self) -> None:
        if self.backing_path is None:
            return
        if not self._records:
            if self.backing_path.exists():
                self.backing_path.unlink()
            return
        self.backing_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            f"{record.document_id}::{record.revision_track}::{record.version_id}": asdict(record)
            for record in sorted(
                self._records.values(),
                key=lambda record: (record.document_id, record.revision_track, record.version_id),
            )
        }
        self.backing_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )


class InMemoryRawAssetRegistry:
    def __init__(
        self,
        records: tuple[RawAssetRecord, ...] | Path = (),
        backing_path: Path | None = None,
    ) -> None:
        if isinstance(records, Path):
            backing_path = records
            records = ()
        self._records: dict[tuple[str, str], RawAssetRecord] = {
            (record.raw_asset_id, record.raw_version_id): record for record in records
        }
        self.backing_path = Path(backing_path) if backing_path is not None else None
        self._sync_backing_path()

    @classmethod
    def from_json_file(cls, path: Path) -> InMemoryRawAssetRegistry:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        records = tuple(_raw_asset_record_from_dict(raw) for raw in payload.values())
        return cls(records, backing_path=Path(path))

    def ensure_exists(self) -> None:
        self._sync_backing_path()

    def get(self, raw_asset_id: str, raw_version_id: str) -> RawAssetRecord | None:
        return self._records.get((raw_asset_id, raw_version_id))

    def upsert(self, record: RawAssetRecord) -> None:
        self._records[(record.raw_asset_id, record.raw_version_id)] = record
        self._sync_backing_path()

    def upsert_many(self, records: tuple[RawAssetRecord, ...]) -> None:
        for record in records:
            self._records[(record.raw_asset_id, record.raw_version_id)] = record
        self._sync_backing_path()

    def list_by_corpus(self, corpus: str) -> tuple[RawAssetRecord, ...]:
        return self.list_by_scope(corpus)

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[RawAssetRecord, ...]:
        return tuple(
            sorted(
                (
                    record
                    for record in self._records.values()
                    if record.corpus == corpus and (collection is None or record.collection == collection)
                ),
                key=lambda record: (record.raw_asset_id, record.raw_version_id),
            )
        )

    def delete_by_corpus(self, corpus: str) -> None:
        self.delete_by_scope(corpus)

    def delete_by_scope(self, corpus: str, collection: str | None = None) -> None:
        self._records = {
            key: value
            for key, value in self._records.items()
            if value.corpus != corpus or (collection is not None and value.collection != collection)
        }
        self._sync_backing_path()

    def _sync_backing_path(self) -> None:
        if self.backing_path is None:
            return
        if not self._records:
            if self.backing_path.exists():
                self.backing_path.unlink()
            return
        self.backing_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            f"{record.raw_asset_id}::{record.raw_version_id}": asdict(record)
            for record in sorted(
                self._records.values(),
                key=lambda record: (record.raw_asset_id, record.raw_version_id),
            )
        }
        self.backing_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
