from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

FIXTURE_REGISTRY_SCHEMA_VERSION = "eval-fixture-registry-v1"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def fixture_root() -> Path:
    return repo_root() / "packages" / "evals" / "fixtures"


def fixture_registry_path() -> Path:
    return fixture_root() / "registry.v1.json"


@lru_cache(maxsize=1)
def _registry_payload() -> dict[str, Any]:
    payload = json.loads(fixture_registry_path().read_text(encoding="utf-8"))
    if payload.get("schema_version") != FIXTURE_REGISTRY_SCHEMA_VERSION:
        raise ValueError("unsupported eval fixture registry schema_version")
    return payload


def fixture_path(fixture_id: str) -> Path:
    normalized = fixture_id.strip()
    payload = _registry_payload()
    aliases = payload.get("legacy_aliases") or {}
    if normalized in aliases:
        normalized = str(aliases[normalized])
    fixtures = payload.get("fixtures") or {}
    relative = fixtures.get(normalized)
    if not isinstance(relative, str) or not relative.strip():
        raise KeyError(f"unknown eval fixture id: {fixture_id}")
    path = fixture_root() / relative
    if not path.exists():
        raise FileNotFoundError(f"eval fixture {normalized} is missing: {path}")
    return path


def fixture_repo_path(fixture_id: str) -> str:
    return str(fixture_path(fixture_id).relative_to(repo_root()))


def fixture_relative_path(fixture_id: str) -> str:
    return str(fixture_path(fixture_id).relative_to(fixture_root()))


__all__ = [
    "FIXTURE_REGISTRY_SCHEMA_VERSION",
    "fixture_path",
    "fixture_registry_path",
    "fixture_relative_path",
    "fixture_repo_path",
    "fixture_root",
    "repo_root",
]
