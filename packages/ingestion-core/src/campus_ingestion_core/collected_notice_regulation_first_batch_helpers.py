from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any


def _document_source_refs(document: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    refs: list[Mapping[str, Any]] = []
    refs.extend(ref for ref in _mapping_rows(document.get("source_object_refs")))
    refs.extend(_owner_text_refs(document))
    return refs


def _owner_text_refs(document: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    recovery = document.get("owner_text_recovery")
    if not isinstance(recovery, Mapping):
        return []
    written_refs = recovery.get("written_refs")
    if not isinstance(written_refs, Mapping):
        return []
    return [dict(ref) for ref in written_refs.values() if isinstance(ref, Mapping)]


def _unique_object_refs(refs: Sequence[Mapping[str, Any]]) -> tuple[Mapping[str, Any], ...]:
    by_key: dict[tuple[str, str], Mapping[str, Any]] = {}
    for ref in refs:
        bucket = str(ref.get("bucket") or "").strip()
        key = str(ref.get("key") or "").strip()
        if bucket and key:
            by_key[(bucket, key)] = ref
    return tuple(by_key[key] for key in sorted(by_key))


def _materialized_source_notice_ids(
    documents_by_collection: Mapping[str, Sequence[Mapping[str, Any]]],
) -> tuple[str, ...]:
    return _normalize_notice_ids(
        str(source_notice_id)
        for documents in documents_by_collection.values()
        for document in documents
        for source_notice_id in document.get("source_notice_ids") or ()
    )


def _selection_notice_ids(selection: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(str(entry["source_notice_id"]) for entry in _selection_entries(selection))


def _selection_target_document_ids(selection: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(str(entry["target_document_id"]) for entry in _selection_entries(selection))


def _selection_entries(selection: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    return tuple(_mapping_rows(selection.get("entries")))


def _index_candidates_by_notice(candidate_audit: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    rows = tuple(_mapping_rows(candidate_audit.get("candidates")))
    indexed = {
        str(row.get("source_notice_id") or "").strip(): row
        for row in rows
        if str(row.get("source_notice_id") or "").strip()
    }
    if len(indexed) != len(rows):
        raise ValueError("candidate audit contains duplicate or missing source_notice_id")
    return indexed


def _blocked_counts(candidate_audit: Mapping[str, Any]) -> dict[str, int]:
    counts = Counter(
        str(row.get("regulation_admission_class") or row.get("consumption_class") or "")
        for row in _mapping_rows(candidate_audit.get("candidates"))
    )
    return {
        key: counts.get(key, 0)
        for key in ("manual_review", "needs_multimodal")
        if counts.get(key, 0)
    }


def _mapping_rows(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _normalize_notice_ids(values: Sequence[str] | Any) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _flatten_stats_ids(stats_by_collection: Mapping[str, Mapping[str, Any]], key: str) -> list[str]:
    return sorted(
        {
            str(item)
            for stats in stats_by_collection.values()
            for item in list(stats.get(key) or ())
            if str(item)
        }
    )


def _required_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    return value.strip()


def _read_embedding_model_name(env: Mapping[str, str]) -> str:
    return (
        str(env.get("EMBEDDING_MODEL") or env.get("INGESTION_EMBEDDING_MODEL") or "").strip()
        or "Qwen3-Embedding-4B"
    )


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)
