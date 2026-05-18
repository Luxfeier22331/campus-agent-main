from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_university_collection_runtime import (
    CommandRunResult as _CommandRunResult,
)
from campus_ingestion_worker.official_web_university_collection_runtime import (
    run_command as _run_command,
)
from campus_ingestion_worker.official_web_university_collection_runtime import (
    run_pipeline_step as _run_pipeline_step,
)

CommandRunResult = _CommandRunResult

UNIVERSITY_COLLECTION_PREFLIGHT_SCHEMA_VERSION = "official_web_university_collection_preflight.v1"
UNIVERSITY_COLLECTION_RUN_SCHEMA_VERSION = "official_web_university_collection_run.v1"
UNIVERSITY_COLLECTION_COMPARE_SCHEMA_VERSION = "official_web_university_collection_compare.v1"
UNIVERSITY_COLLECTION_ALERT_SCHEMA_VERSION = "official_web_university_collection_alert_summary.v1"
LEGACY_UNIVERSITY_LANE_PREFIX = "university-core-"
CURRENT_UNIVERSITY_LANE_IDS = frozenset(("consumer-candidate-hot", "consumer-stable-baseline"))
UNIVERSITY_ALLOWED_HOST_GROUPS = frozenset({"university_core", "university_support"})
UNIVERSITY_REQUIRED_PAGE_FAMILIES = frozenset(
    {
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
)


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


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _read_required_json(path: Path, *, name: str) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"missing {name}: {path}")
    return _read_json(path)


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _non_empty_text(value: object, *, field: str) -> str:
    text = _normalize_text(value)
    if not text:
        raise ValueError(f"missing {field}")
    return text


def _is_university_collection_lane(lane_id: object) -> bool:
    normalized = _normalize_text(lane_id)
    return normalized in CURRENT_UNIVERSITY_LANE_IDS or normalized.startswith(
        LEGACY_UNIVERSITY_LANE_PREFIX
    )


def _default_report_dir(repo_root: Path) -> Path:
    return repo_root / ".tmp" / "official-web-university-level-collection-dev-closeout" / "reports"


def _default_run_root(repo_root: Path) -> Path:
    return repo_root / ".tmp" / "official-web-university-level-collection-dev-closeout" / "runs"


def _default_run_id(*, site_id: str, lane_id: str) -> str:
    compact = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"{site_id}-{lane_id}-{compact}"


def _check_writable_dir(*, name: str, path: Path) -> dict[str, Any]:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".write-check.tmp"
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError as exc:
        return _failed(name, f"{path} is not writable: {exc}")
    return _passed(name, f"{path} is writable", details={"path": str(path)})


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
        else:
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
                        "lane hosts outside university groups: "
                        + ", ".join(sorted(invalid_groups)),
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

    if declarations_doc:
        try:
            declared_page_families = _declared_page_families(declarations_doc)
        except ValueError as exc:
            checks.append(_failed("projection_declarations_complete", str(exc)))
        else:
            missing_page_families = sorted(
                UNIVERSITY_REQUIRED_PAGE_FAMILIES - declared_page_families
            )
            if missing_page_families:
                checks.append(
                    _failed(
                        "projection_declarations_complete",
                        "missing projection declarations for page families: "
                        + ", ".join(missing_page_families),
                    )
                )
            else:
                checks.append(
                    _passed(
                        "projection_declarations_complete",
                        "projection declarations cover all required page families",
                        details={"declared_page_family_count": len(declared_page_families)},
                    )
                )

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


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _step_json(step_reports: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    for step in step_reports:
        if step.get("name") == name:
            output = step.get("output_json")
            if isinstance(output, dict):
                return output
    return None


def run_official_web_university_collection_lane(
    *,
    lane_id: str,
    site_id: str = "muc_public",
    repo_root: Path | str | None = None,
    config_root: Path | str | None = None,
    run_root: Path | str | None = None,
    report_dir: Path | str | None = None,
    run_id: str | None = None,
    skip_preflight: bool = False,
    import_dry_run: bool = False,
    require_promotable: bool = True,
    command_runner: Any = _run_command,
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
    resolved_report_dir.mkdir(parents=True, exist_ok=True)
    resolved_run_root.mkdir(parents=True, exist_ok=True)

    effective_run_id = run_id or _default_run_id(site_id=site_id, lane_id=lane_id)
    run_dir = resolved_run_root / effective_run_id
    crawl_output_dir = run_dir / "crawl-output"
    projection_output_dir = run_dir / "projection-output"
    import_work_dir = run_dir / "import-dry-run"
    run_dir.mkdir(parents=True, exist_ok=True)

    preflight_report: dict[str, Any] | None = None
    preflight_report_path = resolved_report_dir / f"preflight-{effective_run_id}.json"
    if not skip_preflight:
        preflight_report = run_official_web_university_collection_preflight(
            site_id=site_id,
            lane_id=lane_id,
            repo_root=resolved_repo_root,
            config_root=resolved_config_root,
            run_root=resolved_run_root,
            report_dir=resolved_report_dir,
        )
        _write_json(preflight_report_path, preflight_report)
        if preflight_report["status"] != "passed":
            report = {
                "schema_version": UNIVERSITY_COLLECTION_RUN_SCHEMA_VERSION,
                "status": "failed",
                "site_id": site_id,
                "lane_id": lane_id,
                "run_id": effective_run_id,
                "started_at": _utc_now_iso(),
                "finished_at": _utc_now_iso(),
                "repo_root": str(resolved_repo_root),
                "config_root": str(resolved_config_root),
                "run_root": str(resolved_run_root),
                "report_dir": str(resolved_report_dir),
                "run_dir": str(run_dir),
                "crawl_output_dir": str(crawl_output_dir),
                "projection_output_dir": str(projection_output_dir),
                "preflight_report_path": str(preflight_report_path),
                "failed_step": "preflight",
                "steps": [],
            }
            run_report_path = resolved_report_dir / f"run-{effective_run_id}.json"
            _write_json(run_report_path, report)
            report["run_report_path"] = str(run_report_path)
            return report

    (
        lane,
        _hosts_by_name,
        _scheduler_policy_path,
        _hosts_path,
        _declarations_path,
        _declarations_doc,
    ) = _resolve_lane_and_hosts(
        site_id=site_id,
        lane_id=lane_id,
        config_root=resolved_config_root,
    )
    lane_hosts = [
        _non_empty_text(host, field="lane.host_filter[]")
        for host in lane.get("host_filter", [])
        if _normalize_text(host)
    ]
    run_intent = _non_empty_text(lane.get("run_intent"), field="lane.run_intent")
    max_pages_per_host = int(lane.get("max_pages_per_host") or 0)
    max_total_pages = int(lane.get("max_total_pages") or 0)

    started_at = _utc_now_iso()
    steps: list[dict[str, Any]] = []
    failed_step: str | None = None

    crawl_command = [
        "pnpm",
        "--dir",
        "apps/official-web-collector",
        "crawl",
        "--",
        "--site-id",
        site_id,
        "--crawl-run-id",
        effective_run_id,
        "--run-intent",
        run_intent,
        "--output-dir",
        str(crawl_output_dir),
        "--max-pages-per-host",
        str(max_pages_per_host),
        "--max-total-pages",
        str(max_total_pages),
    ]
    for host in lane_hosts:
        crawl_command.extend(["--host", host])
    step = _run_pipeline_step(
        step_name="crawl",
        command=crawl_command,
        cwd=resolved_repo_root,
        require_json=True,
        command_runner=command_runner,
    )
    steps.append(step)
    if step["status"] != "succeeded":
        failed_step = "crawl"

    if failed_step is None:
        step = _run_pipeline_step(
            step_name="validate",
            command=[
                "pnpm",
                "--dir",
                "apps/official-web-collector",
                "validate",
                "--",
                "--output-dir",
                str(crawl_output_dir),
                "--json",
            ],
            cwd=resolved_repo_root,
            require_json=True,
            command_runner=command_runner,
        )
        steps.append(step)
        validation_output = step.get("output_json")
        if (
            step["status"] != "succeeded"
            or not isinstance(validation_output, dict)
            or not bool(validation_output.get("valid"))
        ):
            failed_step = "validate"

    if failed_step is None:
        step = _run_pipeline_step(
            step_name="qc_report",
            command=[
                "pnpm",
                "--dir",
                "apps/official-web-collector",
                "qc-report",
                "--",
                "--output-dir",
                str(crawl_output_dir),
                "--json",
            ],
            cwd=resolved_repo_root,
            require_json=True,
            command_runner=command_runner,
        )
        steps.append(step)
        qc_output = step.get("output_json")
        if (
            step["status"] != "succeeded"
            or not isinstance(qc_output, dict)
            or not bool(qc_output.get("valid"))
        ):
            failed_step = "qc_report"

    if failed_step is None:
        step = _run_pipeline_step(
            step_name="projection_replay",
            command=[
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "campus_ingestion_worker.project_official_web_source_truth",
                "--output-dir",
                str(crawl_output_dir),
                "--projection-output-dir",
                str(projection_output_dir),
            ],
            cwd=resolved_repo_root,
            require_json=True,
            command_runner=command_runner,
        )
        steps.append(step)
        if step["status"] != "succeeded":
            failed_step = "projection_replay"

    if failed_step is None:
        step = _run_pipeline_step(
            step_name="projection_validate",
            command=[
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "campus_ingestion_worker.validate_official_web_projection",
                "--projection-output-dir",
                str(projection_output_dir),
            ],
            cwd=resolved_repo_root,
            require_json=True,
            command_runner=command_runner,
        )
        steps.append(step)
        validation_output = step.get("output_json")
        if (
            step["status"] != "succeeded"
            or not isinstance(validation_output, dict)
            or not bool(validation_output.get("valid"))
        ):
            failed_step = "projection_validate"

    if failed_step is None:
        step = _run_pipeline_step(
            step_name="chunk_audit",
            command=[
                "uv",
                "run",
                "--all-packages",
                "campus-ingestion-audit-official-web-projection-chunking",
                "--projection-output-dir",
                str(projection_output_dir),
            ],
            cwd=resolved_repo_root,
            require_json=True,
            command_runner=command_runner,
        )
        steps.append(step)
        audit_output = step.get("output_json")
        if (
            step["status"] != "succeeded"
            or not isinstance(audit_output, dict)
            or not bool(audit_output.get("passed"))
        ):
            failed_step = "chunk_audit"

    if failed_step is None and import_dry_run:
        projection_report = _read_required_json(
            projection_output_dir / "projection-report.json",
            name="projection report for import dry-run",
        )
        raw_documents = projection_report.get("documents")
        collections = sorted(
            {
                _normalize_text(document.get("target_collection"))
                for document in (raw_documents if isinstance(raw_documents, list) else [])
                if isinstance(document, dict) and _normalize_text(document.get("target_collection"))
            }
        )
        for collection in collections:
            import_command = [
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "campus_ingestion_worker.official_web_projection_import",
                "--projection-output-dir",
                str(projection_output_dir),
                "--replay-input-dir",
                str(crawl_output_dir),
                "--work-dir",
                str(import_work_dir / collection),
                "--corpus",
                "official_web",
                "--collection",
                collection,
                "--dry-run",
            ]
            if require_promotable:
                import_command.append("--require-promotable")
            step = _run_pipeline_step(
                step_name=f"import_dry_run:{collection}",
                command=import_command,
                cwd=resolved_repo_root,
                require_json=True,
                command_runner=command_runner,
            )
            steps.append(step)
            if step["status"] != "succeeded":
                failed_step = f"import_dry_run:{collection}"
                break

    finished_at = _utc_now_iso()
    status = "failed" if failed_step else "succeeded"
    report = {
        "schema_version": UNIVERSITY_COLLECTION_RUN_SCHEMA_VERSION,
        "status": status,
        "site_id": site_id,
        "lane_id": lane_id,
        "run_id": effective_run_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "repo_root": str(resolved_repo_root),
        "config_root": str(resolved_config_root),
        "run_root": str(resolved_run_root),
        "report_dir": str(resolved_report_dir),
        "run_dir": str(run_dir),
        "crawl_output_dir": str(crawl_output_dir),
        "projection_output_dir": str(projection_output_dir),
        "import_dry_run_enabled": bool(import_dry_run),
        "require_promotable": bool(require_promotable),
        "lane": {
            "lane_id": lane_id,
            "run_intent": run_intent,
            "hosts": lane_hosts,
            "max_pages_per_host": max_pages_per_host,
            "max_total_pages": max_total_pages,
        },
        "preflight_report_path": str(preflight_report_path) if preflight_report is not None else "",
        "failed_step": failed_step or "",
        "steps": steps,
    }
    run_report_path = resolved_report_dir / f"run-{effective_run_id}.json"
    _write_json(run_report_path, report)
    report["run_report_path"] = str(run_report_path)
    return report


def _load_projection_documents(projection_output_dir: Path) -> list[dict[str, Any]]:
    projection_report = _read_required_json(
        projection_output_dir / "projection-report.json",
        name=f"projection report under {projection_output_dir}",
    )
    documents = projection_report.get("documents")
    if not isinstance(documents, list):
        raise ValueError("projection report documents must be an array")
    resolved: list[dict[str, Any]] = []
    for document in documents:
        if isinstance(document, dict):
            resolved.append(document)
    return resolved


def _canonical_urls(documents: Sequence[Mapping[str, Any]]) -> list[str]:
    urls: list[str] = []
    for document in documents:
        url = _normalize_text(document.get("normalized_canonical_url"))
        if url:
            urls.append(url)
    return urls


def compare_official_web_university_collection_runs(
    *,
    current_run_report_path: Path | str,
    previous_run_report_path: Path | str,
    drop_threshold_ratio: float = 0.7,
    output_path: Path | str | None = None,
) -> dict[str, Any]:
    current_report_path = Path(current_run_report_path).resolve()
    previous_report_path = Path(previous_run_report_path).resolve()
    current_report = _read_required_json(current_report_path, name="current run report")
    previous_report = _read_required_json(previous_report_path, name="previous run report")

    current_projection = Path(
        _non_empty_text(
            current_report.get("projection_output_dir"), field="current projection_output_dir"
        )
    )
    previous_projection = Path(
        _non_empty_text(
            previous_report.get("projection_output_dir"), field="previous projection_output_dir"
        )
    )
    current_documents = _load_projection_documents(current_projection)
    previous_documents = _load_projection_documents(previous_projection)

    current_urls = _canonical_urls(current_documents)
    previous_urls = _canonical_urls(previous_documents)
    current_set = set(current_urls)
    previous_set = set(previous_urls)
    missing_urls = sorted(previous_set - current_set)
    new_urls = sorted(current_set - previous_set)
    current_duplicates = sorted([url for url, count in Counter(current_urls).items() if count > 1])

    previous_count = len(previous_documents)
    current_count = len(current_documents)
    drop_ratio = round(current_count / previous_count, 4) if previous_count > 0 else None
    drop_alert = bool(drop_ratio is not None and drop_ratio < drop_threshold_ratio)

    status = "succeeded"
    reasons: list[str] = []
    if current_duplicates:
        status = "failed"
        reasons.append("duplicate_canonical_url_detected")
    if drop_alert:
        status = "failed"
        reasons.append("document_count_drop_exceeded_threshold")

    report = {
        "schema_version": UNIVERSITY_COLLECTION_COMPARE_SCHEMA_VERSION,
        "status": status,
        "current_run_report_path": str(current_report_path),
        "previous_run_report_path": str(previous_report_path),
        "current_projection_output_dir": str(current_projection),
        "previous_projection_output_dir": str(previous_projection),
        "drop_threshold_ratio": drop_threshold_ratio,
        "counts": {
            "previous_documents": previous_count,
            "current_documents": current_count,
            "missing_url_count": len(missing_urls),
            "new_url_count": len(new_urls),
            "duplicate_canonical_url_count": len(current_duplicates),
        },
        "drop_ratio": drop_ratio,
        "drop_alert": drop_alert,
        "failure_reasons": reasons,
        "missing_urls_sample": missing_urls[:50],
        "new_urls_sample": new_urls[:50],
        "duplicate_canonical_urls": current_duplicates[:50],
        "generated_at": _utc_now_iso(),
    }
    if output_path is not None:
        _write_json(Path(output_path).resolve(), report)
    return report


def build_official_web_university_collection_alert_summary(
    *,
    run_report: Mapping[str, Any],
    compare_report: Mapping[str, Any] | None = None,
    drop_threshold_ratio: float = 0.7,
) -> dict[str, Any]:
    alerts: list[dict[str, Any]] = []
    if _normalize_text(run_report.get("status")) != "succeeded":
        alerts.append(
            {
                "code": "run_failed",
                "severity": "error",
                "message": f"run status={_normalize_text(run_report.get('status')) or 'unknown'}",
            }
        )

    steps = run_report.get("steps")
    step_map = {
        _normalize_text(step.get("name")): step
        for step in (steps if isinstance(steps, list) else [])
        if isinstance(step, dict) and _normalize_text(step.get("name"))
    }

    for required in (
        "crawl",
        "validate",
        "qc_report",
        "projection_replay",
        "projection_validate",
        "chunk_audit",
    ):
        step = step_map.get(required)
        if not step:
            alerts.append(
                {
                    "code": f"missing_step:{required}",
                    "severity": "error",
                    "message": f"missing required step report: {required}",
                }
            )
            continue
        if _normalize_text(step.get("status")) != "succeeded":
            alerts.append(
                {
                    "code": f"step_failed:{required}",
                    "severity": "error",
                    "message": f"{required} failed",
                }
            )

    validate_output = step_map.get("validate", {}).get("output_json")
    if isinstance(validate_output, dict):
        errors = int((validate_output.get("counts") or {}).get("errors") or 0)
        if errors > 0:
            alerts.append(
                {
                    "code": "source_validation_errors",
                    "severity": "error",
                    "message": f"source-truth validation errors={errors}",
                }
            )

    qc_output = step_map.get("qc_report", {}).get("output_json")
    if isinstance(qc_output, dict):
        totals = qc_output.get("totals")
        if isinstance(totals, dict):
            fail_pages = int(totals.get("failPages") or 0)
            unexpected_review_pages = int(totals.get("unexpectedReviewPages") or 0)
            if fail_pages > 0:
                alerts.append(
                    {
                        "code": "qc_fail_pages",
                        "severity": "error",
                        "message": f"qc fail pages={fail_pages}",
                    }
                )
            if unexpected_review_pages > 0:
                alerts.append(
                    {
                        "code": "qc_unexpected_review_pages",
                        "severity": "warn",
                        "message": f"qc unexpected review pages={unexpected_review_pages}",
                    }
                )

    projection_replay_output = step_map.get("projection_replay", {}).get("output_json")
    if isinstance(projection_replay_output, dict):
        emitted = int((projection_replay_output.get("counts") or {}).get("emitted_documents") or 0)
        if emitted == 0:
            alerts.append(
                {
                    "code": "projection_zero_documents",
                    "severity": "error",
                    "message": "projection emitted zero documents",
                }
            )

    projection_validate_output = step_map.get("projection_validate", {}).get("output_json")
    if isinstance(projection_validate_output, dict):
        errors = int((projection_validate_output.get("counts") or {}).get("errors") or 0)
        if errors > 0:
            alerts.append(
                {
                    "code": "projection_validation_errors",
                    "severity": "error",
                    "message": f"projection validation errors={errors}",
                }
            )

    chunk_audit_output = step_map.get("chunk_audit", {}).get("output_json")
    if isinstance(chunk_audit_output, dict) and not bool(chunk_audit_output.get("passed")):
        alerts.append(
            {
                "code": "chunk_audit_failed",
                "severity": "error",
                "message": "chunk audit did not pass",
            }
        )

    if isinstance(compare_report, Mapping):
        compare_status = _normalize_text(compare_report.get("status"))
        if compare_status and compare_status != "succeeded":
            alerts.append(
                {
                    "code": "repeated_run_compare_failed",
                    "severity": "error",
                    "message": f"compare status={compare_status}",
                }
            )
        drop_ratio = compare_report.get("drop_ratio")
        if isinstance(drop_ratio, (int, float)) and float(drop_ratio) < float(drop_threshold_ratio):
            alerts.append(
                {
                    "code": "baseline_document_drop",
                    "severity": "error",
                    "message": (
                        f"document drop ratio={drop_ratio:.4f} below threshold="
                        f"{float(drop_threshold_ratio):.4f}"
                    ),
                }
            )

    status = "alert" if alerts else "ok"
    return {
        "schema_version": UNIVERSITY_COLLECTION_ALERT_SCHEMA_VERSION,
        "status": status,
        "generated_at": _utc_now_iso(),
        "run_id": _normalize_text(run_report.get("run_id")),
        "lane_id": _normalize_text(run_report.get("lane_id")),
        "alerts": alerts,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run school-level official-web collection dev closeout workflows.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    preflight = subparsers.add_parser("preflight")
    preflight.add_argument("--site-id", default="muc_public")
    preflight.add_argument("--lane-id", required=True)
    preflight.add_argument("--repo-root")
    preflight.add_argument("--config-root")
    preflight.add_argument("--run-root")
    preflight.add_argument("--report-dir")

    run = subparsers.add_parser("run")
    run.add_argument("--site-id", default="muc_public")
    run.add_argument("--lane-id", required=True)
    run.add_argument("--repo-root")
    run.add_argument("--config-root")
    run.add_argument("--run-root")
    run.add_argument("--report-dir")
    run.add_argument("--run-id")
    run.add_argument("--skip-preflight", action="store_true")
    run.add_argument("--import-dry-run", action=argparse.BooleanOptionalAction, default=False)
    run.add_argument("--require-promotable", action=argparse.BooleanOptionalAction, default=True)

    compare = subparsers.add_parser("compare")
    compare.add_argument("--current-run-report-path", required=True)
    compare.add_argument("--previous-run-report-path", required=True)
    compare.add_argument("--drop-threshold-ratio", type=float, default=0.7)
    compare.add_argument("--output-path")

    alert = subparsers.add_parser("alert-summary")
    alert.add_argument("--run-report-path", required=True)
    alert.add_argument("--compare-report-path")
    alert.add_argument("--output-path")
    alert.add_argument("--drop-threshold-ratio", type=float, default=0.7)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    if args.command == "preflight":
        report = run_official_web_university_collection_preflight(
            site_id=args.site_id,
            lane_id=args.lane_id,
            repo_root=args.repo_root,
            config_root=args.config_root,
            run_root=args.run_root,
            report_dir=args.report_dir,
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if report["status"] != "passed":
            raise SystemExit(1)
        return

    if args.command == "run":
        report = run_official_web_university_collection_lane(
            site_id=args.site_id,
            lane_id=args.lane_id,
            repo_root=args.repo_root,
            config_root=args.config_root,
            run_root=args.run_root,
            report_dir=args.report_dir,
            run_id=args.run_id,
            skip_preflight=bool(args.skip_preflight),
            import_dry_run=bool(args.import_dry_run),
            require_promotable=bool(args.require_promotable),
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if report["status"] != "succeeded":
            raise SystemExit(1)
        return

    if args.command == "compare":
        report = compare_official_web_university_collection_runs(
            current_run_report_path=args.current_run_report_path,
            previous_run_report_path=args.previous_run_report_path,
            drop_threshold_ratio=float(args.drop_threshold_ratio),
            output_path=args.output_path,
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if report["status"] != "succeeded":
            raise SystemExit(1)
        return

    if args.command == "alert-summary":
        run_report = _read_required_json(Path(args.run_report_path).resolve(), name="run report")
        compare_report: dict[str, Any] | None = None
        if args.compare_report_path:
            compare_report = _read_required_json(
                Path(args.compare_report_path).resolve(), name="compare report"
            )
        report = build_official_web_university_collection_alert_summary(
            run_report=run_report,
            compare_report=compare_report,
            drop_threshold_ratio=float(args.drop_threshold_ratio),
        )
        if args.output_path:
            _write_json(Path(args.output_path).resolve(), report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if report["status"] != "ok":
            raise SystemExit(1)
        return

    raise SystemExit(2)


__all__ = [
    "UNIVERSITY_COLLECTION_ALERT_SCHEMA_VERSION",
    "UNIVERSITY_COLLECTION_COMPARE_SCHEMA_VERSION",
    "UNIVERSITY_COLLECTION_PREFLIGHT_SCHEMA_VERSION",
    "UNIVERSITY_COLLECTION_RUN_SCHEMA_VERSION",
    "build_official_web_university_collection_alert_summary",
    "compare_official_web_university_collection_runs",
    "main",
    "run_official_web_university_collection_lane",
    "run_official_web_university_collection_preflight",
]


if __name__ == "__main__":
    main()
