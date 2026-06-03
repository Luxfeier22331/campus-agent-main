from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from campus_ingestion_worker.official_web_university_collection_config import (
    _declared_page_families,
    _is_university_collection_lane,
    _resolve_lane_and_hosts,
)
from campus_ingestion_worker.official_web_university_collection_constants import (
    UNIVERSITY_ALLOWED_HOST_GROUPS,
    UNIVERSITY_COLLECTION_PREFLIGHT_SCHEMA_VERSION,
    UNIVERSITY_REQUIRED_PAGE_FAMILIES,
)
from campus_ingestion_worker.official_web_university_collection_io import (
    _default_report_dir,
    _default_run_root,
    _failed,
    _normalize_text,
    _official_web_config_root,
    _passed,
    _repo_root,
    _utc_now_iso,
)


def run_official_web_university_collection_preflight(
    *,
    site_id: str = "muc_public",
    lane_id: str,
    repo_root: Path | str | None = None,
    config_root: Path | str | None = None,
    run_root: Path | str | None = None,
    report_dir: Path | str | None = None,
) -> dict[str, Any]:
    resolved_repo_root = _repo_root(repo_root)
    resolved_config_root = _official_web_config_root(resolved_repo_root, config_root)
    resolved_run_root = (
        _default_run_root(resolved_repo_root) if run_root is None else Path(run_root).resolve()
    )
    resolved_report_dir = (
        _default_report_dir(resolved_repo_root)
        if report_dir is None
        else Path(report_dir).resolve()
    )

    checks: list[dict[str, Any]] = [
        _check_writable_dir(name="run_root_writable", path=resolved_run_root),
        _check_writable_dir(name="report_dir_writable", path=resolved_report_dir),
    ]

    for executable in ("pnpm", "uv"):
        path = shutil.which(executable)
        if path:
            checks.append(
                _passed(
                    f"{executable}_available",
                    f"{executable} is available",
                    details={"path": path},
                )
            )
        else:
            checks.append(_failed(f"{executable}_available", f"{executable} is not available"))

    lane: dict[str, Any] | None = None
    hosts_by_name: dict[str, dict[str, Any]] = {}
    declarations_doc: dict[str, Any] = {}
    scheduler_policy_path = resolved_config_root / site_id / "scheduler-policy.json"
    hosts_path = resolved_config_root / site_id / "hosts.json"
    declarations_path = resolved_config_root / site_id / "projection-declarations.json"
    try:
        (
            lane,
            hosts_by_name,
            scheduler_policy_path,
            hosts_path,
            declarations_path,
            declarations_doc,
        ) = _resolve_lane_and_hosts(
            site_id=site_id,
            lane_id=lane_id,
            config_root=resolved_config_root,
        )
        checks.append(
            _passed(
                "site_config_files_ready",
                "scheduler policy, hosts policy, and projection declarations are readable",
                details={
                    "scheduler_policy_path": str(scheduler_policy_path),
                    "hosts_path": str(hosts_path),
                    "declarations_path": str(declarations_path),
                },
            )
        )
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        checks.append(_failed("site_config_files_ready", str(exc)))

    if lane is not None:
        _append_lane_checks(
            checks=checks,
            lane=lane,
            lane_id=lane_id,
            hosts_by_name=hosts_by_name,
        )

    if declarations_doc:
        _append_projection_declaration_checks(checks=checks, declarations_doc=declarations_doc)

    status = "failed" if any(check["status"] == "failed" for check in checks) else "passed"
    return {
        "schema_version": UNIVERSITY_COLLECTION_PREFLIGHT_SCHEMA_VERSION,
        "status": status,
        "checked_at": _utc_now_iso(),
        "site_id": site_id,
        "lane_id": lane_id,
        "repo_root": str(resolved_repo_root),
        "config_root": str(resolved_config_root),
        "run_root": str(resolved_run_root),
        "report_dir": str(resolved_report_dir),
        "checks": checks,
    }


def _append_lane_checks(
    *,
    checks: list[dict[str, Any]],
    lane: dict[str, Any],
    lane_id: str,
    hosts_by_name: dict[str, dict[str, Any]],
) -> None:
    enabled = bool(lane.get("enabled"))
    if enabled:
        checks.append(_passed("lane_enabled", f"lane {lane_id} is enabled"))
    else:
        checks.append(_failed("lane_enabled", f"lane {lane_id} is disabled"))

    if _is_university_collection_lane(lane_id):
        checks.append(
            _passed(
                "lane_is_university_lane",
                f"lane {lane_id} is accepted as university collection lane",
            )
        )
    else:
        checks.append(
            _failed(
                "lane_is_university_lane",
                f"lane {lane_id} is outside university lane scope",
            )
        )

    lane_hosts = lane.get("host_filter")
    if not isinstance(lane_hosts, list) or not lane_hosts:
        checks.append(_failed("lane_host_filter", f"lane {lane_id} host_filter is empty"))
        return
    missing_hosts: list[str] = []
    invalid_groups: list[str] = []
    disabled_hosts: list[str] = []
    for host in lane_hosts:
        host_name = _normalize_text(host)
        policy = hosts_by_name.get(host_name)
        if policy is None:
            missing_hosts.append(host_name)
            continue
        host_group = _normalize_text(policy.get("host_group"))
        if host_group not in UNIVERSITY_ALLOWED_HOST_GROUPS:
            invalid_groups.append(f"{host_name}:{host_group or 'unknown'}")
        if not bool(policy.get("enabled")):
            disabled_hosts.append(host_name)
    _append_lane_host_result_checks(
        checks=checks,
        missing_hosts=missing_hosts,
        invalid_groups=invalid_groups,
        disabled_hosts=disabled_hosts,
    )


def _append_lane_host_result_checks(
    *,
    checks: list[dict[str, Any]],
    missing_hosts: list[str],
    invalid_groups: list[str],
    disabled_hosts: list[str],
) -> None:
    if missing_hosts:
        checks.append(
            _failed(
                "lane_hosts_known",
                "lane hosts missing in hosts policy: " + ", ".join(sorted(missing_hosts)),
            )
        )
    else:
        checks.append(_passed("lane_hosts_known", "all lane hosts exist in hosts policy"))
    if invalid_groups:
        checks.append(
            _failed(
                "lane_hosts_group_allowed",
                "lane hosts outside university groups: " + ", ".join(sorted(invalid_groups)),
            )
        )
    else:
        checks.append(
            _passed(
                "lane_hosts_group_allowed",
                "all lane hosts are in university_core/university_support groups",
            )
        )
    if disabled_hosts:
        checks.append(
            _failed(
                "lane_hosts_enabled",
                "lane hosts disabled in hosts policy: " + ", ".join(sorted(disabled_hosts)),
            )
        )
    else:
        checks.append(_passed("lane_hosts_enabled", "all lane hosts are enabled"))


def _append_projection_declaration_checks(
    *,
    checks: list[dict[str, Any]],
    declarations_doc: dict[str, Any],
) -> None:
    try:
        declared_page_families = _declared_page_families(declarations_doc)
    except ValueError as exc:
        checks.append(_failed("projection_declarations_complete", str(exc)))
        return
    missing_page_families = sorted(UNIVERSITY_REQUIRED_PAGE_FAMILIES - declared_page_families)
    if missing_page_families:
        checks.append(
            _failed(
                "projection_declarations_complete",
                "missing projection declarations for page families: "
                + ", ".join(missing_page_families),
            )
        )
        return
    checks.append(
        _passed(
            "projection_declarations_complete",
            "projection declarations cover all required page families",
            details={"declared_page_family_count": len(declared_page_families)},
        )
    )


def _check_writable_dir(*, name: str, path: Path) -> dict[str, Any]:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".write-check.tmp"
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError as exc:
        return _failed(name, f"{path} is not writable: {exc}")
    return _passed(name, f"{path} is writable", details={"path": str(path)})
