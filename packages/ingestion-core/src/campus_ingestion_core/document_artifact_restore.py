from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.models import DocumentRegistryRecord


class DocumentArtifactRestoreObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class DocumentArtifactRestoreReport:
    bucket: str
    record_count: int
    planned_restore_count: int
    restored_count: int
    skipped_existing_count: int
    missing_source_count: int
    execute: bool
    restored_object_keys: tuple[str, ...]
    skipped_existing_object_keys: tuple[str, ...]
    missing_source_object_keys: tuple[str, ...]
    source_artifact_paths: tuple[str, ...]


def restore_document_units_artifacts_from_local_evidence(
    *,
    bucket: str,
    evidence_roots: Sequence[Path | str],
    object_store: DocumentArtifactRestoreObjectStore,
    records: Sequence[DocumentRegistryRecord],
    execute: bool = False,
) -> DocumentArtifactRestoreReport:
    evidence_index = _build_document_units_evidence_index(evidence_roots)
    restore_candidates: list[tuple[DocumentRegistryRecord, Path]] = []
    skipped_existing_object_keys: list[str] = []
    missing_source_object_keys: list[str] = []

    for record in records:
        document_units_key = (record.document_units_object_key or "").strip()
        if not document_units_key:
            missing_source_object_keys.append(record.document_id)
            continue
        if _object_exists(object_store=object_store, bucket=bucket, key=document_units_key):
            skipped_existing_object_keys.append(document_units_key)
            continue
        source_path = _select_source_artifact_path(
            document_units_object_key=document_units_key,
            paths=evidence_index.get(_record_key(record), ()),
        )
        if source_path is None:
            missing_source_object_keys.append(document_units_key)
            continue
        restore_candidates.append((record, source_path))

    if missing_source_object_keys:
        examples = "; ".join(missing_source_object_keys[:8])
        raise ValueError(
            "missing local document-units evidence for "
            f"{len(missing_source_object_keys)} records: {examples}"
        )

    restored_object_keys: list[str] = []
    source_artifact_paths: list[str] = []
    if execute:
        for record, source_path in restore_candidates:
            document_units_key = str(record.document_units_object_key or "")
            object_store.put_bytes(
                bucket=bucket,
                key=document_units_key,
                data=source_path.read_bytes(),
                content_type="application/x-ndjson",
            )
            restored_object_keys.append(document_units_key)
            source_artifact_paths.append(str(source_path))
    else:
        restored_object_keys = []
        source_artifact_paths = [str(source_path) for _, source_path in restore_candidates]

    return DocumentArtifactRestoreReport(
        bucket=bucket,
        record_count=len(records),
        planned_restore_count=len(restore_candidates),
        restored_count=len(restored_object_keys),
        skipped_existing_count=len(skipped_existing_object_keys),
        missing_source_count=len(missing_source_object_keys),
        execute=execute,
        restored_object_keys=tuple(restored_object_keys),
        skipped_existing_object_keys=tuple(skipped_existing_object_keys),
        missing_source_object_keys=tuple(missing_source_object_keys),
        source_artifact_paths=tuple(source_artifact_paths),
    )


def _build_document_units_evidence_index(
    evidence_roots: Sequence[Path | str],
) -> dict[tuple[str, str], tuple[Path, ...]]:
    index: dict[tuple[str, str], list[Path]] = {}
    for raw_root in evidence_roots:
        root = Path(raw_root)
        if not root.exists():
            continue
        for path in sorted(root.rglob("document-units.jsonl")):
            key = _read_document_units_key(path)
            if key is None:
                continue
            index.setdefault(key, []).append(path)
    return {key: tuple(paths) for key, paths in index.items()}


def _read_document_units_key(path: Path) -> tuple[str, str] | None:
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, Mapping):
            return None
        doc_id = str(payload.get("doc_id") or "").strip()
        version_id = str(payload.get("version_id") or "").strip()
        if not doc_id or not version_id:
            return None
        return (doc_id, version_id)
    return None


def _select_source_artifact_path(
    *,
    document_units_object_key: str,
    paths: Sequence[Path],
) -> Path | None:
    if not paths:
        return None
    exact_suffix = Path(document_units_object_key)
    object_store_matches = tuple(
        path
        for path in paths
        if _path_has_object_store_suffix(path=path, suffix=exact_suffix)
    )
    if object_store_matches:
        return sorted(object_store_matches, key=lambda item: len(str(item)))[0]
    return sorted(paths, key=lambda item: str(item))[0]


def _path_has_object_store_suffix(*, path: Path, suffix: Path) -> bool:
    path_parts = path.parts
    suffix_parts = suffix.parts
    if len(path_parts) < len(suffix_parts):
        return False
    return path_parts[-len(suffix_parts) :] == suffix_parts


def _object_exists(
    *,
    object_store: DocumentArtifactRestoreObjectStore,
    bucket: str,
    key: str,
) -> bool:
    try:
        object_store.get_bytes(bucket=bucket, key=key)
    except Exception:
        return False
    return True


def _record_key(record: DocumentRegistryRecord) -> tuple[str, str]:
    return (record.document_id, record.version_id)


__all__ = [
    "DocumentArtifactRestoreObjectStore",
    "DocumentArtifactRestoreReport",
    "restore_document_units_artifacts_from_local_evidence",
]
