from __future__ import annotations

import json
import re
from typing import Any

from campus_ingestion_core.authenticated_notice_import import (
    AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
    AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
)

DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS = "authenticated_documents"
DEFAULT_FILE_RELEASE_SOURCE_COLLECTION = "file_release_source"
DEFAULT_FILE_RELEASE_IMPORT_SOURCE = "authenticated_notice_file_release_import_v1"
DEFAULT_FILE_RELEASE_PARSER_VERSION = "authenticated_notice_file_release_import_v1"
FILE_RELEASE_SOURCE_SURFACE = "file_release"
FILE_RELEASE_MANIFEST_SCHEMA = "authenticated_notice_file_release_manifest_v1"
FILE_RELEASE_BLOCK_SCHEMA = "authenticated_notice_file_release_block_v1"
FILE_RELEASE_REF_SCHEMA = "authenticated_notice_file_release_ref_v1"
_YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
_WHITESPACE_RE = re.compile(r"\s+")
_SUPPORTED_FILE_RELEASE_IMPORT_MODES = {
    AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
    AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
}


def _normalize_import_mode(mode: str) -> str:
    normalized = str(mode or "").strip().lower().replace("-", "_")
    aliases = {
        "dry_run": AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
        "dryrun": AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
        "preview": AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
        "materialize": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
        "write": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
        "admit": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
        "admit_and_write": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in _SUPPORTED_FILE_RELEASE_IMPORT_MODES:
        raise ValueError(
            "unsupported authenticated notice file-release import mode: "
            f"{mode!r}; expected one of {sorted(_SUPPORTED_FILE_RELEASE_IMPORT_MODES)}"
        )
    return normalized


def _assert_file_release_import_scope(corpus: str, collection: str) -> None:
    if (
        corpus != DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS
        or collection != DEFAULT_FILE_RELEASE_SOURCE_COLLECTION
    ):
        raise ValueError(
            "authenticated notice file-release imports must target "
            "authenticated_documents/file_release_source"
        )


def _fetcher_version(export_manifest: dict[str, Any] | None) -> str:
    return str((export_manifest or {}).get("schema_version") or "unknown")


def _collector_version(export_manifest: dict[str, Any] | None) -> str:
    collector = _as_record((export_manifest or {}).get("collector"))
    return _required_text(
        collector.get("export_contract_version")
        or collector.get("runtime_shell")
        or (export_manifest or {}).get("schema_version"),
        "collector.export_contract_version",
    )


def _exported_at(export_manifest: dict[str, Any] | None) -> str:
    return _required_text((export_manifest or {}).get("exported_at"), "exported_at")


def _infer_year(*values: object) -> str | None:
    for value in values:
        if not isinstance(value, str):
            continue
        match = _YEAR_RE.search(value)
        if match is not None:
            return match.group(1)
    return None


def _metadata_line(label: str, value: str | None) -> str | None:
    if not value:
        return None
    return f"{label}：{value}"


def _normalize_text(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value.replace("\xa0", " ")).strip()


def _json_bytes(payload: object) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _jsonl_bytes(rows: tuple[dict[str, Any], ...]) -> bytes:
    return (
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows).strip() + "\n"
        if rows
        else ""
    ).encode("utf-8")


def _manifest_declares_full_scope_replace(export_manifest: dict[str, Any] | None) -> bool:
    if not isinstance(export_manifest, dict):
        return False
    filters = export_manifest.get("filters")
    if not isinstance(filters, dict):
        return False
    return filters.get("target_file_release_id") is None


def _selected_file_release_ids_for_import(
    *,
    replace_scope: bool,
    bundle_records: tuple[dict[str, Any], ...],
) -> tuple[int, ...]:
    if replace_scope:
        return ()
    return tuple(
        dict.fromkeys(
            _required_int(record.get("file_release_id"), "file_release_id")
            for record in bundle_records
        )
    )


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _required_text(value: object, label: str) -> str:
    normalized = _optional_text(value)
    if normalized is None:
        raise ValueError(f"{label} is required")
    return normalized


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed


def _required_int(value: object, label: str) -> int:
    parsed = _optional_int(value)
    if parsed is None:
        raise ValueError(f"{label} is required")
    return parsed


def _required_non_negative_int(value: object, label: str) -> int:
    parsed = _required_int(value, label)
    if parsed < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return parsed


def _normalize_extension(filename: str) -> str | None:
    candidate = filename.rsplit("/", 1)[-1].rsplit(".", 1)
    if len(candidate) != 2 or not candidate[1].strip():
        return None
    return candidate[1].strip().lower()


def _as_record(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}
