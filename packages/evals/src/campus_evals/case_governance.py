from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from campus_evals.fixture_registry import fixture_path

CASE_LIFECYCLE_STATUSES = (
    "candidate",
    "pending_review",
    "accepted_smoke",
    "accepted_regression_locked",
    "accepted_release_gate",
    "exploratory",
    "rejected",
    "duplicate",
    "needs_info",
    "retired",
)

CaseLifecycleStatus = Literal[
    "candidate",
    "pending_review",
    "accepted_smoke",
    "accepted_regression_locked",
    "accepted_release_gate",
    "exploratory",
    "rejected",
    "duplicate",
    "needs_info",
    "retired",
]

REVIEW_DECISIONS = ("accept", "reject", "duplicate", "needs_info", "retire", "defer")
ReviewDecision = Literal["accept", "reject", "duplicate", "needs_info", "retire", "defer"]

DENOMINATOR_REGISTRY_PATH = fixture_path("ops.eval_denominator_registry")
_FORBIDDEN_DENOMINATOR_TRUTH_KEYS = {
    "accepted_cases",
    "expected_truth",
    "golden_truth",
    "qrels",
}


@dataclass(frozen=True, slots=True)
class DenominatorRegistryEntry:
    surface_id: str
    domain_owner: str
    tool_surface: str
    admission_state: str
    truth_scope: str
    authors_domain_truth: bool
    eval_families: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DenominatorRegistry:
    schema_version: int
    registry_id: str
    updated_at: str
    entries: tuple[DenominatorRegistryEntry, ...]


def review_decision_for_lifecycle(status: str) -> ReviewDecision:
    normalized = _required_string(status, "status")
    if normalized not in CASE_LIFECYCLE_STATUSES:
        raise ValueError(f"unsupported case lifecycle status: {normalized}")
    if normalized.startswith("accepted_"):
        return "accept"
    if normalized == "rejected":
        return "reject"
    if normalized == "duplicate":
        return "duplicate"
    if normalized == "needs_info":
        return "needs_info"
    if normalized == "retired":
        return "retire"
    return "defer"


def load_denominator_registry(path: str | Path | None = None) -> DenominatorRegistry:
    registry_path = Path(path) if path is not None else DENOMINATOR_REGISTRY_PATH
    payload = json.loads(registry_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("denominator registry must be a JSON object")
    return validate_denominator_registry(payload)


def validate_denominator_registry(payload: dict[str, object]) -> DenominatorRegistry:
    schema_version = int(payload.get("schema_version") or 0)
    if schema_version != 1:
        raise ValueError("denominator registry schema_version must be 1")
    registry_id = _required_string(payload.get("registry_id"), "registry_id")
    updated_at = _required_string(payload.get("updated_at"), "updated_at")
    raw_entries = payload.get("entries")
    if not isinstance(raw_entries, list) or not raw_entries:
        raise ValueError("denominator registry entries must be a non-empty list")

    seen_surface_ids: set[str] = set()
    entries: list[DenominatorRegistryEntry] = []
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            raise ValueError("denominator registry entries must be objects")
        forbidden_keys = sorted(_FORBIDDEN_DENOMINATOR_TRUTH_KEYS & set(raw_entry))
        if forbidden_keys:
            raise ValueError(
                "denominator registry entries must not author domain truth: "
                + ", ".join(forbidden_keys)
            )
        entry = DenominatorRegistryEntry(
            surface_id=_required_string(raw_entry.get("surface_id"), "surface_id"),
            domain_owner=_required_string(raw_entry.get("domain_owner"), "domain_owner"),
            tool_surface=_required_string(raw_entry.get("tool_surface"), "tool_surface"),
            admission_state=_required_string(raw_entry.get("admission_state"), "admission_state"),
            truth_scope=_required_string(raw_entry.get("truth_scope"), "truth_scope"),
            authors_domain_truth=bool(raw_entry.get("authors_domain_truth")),
            eval_families=_string_tuple(raw_entry.get("eval_families"), "eval_families"),
        )
        if entry.surface_id in seen_surface_ids:
            raise ValueError(f"duplicate denominator surface_id: {entry.surface_id}")
        if entry.truth_scope != "denominator_expectation":
            raise ValueError("denominator registry entries must stay expectation-only")
        if entry.authors_domain_truth:
            raise ValueError("denominator registry entries must not author domain truth")
        seen_surface_ids.add(entry.surface_id)
        entries.append(entry)

    return DenominatorRegistry(
        schema_version=schema_version,
        registry_id=registry_id,
        updated_at=updated_at,
        entries=tuple(entries),
    )


def _string_tuple(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field_name} must be a non-empty list")
    return tuple(_required_string(item, field_name) for item in value)


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


__all__ = [
    "CASE_LIFECYCLE_STATUSES",
    "DENOMINATOR_REGISTRY_PATH",
    "REVIEW_DECISIONS",
    "CaseLifecycleStatus",
    "DenominatorRegistry",
    "DenominatorRegistryEntry",
    "ReviewDecision",
    "load_denominator_registry",
    "review_decision_for_lifecycle",
    "validate_denominator_registry",
]
