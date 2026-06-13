from __future__ import annotations

from pathlib import Path
from typing import Any

from campus_ingestion_worker.official_web_university_collection_config import (
    _resolve_lane_and_hosts,
)
from campus_ingestion_worker.official_web_university_collection_constants import (
    UNIVERSITY_COLLECTION_RUN_SCHEMA_VERSION,
)
from campus_ingestion_worker.official_web_university_collection_io import (
    _default_report_dir,
    _default_run_id,
    _default_run_root,
    _non_empty_text,
    _normalize_text,
    _official_web_config_root,
    _read_required_json,
    _repo_root,
    _utc_now_iso,
    _write_json,
)
from campus_ingestion_worker.official_web_university_collection_preflight import (
    run_official_web_university_collection_preflight,
)
from campus_ingestion_worker.official_web_university_collection_runtime import (
    run_command as _run_command,
)
from campus_ingestion_worker.official_web_university_collection_runtime import (
    run_pipeline_step as _run_pipeline_step,
)


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

    preflight_report_path = resolved_report_dir / f"preflight-{effective_run_id}.json"
    preflight_report = _run_preflight_if_required(
        skip_preflight=skip_preflight,
        site_id=site_id,
        lane_id=lane_id,
        resolved_repo_root=resolved_repo_root,
        resolved_config_root=resolved_config_root,
        resolved_run_root=resolved_run_root,
        resolved_report_dir=resolved_report_dir,
        preflight_report_path=preflight_report_path,
    )
    if isinstance(preflight_report, dict) and preflight_report["status"] != "passed":
        return _write_failed_preflight_report(
            site_id=site_id,
            lane_id=lane_id,
            effective_run_id=effective_run_id,
            resolved_repo_root=resolved_repo_root,
            resolved_config_root=resolved_config_root,
            resolved_run_root=resolved_run_root,
            resolved_report_dir=resolved_report_dir,
            run_dir=run_dir,
            crawl_output_dir=crawl_output_dir,
            projection_output_dir=projection_output_dir,
            preflight_report_path=preflight_report_path,
        )

    lane = _resolve_lane_and_hosts(
        site_id=site_id,
        lane_id=lane_id,
        config_root=resolved_config_root,
    )[0]
    lane_hosts = [
        _non_empty_text(host, field="lane.host_filter[]")
        for host in lane.get("host_filter", [])
        if _normalize_text(host)
    ]
    run_intent = _non_empty_text(lane.get("run_intent"), field="lane.run_intent")
    max_pages_per_host = int(lane.get("max_pages_per_host") or 0)
    max_total_pages = int(lane.get("max_total_pages") or 0)

    started_at = _utc_now_iso()
    steps, failed_step = _run_collection_steps(
        site_id=site_id,
        effective_run_id=effective_run_id,
        lane_hosts=lane_hosts,
        run_intent=run_intent,
        max_pages_per_host=max_pages_per_host,
        max_total_pages=max_total_pages,
        resolved_repo_root=resolved_repo_root,
        crawl_output_dir=crawl_output_dir,
        projection_output_dir=projection_output_dir,
        import_work_dir=import_work_dir,
        import_dry_run=import_dry_run,
        require_promotable=require_promotable,
        command_runner=command_runner,
    )
    return _write_run_report(
        site_id=site_id,
        lane_id=lane_id,
        effective_run_id=effective_run_id,
        started_at=started_at,
        resolved_repo_root=resolved_repo_root,
        resolved_config_root=resolved_config_root,
        resolved_run_root=resolved_run_root,
        resolved_report_dir=resolved_report_dir,
        run_dir=run_dir,
        crawl_output_dir=crawl_output_dir,
        projection_output_dir=projection_output_dir,
        preflight_report_path=preflight_report_path,
        preflight_report=preflight_report,
        import_dry_run=import_dry_run,
        require_promotable=require_promotable,
        run_intent=run_intent,
        lane_hosts=lane_hosts,
        max_pages_per_host=max_pages_per_host,
        max_total_pages=max_total_pages,
        failed_step=failed_step,
        steps=steps,
    )


def _run_preflight_if_required(
    *,
    skip_preflight: bool,
    site_id: str,
    lane_id: str,
    resolved_repo_root: Path,
    resolved_config_root: Path,
    resolved_run_root: Path,
    resolved_report_dir: Path,
    preflight_report_path: Path,
) -> dict[str, Any] | None:
    if skip_preflight:
        return None
    preflight_report = run_official_web_university_collection_preflight(
        site_id=site_id,
        lane_id=lane_id,
        repo_root=resolved_repo_root,
        config_root=resolved_config_root,
        run_root=resolved_run_root,
        report_dir=resolved_report_dir,
    )
    _write_json(preflight_report_path, preflight_report)
    return preflight_report


def _run_collection_steps(
    *,
    site_id: str,
    effective_run_id: str,
    lane_hosts: list[str],
    run_intent: str,
    max_pages_per_host: int,
    max_total_pages: int,
    resolved_repo_root: Path,
    crawl_output_dir: Path,
    projection_output_dir: Path,
    import_work_dir: Path,
    import_dry_run: bool,
    require_promotable: bool,
    command_runner: Any,
) -> tuple[list[dict[str, Any]], str | None]:
    steps: list[dict[str, Any]] = []
    failed_step: str | None = None
    failed_step = _run_crawl_step(
        steps=steps,
        failed_step=failed_step,
        site_id=site_id,
        effective_run_id=effective_run_id,
        lane_hosts=lane_hosts,
        run_intent=run_intent,
        max_pages_per_host=max_pages_per_host,
        max_total_pages=max_total_pages,
        resolved_repo_root=resolved_repo_root,
        crawl_output_dir=crawl_output_dir,
        command_runner=command_runner,
    )
    failed_step = _run_json_validated_step(
        steps=steps,
        failed_step=failed_step,
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
        resolved_repo_root=resolved_repo_root,
        command_runner=command_runner,
        success_key="valid",
    )
    failed_step = _run_json_validated_step(
        steps=steps,
        failed_step=failed_step,
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
        resolved_repo_root=resolved_repo_root,
        command_runner=command_runner,
        success_key="valid",
    )
    failed_step = _run_projection_replay_step(
        steps=steps,
        failed_step=failed_step,
        resolved_repo_root=resolved_repo_root,
        crawl_output_dir=crawl_output_dir,
        projection_output_dir=projection_output_dir,
        command_runner=command_runner,
    )
    failed_step = _run_json_validated_step(
        steps=steps,
        failed_step=failed_step,
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
        resolved_repo_root=resolved_repo_root,
        command_runner=command_runner,
        success_key="valid",
    )
    failed_step = _run_json_validated_step(
        steps=steps,
        failed_step=failed_step,
        step_name="chunk_audit",
        command=[
            "uv",
            "run",
            "--all-packages",
            "python",
            "-m",
            "campus_ingestion_worker.audit_official_web_projection_chunking",
            "--projection-output-dir",
            str(projection_output_dir),
        ],
        resolved_repo_root=resolved_repo_root,
        command_runner=command_runner,
        success_key="passed",
    )
    if failed_step is None and import_dry_run:
        failed_step = _run_import_dry_run_steps(
            steps=steps,
            resolved_repo_root=resolved_repo_root,
            crawl_output_dir=crawl_output_dir,
            projection_output_dir=projection_output_dir,
            import_work_dir=import_work_dir,
            require_promotable=require_promotable,
            command_runner=command_runner,
        )
    return steps, failed_step


def _run_crawl_step(
    *,
    steps: list[dict[str, Any]],
    failed_step: str | None,
    site_id: str,
    effective_run_id: str,
    lane_hosts: list[str],
    run_intent: str,
    max_pages_per_host: int,
    max_total_pages: int,
    resolved_repo_root: Path,
    crawl_output_dir: Path,
    command_runner: Any,
) -> str | None:
    if failed_step is not None:
        return failed_step
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
    return "crawl" if step["status"] != "succeeded" else None


def _run_json_validated_step(
    *,
    steps: list[dict[str, Any]],
    failed_step: str | None,
    step_name: str,
    command: list[str],
    resolved_repo_root: Path,
    command_runner: Any,
    success_key: str,
) -> str | None:
    if failed_step is not None:
        return failed_step
    step = _run_pipeline_step(
        step_name=step_name,
        command=command,
        cwd=resolved_repo_root,
        require_json=True,
        command_runner=command_runner,
    )
    steps.append(step)
    output = step.get("output_json")
    if (
        step["status"] != "succeeded"
        or not isinstance(output, dict)
        or not bool(output.get(success_key))
    ):
        return step_name
    return None


def _run_projection_replay_step(
    *,
    steps: list[dict[str, Any]],
    failed_step: str | None,
    resolved_repo_root: Path,
    crawl_output_dir: Path,
    projection_output_dir: Path,
    command_runner: Any,
) -> str | None:
    if failed_step is not None:
        return failed_step
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
    return "projection_replay" if step["status"] != "succeeded" else None


def _run_import_dry_run_steps(
    *,
    steps: list[dict[str, Any]],
    resolved_repo_root: Path,
    crawl_output_dir: Path,
    projection_output_dir: Path,
    import_work_dir: Path,
    require_promotable: bool,
    command_runner: Any,
) -> str | None:
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
            return f"import_dry_run:{collection}"
    return None


def _write_failed_preflight_report(
    *,
    site_id: str,
    lane_id: str,
    effective_run_id: str,
    resolved_repo_root: Path,
    resolved_config_root: Path,
    resolved_run_root: Path,
    resolved_report_dir: Path,
    run_dir: Path,
    crawl_output_dir: Path,
    projection_output_dir: Path,
    preflight_report_path: Path,
) -> dict[str, Any]:
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


def _write_run_report(
    *,
    site_id: str,
    lane_id: str,
    effective_run_id: str,
    started_at: str,
    resolved_repo_root: Path,
    resolved_config_root: Path,
    resolved_run_root: Path,
    resolved_report_dir: Path,
    run_dir: Path,
    crawl_output_dir: Path,
    projection_output_dir: Path,
    preflight_report_path: Path,
    preflight_report: dict[str, Any] | None,
    import_dry_run: bool,
    require_promotable: bool,
    run_intent: str,
    lane_hosts: list[str],
    max_pages_per_host: int,
    max_total_pages: int,
    failed_step: str | None,
    steps: list[dict[str, Any]],
) -> dict[str, Any]:
    report = {
        "schema_version": UNIVERSITY_COLLECTION_RUN_SCHEMA_VERSION,
        "status": "failed" if failed_step else "succeeded",
        "site_id": site_id,
        "lane_id": lane_id,
        "run_id": effective_run_id,
        "started_at": started_at,
        "finished_at": _utc_now_iso(),
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
