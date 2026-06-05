from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_source_truth import (
    AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
)

AUTHENTICATED_NOTICE_LEGACY_NORMALIZED_SCHEMA = (
    "authenticated_notice_legacy_bootstrap_normalized_v1"
)
AUTHENTICATED_NOTICE_LEGACY_COLLECTOR_RUNTIME_SHELL = "legacy_external_collector"
AUTHENTICATED_NOTICE_LEGACY_EXPORT_CONTRACT_VERSION = "legacy_authenticated_notice_export_v3"


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeLegacyNormalizationResult:
    bundle_records: tuple[dict[str, Any], ...]
    normalized_manifest: dict[str, Any]
    selected_notice_ids: tuple[str, ...]
    missing_notice_ids: tuple[str, ...]


def normalize_authenticated_notice_legacy_export(
    *,
    bundle_records: Sequence[dict[str, Any]],
    legacy_manifest: dict[str, Any],
    site_id: str,
    source_home_url: str,
    selected_notice_ids: Sequence[str] = (),
    notice_type_policy: Sequence[dict[str, Any]] = (),
    export_scope: str | None = None,
    exported_at: str | None = None,
) -> AuthenticatedNoticeLegacyNormalizationResult:
    normalized_ids = tuple(
        dict.fromkeys(str(item).strip() for item in selected_notice_ids if str(item).strip())
    )
    selected_set = set(normalized_ids)
    normalized_records = tuple(
        dict(record)
        for record in bundle_records
        if not selected_set or _notice_id_for_record(record) in selected_set
    )
    selected_notice_type_ids = _notice_type_ids_for_records(normalized_records)
    found_ids = {_notice_id_for_record(record) for record in normalized_records}
    missing_notice_ids = tuple(
        notice_id for notice_id in normalized_ids if notice_id not in found_ids
    )
    exported_timestamp = exported_at or datetime.now(UTC).isoformat()
    normalized_manifest = build_authenticated_notice_legacy_normalized_manifest(
        legacy_manifest=legacy_manifest,
        site_id=site_id,
        source_home_url=source_home_url,
        notice_type_policy=notice_type_policy,
        selected_notice_type_ids=selected_notice_type_ids,
        selected_notice_ids=tuple(_notice_id_for_record(record) for record in normalized_records),
        filtered_notice_count=len(normalized_records),
        original_notice_count=len(tuple(bundle_records)),
        export_scope=export_scope,
        exported_at=exported_timestamp,
    )
    return AuthenticatedNoticeLegacyNormalizationResult(
        bundle_records=normalized_records,
        normalized_manifest=normalized_manifest,
        selected_notice_ids=tuple(_notice_id_for_record(record) for record in normalized_records),
        missing_notice_ids=missing_notice_ids,
    )


def build_authenticated_notice_legacy_normalized_manifest(
    *,
    legacy_manifest: dict[str, Any],
    site_id: str,
    source_home_url: str,
    notice_type_policy: Sequence[dict[str, Any]],
    selected_notice_type_ids: Sequence[str],
    selected_notice_ids: Sequence[str],
    filtered_notice_count: int,
    original_notice_count: int,
    export_scope: str | None,
    exported_at: str,
) -> dict[str, Any]:
    legacy = _require_legacy_manifest(legacy_manifest)
    legacy_run = dict(legacy.get("run") or {})
    legacy_counts = dict(legacy.get("counts") or {})
    filtered_notice_type_ids = tuple(
        dict.fromkeys(str(item).strip() for item in selected_notice_type_ids if str(item).strip())
    )
    selected_notice_type_policy = [
        dict(item)
        for item in notice_type_policy
        if str(item.get("type") or "").strip() in set(filtered_notice_type_ids)
    ]
    return {
        "schema_version": AUTHENTICATED_NOTICE_LEGACY_NORMALIZED_SCHEMA,
        "exported_at": exported_at,
        "export_date": _timestamp_label(exported_at)[:8],
        "export_scope": export_scope
        or _default_export_scope(
            legacy_manifest=legacy,
            filtered_notice_count=filtered_notice_count,
        ),
        "source_channel": AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        "site_id": site_id,
        "source_home_url": source_home_url,
        "collector": {
            "runtime_shell": AUTHENTICATED_NOTICE_LEGACY_COLLECTOR_RUNTIME_SHELL,
            "export_contract_version": AUTHENTICATED_NOTICE_LEGACY_EXPORT_CONTRACT_VERSION,
            "link_collection_mode": "legacy_bundle_preserved",
            "attachment_collection_mode": "legacy_bundle_preserved",
            "attachment_storage_mode": "blob_store_reference",
        },
        "filters": {
            "notice_types": list(filtered_notice_type_ids),
            "max_notices": filtered_notice_count,
            "selected_notice_ids": list(selected_notice_ids),
        },
        "notice_type_policy": selected_notice_type_policy,
        "run": {
            "mode": "legacy_normalized_selection",
            "status": "success",
            "started_at": str(
                legacy_run.get("started_at") or legacy.get("exported_at") or exported_at
            ),
            "finished_at": exported_at,
            "pages_fetched": int(legacy_run.get("pages_fetched") or 0),
            "items_seen": int(
                legacy_counts.get("notices")
                or legacy_run.get("items_seen")
                or original_notice_count
            ),
            "items_inserted": filtered_notice_count,
            "detail_fetched": filtered_notice_count,
            "errors": 0,
        },
        "legacy_source": {
            "schema_version": legacy.get("schema_version"),
            "exported_at": legacy.get("exported_at"),
            "export_scope": legacy.get("export_scope"),
            "filters": dict(legacy.get("filters") or {}),
            "run": legacy_run,
            "counts": legacy_counts,
            "files": dict(legacy.get("files") or {}),
        },
    }


def load_authenticated_notice_selection_notice_ids(path: Path) -> tuple[str, ...]:
    raw = Path(path).read_text(encoding="utf-8")
    if path.suffix.lower() != ".json":
        return tuple(dict.fromkeys(line.strip() for line in raw.splitlines() if line.strip()))
    payload = json.loads(raw)
    if isinstance(payload, list):
        return tuple(dict.fromkeys(str(item).strip() for item in payload if str(item).strip()))
    if isinstance(payload, dict):
        direct = payload.get("selected_notice_ids")
        if isinstance(direct, list):
            return tuple(dict.fromkeys(str(item).strip() for item in direct if str(item).strip()))
        notices = payload.get("notices")
        if isinstance(notices, list):
            return tuple(
                dict.fromkeys(
                    str(dict(item).get("notice_id") or "").strip()
                    for item in notices
                    if str(dict(item).get("notice_id") or "").strip()
                )
            )
    raise ValueError(
        "unsupported authenticated notice selection file payload; expected text ids, "
        "JSON list, or JSON object with selected_notice_ids / notices[].notice_id"
    )


def build_notice_type_policy_snapshot_from_legacy_config(
    payload: Sequence[dict[str, Any]] | None,
) -> tuple[dict[str, Any], ...]:
    snapshots: list[dict[str, Any]] = []
    for item in payload or ():
        raw = dict(item)
        type_id = str(raw.get("type") or "").strip()
        name = str(raw.get("name") or "").strip()
        if not type_id or not name:
            continue
        snapshots.append(
            {
                "type": type_id,
                "name": name,
                "enabled": bool(raw.get("enabled")),
                "incremental": {
                    "pages": int(raw.get("incrementalPages") or 0),
                    "page_size": int(raw.get("incrementalPageSize") or 0),
                },
                "backfill": {
                    "pages": int(raw.get("backfillPages") or 0),
                    "page_size": int(raw.get("backfillPageSize") or 0),
                },
            }
        )
    return tuple(snapshots)


def _notice_id_for_record(record: dict[str, Any]) -> str:
    notice = dict(record.get("notice") or {})
    value = notice.get("notice_id") or record.get("notice_id")
    text = str(value or "").strip()
    if not text:
        raise ValueError("bundle record is missing notice_id")
    return text


def _notice_type_ids_for_records(
    bundle_records: Sequence[dict[str, Any]],
) -> tuple[str, ...]:
    selected: list[str] = []
    seen: set[str] = set()
    for record in bundle_records:
        notice = dict(record.get("notice") or {})
        for category in list(notice.get("categories") or ()):
            type_id = str(dict(category).get("notice_type") or "").strip()
            if not type_id or type_id in seen:
                continue
            seen.add(type_id)
            selected.append(type_id)
    return tuple(selected)


def _timestamp_label(value: str) -> str:
    normalized = value.strip().replace("-", "").replace(":", "").replace("T", "")
    return normalized[:14] if len(normalized) >= 14 else normalized


def _default_export_scope(
    *,
    legacy_manifest: dict[str, Any],
    filtered_notice_count: int,
) -> str:
    legacy_scope = str(legacy_manifest.get("export_scope") or "legacy").strip() or "legacy"
    return f"{legacy_scope}-normalized-{filtered_notice_count}"


def _require_legacy_manifest(legacy_manifest: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(legacy_manifest, dict) or not legacy_manifest:
        raise ValueError("legacy authenticated notice manifest is required")
    required_top_level = ("schema_version", "exported_at", "export_scope", "run", "counts")
    missing_top_level = tuple(
        field for field in required_top_level if legacy_manifest.get(field) in (None, "")
    )
    if missing_top_level:
        raise ValueError(
            "legacy authenticated notice manifest missing required fields: "
            + ", ".join(missing_top_level)
        )
    legacy_run = legacy_manifest.get("run")
    if not isinstance(legacy_run, dict):
        raise ValueError("legacy authenticated notice manifest run must be an object")
    required_run_fields = ("status", "started_at", "finished_at", "pages_fetched", "items_seen")
    missing_run_fields = tuple(
        field for field in required_run_fields if legacy_run.get(field) in (None, "")
    )
    if missing_run_fields:
        raise ValueError(
            "legacy authenticated notice manifest run missing required fields: "
            + ", ".join(missing_run_fields)
        )
    if str(legacy_run.get("status") or "").strip() != "success":
        raise ValueError("legacy authenticated notice manifest run status must be success")
    legacy_counts = legacy_manifest.get("counts")
    if not isinstance(legacy_counts, dict) or legacy_counts.get("notices") in (None, ""):
        raise ValueError("legacy authenticated notice manifest counts.notices is required")
    return dict(legacy_manifest)


__all__ = [
    "AUTHENTICATED_NOTICE_LEGACY_COLLECTOR_RUNTIME_SHELL",
    "AUTHENTICATED_NOTICE_LEGACY_EXPORT_CONTRACT_VERSION",
    "AUTHENTICATED_NOTICE_LEGACY_NORMALIZED_SCHEMA",
    "AuthenticatedNoticeLegacyNormalizationResult",
    "build_authenticated_notice_legacy_normalized_manifest",
    "build_notice_type_policy_snapshot_from_legacy_config",
    "load_authenticated_notice_selection_notice_ids",
    "normalize_authenticated_notice_legacy_export",
]
