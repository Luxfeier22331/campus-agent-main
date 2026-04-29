from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from campus_ingestion_core.service_guide_projection_constants import (
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_CORPUS,
)


def validate_effective_window(effective_from: str, effective_until: str, path: str) -> None:
    if parse_rfc3339(effective_until, "effective_until") <= parse_rfc3339(
        effective_from,
        "effective_from",
    ):
        raise ValueError(f"{path} effective_until must be after effective_from")


def parse_rfc3339(value: str, field_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be RFC3339 datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def service_guide_release_id(prefix: str, generated_at: str) -> str:
    normalized_prefix = path_segment(prefix, "release_id_prefix")
    timestamp = parse_rfc3339(generated_at, "generated_at").strftime("%Y%m%dT%H%M%S")
    return f"{normalized_prefix}-{timestamp}"


def manifest_source_paths(
    value: object,
    *,
    manifest_dir: Path,
    field_name: str,
) -> tuple[Path, ...]:
    paths: list[Path] = []
    for index, item in enumerate(list_of_dicts(value)):
        raw_path = required_text(item.get("path"))
        if raw_path is None:
            raise ValueError(f"{field_name}[{index}].path is required")
        resolved_path = Path(raw_path)
        if not resolved_path.is_absolute():
            resolved_path = manifest_dir / resolved_path
        resolved_path = resolved_path.resolve()
        if not resolved_path.exists():
            raise ValueError(f"{field_name}[{index}].path does not exist: {resolved_path}")
        paths.append(resolved_path)
    return tuple(paths)


def read_json_object(path: Path) -> dict[str, Any]:
    return require_mapping(json.loads(path.read_text(encoding="utf-8")), str(path))


def default_service_guide_source_truth_manifest_path() -> Path:
    return (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / SERVICE_GUIDE_CORPUS
        / SERVICE_GUIDE_COLLECTION
        / "source-truth.v1.json"
    )


def default_target_document_id(target_title: str) -> str:
    digest = hashlib.sha1(target_title.encode("utf-8")).hexdigest()[:12]
    return f"campus_services:service_catalog:{quote(target_title, safe='')[:48]}:{digest}"


def positive_int(value: object, field_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a positive integer")
    try:
        parsed = int(str(value))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a positive integer") from exc
    if parsed <= 0:
        raise ValueError(f"{field_name} must be a positive integer")
    return parsed


def optional_positive_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        parsed = int(str(value))
    except ValueError:
        return None
    if parsed <= 0:
        return None
    return parsed


def required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        text = required_text(item)
        if text is not None:
            items.append(text)
    return items


def list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def require_mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return dict(value)


def json_bytes(payload: object) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def path_segment(value: str, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    if "/" in normalized or "\\" in normalized:
        raise ValueError(f"{field_name} must not contain path separators")
    return normalized


__all__ = [
    "default_service_guide_source_truth_manifest_path",
    "default_target_document_id",
    "json_bytes",
    "list_of_dicts",
    "manifest_source_paths",
    "optional_positive_int",
    "parse_rfc3339",
    "path_segment",
    "positive_int",
    "read_json_object",
    "require_mapping",
    "required_text",
    "service_guide_release_id",
    "string_list",
    "validate_effective_window",
]
