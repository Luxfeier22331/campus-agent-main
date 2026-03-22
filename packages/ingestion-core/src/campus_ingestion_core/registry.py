from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Protocol

from campus_ingestion_core.models import DocumentRegistryRecord


class DocumentRegistry(Protocol):
    def get(self, document_id: str, version_id: str) -> DocumentRegistryRecord | None: ...

    def upsert(self, record: DocumentRegistryRecord) -> None: ...

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]: ...

    def latest_versions(self, document_id: str) -> tuple[DocumentRegistryRecord, ...]: ...


class FileDocumentRegistry:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def get(self, document_id: str, version_id: str) -> DocumentRegistryRecord | None:
        payload = self._load()
        raw = payload.get(self._make_key(document_id, version_id))
        if raw is None:
            return None
        return self._record_from_dict(raw)

    def upsert(self, record: DocumentRegistryRecord) -> None:
        payload = self._load()
        payload[self._make_key(record.document_id, record.version_id)] = asdict(record)
        self._store(payload)

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]:
        records = [
            self._record_from_dict(raw)
            for raw in self._load().values()
            if raw.get("corpus") == corpus
        ]
        return tuple(sorted(records, key=lambda record: (record.document_id, record.version_id)))

    def latest_versions(self, document_id: str) -> tuple[DocumentRegistryRecord, ...]:
        records = [
            self._record_from_dict(raw)
            for raw in self._load().values()
            if raw.get("document_id") == document_id
        ]
        if not records:
            return ()
        latest = max(records, key=lambda record: record.ingestion_timestamp)
        return (latest,)

    def _load(self) -> dict[str, dict[str, object]]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _store(self, payload: dict[str, dict[str, object]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=self.path.parent,
            delete=False,
        ) as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            temp_path = Path(handle.name)
        temp_path.replace(self.path)

    @staticmethod
    def _make_key(document_id: str, version_id: str) -> str:
        return f"{document_id}::{version_id}"

    @staticmethod
    def _record_from_dict(raw: dict[str, object]) -> DocumentRegistryRecord:
        processed_object_keys = tuple(str(item) for item in list(raw.get("processed_object_keys") or []))
        provider_result_object_key = (
            str(raw["provider_result_object_key"])
            if raw.get("provider_result_object_key") is not None
            else _find_processed_artifact(processed_object_keys, "provider-result.jsonl")
        )
        structured_object_key = (
            str(raw["structured_object_key"])
            if raw.get("structured_object_key") is not None
            else _find_processed_artifact(processed_object_keys, "structured.jsonl")
        )
        return DocumentRegistryRecord(
            document_id=str(raw["document_id"]),
            version_id=str(raw["version_id"]),
            source_uri=str(raw["source_uri"]),
            content_hash=str(raw["content_hash"]),
            corpus=str(raw["corpus"]),
            acl_groups=tuple(str(item) for item in list(raw.get("acl_groups") or [])),
            campus_scope=str(raw["campus_scope"]) if raw.get("campus_scope") is not None else None,
            status=str(raw["status"]),
            ingestion_timestamp=str(raw["ingestion_timestamp"]),
            parser_version=str(raw["parser_version"]),
            embedding_model=str(raw.get("embedding_model") or ""),
            raw_object_key=str(raw["raw_object_key"]) if raw.get("raw_object_key") is not None else None,
            raw_content_hash=(
                str(raw["raw_content_hash"]) if raw.get("raw_content_hash") is not None else None
            ),
            raw_source_filename=(
                str(raw["raw_source_filename"])
                if raw.get("raw_source_filename") is not None
                else None
            ),
            raw_page_start=int(raw["raw_page_start"]) if raw.get("raw_page_start") is not None else None,
            raw_page_end=int(raw["raw_page_end"]) if raw.get("raw_page_end") is not None else None,
            structured_object_key=structured_object_key,
            provider_result_object_key=provider_result_object_key,
            processed_object_keys=processed_object_keys,
            import_source=str(raw["import_source"]),
        )


def _find_processed_artifact(processed_object_keys: tuple[str, ...], filename: str) -> str | None:
    for key in processed_object_keys:
        if key.endswith(f"/{filename}"):
            return key
    return None
