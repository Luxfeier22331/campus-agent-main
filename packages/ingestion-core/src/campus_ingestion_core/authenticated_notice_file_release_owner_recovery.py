from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    AuthenticatedNoticeFileReleaseInventoryEntry,
    AuthenticatedNoticeFileReleaseInventoryStore,
)

_FILE_RELEASE_EXPORT_SCHEMA_VERSION = "authenticated_notice_file_release_export_v1"
_FILE_EXTENSION_RE = re.compile(
    r"\.(pdf|doc|docx|wps|xls|xlsx|csv|ppt|pptx|txt|rtf|zip|rar|7z|jpg|jpeg|png)$",
    re.IGNORECASE,
)
_MATCH_NORMALIZE_RE = re.compile(r"[\s《》“”\"'‘’()（）【】\[\]：:、，,。.;；·\-—_<>]+")


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeFileReleaseExport:
    bundle_records: tuple[dict[str, Any], ...]
    export_manifest: dict[str, Any] | None
    export_scope: str | None
    site_id: str | None
    source_home_url: str | None
    collector_contract_version: str | None


@dataclass(frozen=True, slots=True)
class FileReleaseResolvedFile:
    storage_provider: str | None
    bucket: str | None
    object_key: str | None
    sha256: str | None
    byte_size: int | None
    ingest_status: str | None
    provenance_status: str | None
    local_path: str | None
    source_url: str | None
    final_url: str | None
    original_filename: str | None


@dataclass(frozen=True, slots=True)
class FileReleaseOwnerRecoveryMatch:
    file_release_id: int
    match_score: int
    match_strategy: str
    matched_title: str
    filename: str
    upfilename: str | None
    filecode: str | None
    filedepartment: str | None
    explain_department: str | None
    resolved_download_url: str | None
    released_file: FileReleaseResolvedFile


@dataclass(frozen=True, slots=True)
class FileReleaseOwnerRecoveryReadinessReport:
    owner_title_hint: str
    owner_kind: str
    relation_type: str | None
    status: str
    reason: str | None
    export_scope: str | None
    site_id: str | None
    collector_contract_version: str | None
    match_count: int
    selected_match: FileReleaseOwnerRecoveryMatch | None
    ambiguous_file_release_ids: tuple[int, ...]


def load_authenticated_notice_file_release_export(
    *,
    bundle_path: Path,
    manifest_path: Path | None = None,
) -> AuthenticatedNoticeFileReleaseExport:
    raw_bundle = json.loads(Path(bundle_path).read_text(encoding="utf-8"))
    if not isinstance(raw_bundle, list):
        raise ValueError("file-release bundle must be a JSON array")
    bundle_records = tuple(_as_record(item) for item in raw_bundle)

    export_manifest: dict[str, Any] | None = None
    if manifest_path is not None:
        export_manifest = _as_record(json.loads(Path(manifest_path).read_text(encoding="utf-8")))
        schema_version = _optional_text(export_manifest.get("schema_version"))
        if schema_version != _FILE_RELEASE_EXPORT_SCHEMA_VERSION:
            raise ValueError(
                "file-release manifest schema_version must be "
                f"{_FILE_RELEASE_EXPORT_SCHEMA_VERSION}"
            )

    collector = _as_record((export_manifest or {}).get("collector"))
    return AuthenticatedNoticeFileReleaseExport(
        bundle_records=bundle_records,
        export_manifest=export_manifest,
        export_scope=_optional_text((export_manifest or {}).get("export_scope")),
        site_id=_optional_text((export_manifest or {}).get("site_id")),
        source_home_url=_optional_text((export_manifest or {}).get("source_home_url")),
        collector_contract_version=_optional_text(collector.get("export_contract_version")),
    )


def resolve_file_release_owner_recovery_readiness(
    *,
    owner_title_hint: str,
    bundle_records: Sequence[Mapping[str, object]],
    export_manifest: Mapping[str, object] | None = None,
    owner_kind: str = "file_release_document",
    relation_type: str | None = "file_release_ref",
) -> FileReleaseOwnerRecoveryReadinessReport:
    title_hint = owner_title_hint.strip()
    if not title_hint:
        raise ValueError("owner_title_hint is required")
    normalized_title_hint = _normalize_title_for_match(title_hint)
    if not normalized_title_hint:
        raise ValueError("owner_title_hint must contain matchable text")

    matches = tuple(
        candidate
        for raw_record in bundle_records
        if (candidate := _match_file_release_record(raw_record, normalized_title_hint)) is not None
    )
    collector = _as_record((export_manifest or {}).get("collector"))
    base_kwargs = {
        "owner_title_hint": title_hint,
        "owner_kind": owner_kind,
        "relation_type": relation_type,
        "export_scope": _optional_text((export_manifest or {}).get("export_scope")),
        "site_id": _optional_text((export_manifest or {}).get("site_id")),
        "collector_contract_version": _optional_text(collector.get("export_contract_version")),
    }
    if not matches:
        return FileReleaseOwnerRecoveryReadinessReport(
            status="missing_capture",
            reason="file_release_capture_missing",
            match_count=0,
            selected_match=None,
            ambiguous_file_release_ids=(),
            **base_kwargs,
        )

    best_score = max(item.match_score for item in matches)
    best_matches = tuple(item for item in matches if item.match_score == best_score)
    if len(best_matches) != 1:
        return FileReleaseOwnerRecoveryReadinessReport(
            status="ambiguous_match",
            reason="file_release_match_ambiguous",
            match_count=len(best_matches),
            selected_match=None,
            ambiguous_file_release_ids=tuple(sorted(item.file_release_id for item in best_matches)),
            **base_kwargs,
        )

    selected_match = best_matches[0]
    if not _released_file_has_recoverable_source(selected_match.released_file):
        return FileReleaseOwnerRecoveryReadinessReport(
            status="missing_source_bytes",
            reason="file_release_source_bytes_missing",
            match_count=1,
            selected_match=selected_match,
            ambiguous_file_release_ids=(),
            **base_kwargs,
        )

    return FileReleaseOwnerRecoveryReadinessReport(
        status="ready",
        reason=None,
        match_count=1,
        selected_match=selected_match,
        ambiguous_file_release_ids=(),
        **base_kwargs,
    )


def resolve_file_release_owner_recovery_readiness_from_inventory_entries(
    *,
    owner_title_hint: str,
    inventory_entries: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
    owner_kind: str = "file_release_document",
    relation_type: str | None = "file_release_ref",
) -> FileReleaseOwnerRecoveryReadinessReport:
    entries = tuple(inventory_entries)
    return resolve_file_release_owner_recovery_readiness(
        owner_title_hint=owner_title_hint,
        bundle_records=tuple(
            inventory_entry_to_file_release_bundle_record(entry) for entry in entries
        ),
        export_manifest=_inventory_entries_export_manifest(entries),
        owner_kind=owner_kind,
        relation_type=relation_type,
    )


def resolve_file_release_owner_recovery_readiness_from_inventory_store(
    *,
    owner_title_hint: str,
    inventory_store: AuthenticatedNoticeFileReleaseInventoryStore,
    corpus: str,
    collection: str,
    owner_kind: str = "file_release_document",
    relation_type: str | None = "file_release_ref",
    file_release_ids: Sequence[int | str] = (),
) -> FileReleaseOwnerRecoveryReadinessReport:
    return resolve_file_release_owner_recovery_readiness_from_inventory_entries(
        owner_title_hint=owner_title_hint,
        inventory_entries=inventory_store.list_by_scope(
            corpus,
            collection,
            file_release_ids=file_release_ids,
        ),
        owner_kind=owner_kind,
        relation_type=relation_type,
    )


def inventory_entry_to_file_release_bundle_record(
    entry: AuthenticatedNoticeFileReleaseInventoryEntry,
) -> dict[str, Any]:
    payload = dict(entry.record or {})
    file_release = _as_record(payload.get("file_release"))
    released_file = _as_record(payload.get("released_file"))
    if file_release and released_file and "file_release_id" in payload:
        return {
            "file_release_id": _required_int(payload.get("file_release_id")),
            "file_release": file_release,
            "released_file": released_file,
        }
    return {
        "file_release_id": entry.file_release_id,
        "file_release": {
            "filename": entry.filename,
            "upfilename": entry.upfilename,
            "filecode": entry.filecode,
            "filetime": entry.filetime,
            "filedepartment": entry.filedepartment,
            "explain_department": entry.explain_department,
            "file_type_id": entry.file_type_id,
            "file_type_name": entry.file_type_name,
            "resolved_download_url": entry.resolved_download_url,
        },
        "released_file": {
            "storage_provider": entry.released_file_storage_provider,
            "bucket": entry.released_file_bucket,
            "object_key": entry.released_file_object_key,
            "sha256": entry.released_file_sha256,
            "byte_size": entry.released_file_byte_size,
            "ingest_status": entry.released_file_ingest_status,
            "provenance_status": entry.released_file_provenance_status,
            "original_filename": entry.filename,
        },
    }


def _match_file_release_record(
    raw_record: Mapping[str, object],
    normalized_title_hint: str,
) -> FileReleaseOwnerRecoveryMatch | None:
    record = _as_record(raw_record)
    file_release = _as_record(record.get("file_release"))
    released_file_payload = _as_record(record.get("released_file"))
    file_release_id = _required_int(record.get("file_release_id"))
    filename = _optional_text(file_release.get("filename"))
    if filename is None:
        raise ValueError(f"file_release {file_release_id} is missing filename")

    best_score = -1
    best_strategy: str | None = None
    best_title: str | None = None
    for raw_title in _title_candidates(
        file_release=file_release, released_file=released_file_payload
    ):
        normalized_candidate = _normalize_title_for_match(raw_title)
        if not normalized_candidate:
            continue
        match_score, match_strategy = _score_title_match(
            owner_title_hint=normalized_title_hint,
            candidate_title=normalized_candidate,
        )
        if match_score > best_score:
            best_score = match_score
            best_strategy = match_strategy
            best_title = raw_title
    if best_score < 0 or best_strategy is None or best_title is None:
        return None

    return FileReleaseOwnerRecoveryMatch(
        file_release_id=file_release_id,
        match_score=best_score,
        match_strategy=best_strategy,
        matched_title=best_title,
        filename=filename,
        upfilename=_optional_text(file_release.get("upfilename")),
        filecode=_optional_text(file_release.get("filecode")),
        filedepartment=_optional_text(file_release.get("filedepartment")),
        explain_department=_optional_text(file_release.get("explain_department")),
        resolved_download_url=_optional_text(file_release.get("resolved_download_url")),
        released_file=FileReleaseResolvedFile(
            storage_provider=_optional_text(released_file_payload.get("storage_provider")),
            bucket=_optional_text(released_file_payload.get("bucket")),
            object_key=_optional_text(released_file_payload.get("object_key")),
            sha256=_optional_text(released_file_payload.get("sha256")),
            byte_size=_optional_int(released_file_payload.get("byte_size")),
            ingest_status=_optional_text(released_file_payload.get("ingest_status")),
            provenance_status=_optional_text(released_file_payload.get("provenance_status")),
            local_path=_optional_text(released_file_payload.get("local_path")),
            source_url=_optional_text(released_file_payload.get("source_url")),
            final_url=_optional_text(released_file_payload.get("final_url")),
            original_filename=_optional_text(released_file_payload.get("original_filename")),
        ),
    )


def _title_candidates(
    *,
    file_release: Mapping[str, object],
    released_file: Mapping[str, object],
) -> tuple[str, ...]:
    values: list[str] = []
    for field_name in ("filename", "upfilename"):
        value = _optional_text(file_release.get(field_name))
        if value and value not in values:
            values.append(value)
    released_filename = _optional_text(released_file.get("original_filename"))
    if released_filename and released_filename not in values:
        values.append(released_filename)
    return tuple(values)


def _score_title_match(*, owner_title_hint: str, candidate_title: str) -> tuple[int, str | None]:
    if owner_title_hint == candidate_title:
        return (200, "exact_normalized_title")
    if owner_title_hint in candidate_title:
        return (100, "owner_hint_contained_in_candidate")
    if candidate_title in owner_title_hint:
        return (90, "candidate_contained_in_owner_hint")
    return (-1, None)


def _released_file_has_recoverable_source(released_file: FileReleaseResolvedFile) -> bool:
    if (
        released_file.storage_provider == "object_store"
        and released_file.bucket
        and released_file.object_key
        and released_file.sha256
    ):
        return True
    if released_file.storage_provider == "local" and released_file.local_path:
        return True
    return False


def _inventory_entries_export_manifest(
    entries: Sequence[AuthenticatedNoticeFileReleaseInventoryEntry],
) -> dict[str, object] | None:
    if not entries:
        return None
    first = entries[0]
    return {
        "export_scope": first.export_scope,
        "site_id": first.site_id,
        "source_home_url": first.source_home_url,
        "collector": {
            "export_contract_version": first.collector_contract_version,
        },
    }


def _normalize_title_for_match(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip()
    if not normalized:
        return ""
    normalized = _FILE_EXTENSION_RE.sub("", normalized).strip()
    normalized = _MATCH_NORMALIZE_RE.sub("", normalized)
    return normalized.strip().lower()


def _as_record(value: object) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("expected JSON object")
    return dict(value)


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _required_int(value: object) -> int:
    maybe_int = _optional_int(value)
    if maybe_int is None:
        raise ValueError("expected integer value")
    return maybe_int


def _optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    text = str(value).strip()
    if not text:
        return None
    return int(text)


__all__ = [
    "AuthenticatedNoticeFileReleaseExport",
    "FileReleaseOwnerRecoveryMatch",
    "FileReleaseOwnerRecoveryReadinessReport",
    "FileReleaseResolvedFile",
    "inventory_entry_to_file_release_bundle_record",
    "load_authenticated_notice_file_release_export",
    "resolve_file_release_owner_recovery_readiness",
    "resolve_file_release_owner_recovery_readiness_from_inventory_entries",
    "resolve_file_release_owner_recovery_readiness_from_inventory_store",
]
