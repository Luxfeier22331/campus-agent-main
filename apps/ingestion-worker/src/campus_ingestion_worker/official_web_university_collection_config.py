from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from campus_ingestion_worker.official_web_university_collection_constants import (
    CURRENT_UNIVERSITY_LANE_IDS,
    LEGACY_UNIVERSITY_LANE_PREFIX,
)
from campus_ingestion_worker.official_web_university_collection_io import (
    _normalize_text,
    _read_required_json,
)


def _is_university_collection_lane(lane_id: object) -> bool:
    normalized = _normalize_text(lane_id)
    return normalized in CURRENT_UNIVERSITY_LANE_IDS or normalized.startswith(
        LEGACY_UNIVERSITY_LANE_PREFIX
    )


def _resolve_lane_and_hosts(
    *,
    site_id: str,
    lane_id: str,
    config_root: Path,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], Path, Path, Path, dict[str, Any]]:
    site_root = config_root / site_id
    scheduler_policy_path = site_root / "scheduler-policy.json"
    hosts_path = site_root / "hosts.json"
    declarations_path = site_root / "projection-declarations.json"
    scheduler_policy = _read_required_json(
        scheduler_policy_path, name=f"scheduler policy for site {site_id}"
    )
    hosts_doc = _read_required_json(hosts_path, name=f"host policy for site {site_id}")
    declarations_doc = _read_required_json(
        declarations_path,
        name=f"projection declarations for site {site_id}",
    )

    lanes = scheduler_policy.get("lanes")
    if not isinstance(lanes, list):
        raise ValueError("scheduler-policy.json lanes must be an array")
    resolved_lane = None
    for lane in lanes:
        if isinstance(lane, dict) and _normalize_text(lane.get("lane_id")) == lane_id:
            resolved_lane = lane
            break
    if resolved_lane is None:
        raise ValueError(f"lane not found in scheduler policy: {lane_id}")

    hosts = hosts_doc.get("hosts")
    if not isinstance(hosts, list):
        raise ValueError("hosts.json hosts must be an array")
    hosts_by_name = {
        _normalize_text(item.get("host")): item
        for item in hosts
        if isinstance(item, dict) and _normalize_text(item.get("host"))
    }
    return (
        resolved_lane,
        hosts_by_name,
        scheduler_policy_path,
        hosts_path,
        declarations_path,
        declarations_doc,
    )


def _declared_page_families(declarations_doc: Mapping[str, Any]) -> set[str]:
    declarations = declarations_doc.get("declarations")
    if not isinstance(declarations, list):
        raise ValueError("projection-declarations.json declarations must be an array")
    page_families: set[str] = set()
    for item in declarations:
        if not isinstance(item, dict):
            raise ValueError("projection-declarations.json declarations[] must be objects")
        page_family = _normalize_text(item.get("page_family"))
        if not page_family:
            raise ValueError("projection-declarations.json declarations[] missing page_family")
        page_families.add(page_family)
    return page_families
