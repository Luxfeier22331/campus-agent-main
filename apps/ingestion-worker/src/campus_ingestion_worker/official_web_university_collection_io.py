from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _repo_root(repo_root: Path | str | None = None) -> Path:
    if repo_root is None:
        return Path(__file__).resolve().parents[4]
    return Path(repo_root).resolve()


def _official_web_config_root(repo_root: Path, config_root: Path | str | None = None) -> Path:
    if config_root is None:
        return repo_root / "configs" / "sources" / "official_web"
    return Path(config_root).resolve()


def _default_report_dir(repo_root: Path) -> Path:
    return repo_root / ".tmp" / "official-web-university-level-collection-dev-closeout" / "reports"


def _default_run_root(repo_root: Path) -> Path:
    return repo_root / ".tmp" / "official-web-university-level-collection-dev-closeout" / "runs"


def _default_run_id(*, site_id: str, lane_id: str) -> str:
    compact = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"{site_id}-{lane_id}-{compact}"


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _read_required_json(path: Path, *, name: str) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"missing {name}: {path}")
    return _read_json(path)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _non_empty_text(value: object, *, field: str) -> str:
    text = _normalize_text(value)
    if not text:
        raise ValueError(f"missing {field}")
    return text


def _passed(name: str, message: str, *, details: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"name": name, "status": "passed", "message": message}
    if details:
        payload["details"] = details
    return payload


def _failed(name: str, message: str, *, details: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"name": name, "status": "failed", "message": message}
    if details:
        payload["details"] = details
    return payload
