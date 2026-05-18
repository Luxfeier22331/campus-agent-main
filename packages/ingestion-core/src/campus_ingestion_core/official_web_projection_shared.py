from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

OFFICIAL_WEB_PROJECTION_DECLARATIONS_SCHEMA_VERSION = "official_web_projection_declarations.v1"
OFFICIAL_WEB_PROJECTION_ROUTING_SCHEMA_VERSION = "official_web_projection_routing.v1"
OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_SCHEMA_VERSION = "official_web_source_truth_bundle.v1"
OFFICIAL_WEB_PAGE_MANIFEST_SCHEMA_VERSION = "official_web_page_manifest.v1"
OFFICIAL_WEB_CONTENT_BLOCK_SCHEMA_VERSION = "official_web_content_block.v1"
OFFICIAL_WEB_PROJECTION_REPLAY_REPORT_SCHEMA_VERSION = "official_web_projection_replay_report.v1"
OFFICIAL_WEB_PROJECTION_VALIDATION_REPORT_SCHEMA_VERSION = (
    "official_web_projection_validation_report.v1"
)
OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES = {
    "article_detail",
    "listing_page",
    "directory_page",
    "sitemap_navigation_page",
    "data_table_page",
    "gallery_page",
    "contact_widget_page",
    "structural_shell_page",
    "dynamic_shell_page",
    "generic_content_page",
}
OFFICIAL_WEB_SHELL_PAGE_FAMILIES = {
    "structural_shell_page",
    "dynamic_shell_page",
}
OFFICIAL_WEB_PROJECTION_ACTIONS = {
    "emit_document",
    "manual_review",
}


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionDeclaration:
    declaration_id: str
    page_family: str
    target_corpus: str
    target_collection: str
    projection_family: str
    document_kind: str
    action: Literal["emit_document", "manual_review"]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionDeclarationsConfig:
    schema_version: str
    site_id: str
    projection_policy_version: str
    declarations: tuple[OfficialWebProjectionDeclaration, ...]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionRoute:
    route_id: str
    target_corpus: str
    target_collection: str
    page_families: tuple[str, ...]
    title_allowlist: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionRoutingConfig:
    schema_version: str
    site_id: str
    routing_policy_version: str
    routes: tuple[OfficialWebProjectionRoute, ...]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionReplayReport:
    schema_version: str
    site_id: str
    crawl_run_id: str
    output_dir: str
    projection_output_dir: str
    generated_at: str
    counts: dict[str, int]
    documents: list[dict[str, object]]
    manual_review_pages: list[dict[str, object]]
    consumer_candidate_pages: list[dict[str, object]] = field(default_factory=list)
    collection_mode: str | None = None
    target_family_counts: dict[str, int] = field(default_factory=dict)
    target_materialization_policy_counts: dict[str, int] = field(default_factory=dict)
    target_lineage_issues: list[dict[str, object]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionValidationReport:
    schema_version: str
    valid: bool
    projection_output_dir: str
    issues: list[dict[str, object]]
    counts: dict[str, int]


def _slugify_text(value: str) -> str:
    lowered = value.lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return normalized[:64]


def _normalize_block_text(block: dict[str, object]) -> str:
    if isinstance(block.get("textNormalized"), str) and str(block["textNormalized"]).strip():
        return str(block["textNormalized"]).strip()
    if isinstance(block.get("linkText"), str) and str(block["linkText"]).strip():
        return str(block["linkText"]).strip()
    return ""


def _normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if isinstance(item, str) and item.strip()]


def _read_json(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"missing JSON file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"failed to parse JSON file {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"JSON payload at {path} must be an object")
    return payload


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as exc:
        raise ValueError(f"missing JSONL file: {path}") from exc
    rows: list[dict[str, object]] = []
    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError(f"failed to parse JSONL line {index} at {path}: {exc}") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"JSONL line {index} at {path} must be an object")
        rows.append(payload)
    return rows


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    return value.strip()


def _require_non_empty_string_list(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field_name} must be a non-empty array")
    items: list[str] = []
    seen_items: set[str] = set()
    for item in value:
        text = _require_text(item, field_name)
        if text in seen_items:
            raise ValueError(f"duplicate {field_name} entry: {text}")
        seen_items.add(text)
        items.append(text)
    return tuple(items)


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _require_path_segment(value: object, field_name: str) -> str:
    normalized = _require_text(value, field_name)
    if "/" in normalized:
        raise ValueError(f"{field_name} must not contain slash")
    return normalized


def _require_page_family(value: object) -> str:
    normalized = _require_text(value, "page_family")
    if normalized not in OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES:
        raise ValueError(f"unsupported official_web page_family: {normalized}")
    return normalized


def _require_page_family_list(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field_name} must be a non-empty array")
    page_families: list[str] = []
    seen_page_families: set[str] = set()
    for item in value:
        page_family = _require_page_family(item)
        if page_family in seen_page_families:
            raise ValueError(f"duplicate {field_name} entry: {page_family}")
        seen_page_families.add(page_family)
        page_families.append(page_family)
    return tuple(page_families)


def _require_action(value: object) -> Literal["emit_document", "manual_review"]:
    normalized = _require_text(value, "action")
    if normalized not in OFFICIAL_WEB_PROJECTION_ACTIONS:
        raise ValueError(f"unsupported official_web projection action: {normalized}")
    return normalized  # type: ignore[return-value]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]
