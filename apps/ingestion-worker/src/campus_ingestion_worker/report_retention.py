from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.resource_profile import utc_now_iso

REPORT_RETENTION_SCHEMA_VERSION = "campus_ingestion_report_retention.v1"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prune old on-demand ingestion reports while preserving recent failures."
    )
    parser.add_argument(
        "--report-dir",
        default=os.getenv("INGESTION_ON_DEMAND_REPORT_DIR", ".tmp/ingestion-reports"),
    )
    parser.add_argument(
        "--max-age-days",
        type=_positive_int,
        default=int(os.getenv("INGESTION_REPORT_RETENTION_MAX_AGE_DAYS", "14")),
    )
    parser.add_argument(
        "--max-count",
        type=_positive_int,
        default=int(os.getenv("INGESTION_REPORT_RETENTION_MAX_COUNT", "200")),
    )
    parser.add_argument(
        "--keep-failed",
        action=argparse.BooleanOptionalAction,
        default=_env_bool("INGESTION_REPORT_RETENTION_KEEP_FAILED", default=True),
    )
    parser.add_argument(
        "--failed-index-path",
        default="",
        help="Optional path for failed report index JSON. Defaults to <report-dir>/failed-index.json.",
    )
    parser.add_argument(
        "--dry-run",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Compute deletion candidates without removing report files.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = prune_report_directory(
        report_dir=Path(args.report_dir),
        max_age_days=args.max_age_days,
        max_count=args.max_count,
        keep_failed=bool(args.keep_failed),
        dry_run=bool(args.dry_run),
        failed_index_path=Path(args.failed_index_path)
        if str(args.failed_index_path).strip()
        else None,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if report["status"] != "succeeded":
        raise SystemExit(1)


def prune_report_directory(
    *,
    report_dir: Path,
    max_age_days: int,
    max_count: int,
    keep_failed: bool,
    dry_run: bool = False,
    failed_index_path: Path | None = None,
) -> dict[str, Any]:
    started_at = utc_now_iso()
    report_dir.mkdir(parents=True, exist_ok=True)
    failed_index = failed_index_path or report_dir / "failed-index.json"
    failed_index.parent.mkdir(parents=True, exist_ok=True)

    now = datetime.now(UTC)
    age_cutoff = now - timedelta(days=max_age_days)
    candidates = _load_report_candidates(report_dir=report_dir)
    to_delete: set[Path] = set()
    failed_reports: list[dict[str, Any]] = []

    for candidate in candidates:
        if candidate["is_failed"]:
            failed_reports.append(candidate["index_item"])
            if keep_failed:
                continue
        if candidate["mtime"] < age_cutoff:
            to_delete.add(candidate["path"])

    survivors = [item for item in candidates if item["path"] not in to_delete]
    if len(survivors) > max_count:
        overflow = len(survivors) - max_count
        ordered = sorted(survivors, key=lambda item: item["mtime"])
        for item in ordered:
            if overflow <= 0:
                break
            if keep_failed and item["is_failed"]:
                continue
            if item["path"] in to_delete:
                continue
            to_delete.add(item["path"])
            overflow -= 1

    deleted_paths: list[str] = []
    for path in sorted(to_delete):
        if dry_run:
            deleted_paths.append(str(path))
            continue
        try:
            path.unlink()
        except FileNotFoundError:
            continue
        except OSError:
            return _build_report(
                status="failed",
                started_at=started_at,
                report_dir=report_dir,
                failed_index=failed_index,
                max_age_days=max_age_days,
                max_count=max_count,
                keep_failed=keep_failed,
                dry_run=dry_run,
                total_candidates=len(candidates),
                deleted_paths=deleted_paths,
                failed_reports=failed_reports,
                error=f"failed to delete report file: {path}",
            )
        deleted_paths.append(str(path))

    failed_index.write_text(
        json.dumps(
            {
                "schema_version": "campus_ingestion_failed_report_index.v1",
                "generated_at": utc_now_iso(),
                "report_dir": str(report_dir),
                "failed_report_count": len(failed_reports),
                "failed_reports": sorted(failed_reports, key=lambda item: str(item["report_path"])),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return _build_report(
        status="succeeded",
        started_at=started_at,
        report_dir=report_dir,
        failed_index=failed_index,
        max_age_days=max_age_days,
        max_count=max_count,
        keep_failed=keep_failed,
        dry_run=dry_run,
        total_candidates=len(candidates),
        deleted_paths=deleted_paths,
        failed_reports=failed_reports,
        error=None,
    )


def _load_report_candidates(report_dir: Path) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for path in sorted(report_dir.glob("*.json")):
        if path.name == "failed-index.json":
            continue
        report = _load_json(path)
        is_failed = str(report.get("status") or "").strip().lower() == "failed"
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
        candidates.append(
            {
                "path": path,
                "mtime": mtime,
                "is_failed": is_failed,
                "index_item": {
                    "report_path": str(path),
                    "batch_kind": str(report.get("batch_kind") or ""),
                    "status": str(report.get("status") or ""),
                    "finished_at": str(report.get("finished_at") or ""),
                    "failed_step": str(report.get("failed_step") or ""),
                    "resource_budget_status": str(
                        (
                            report.get("resource_budget")
                            if isinstance(report.get("resource_budget"), dict)
                            else {}
                        ).get("status")
                        or ""
                    ),
                },
            }
        )
    return candidates


def _load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if isinstance(payload, dict):
        return payload
    return {}


def _build_report(
    *,
    status: str,
    started_at: str,
    report_dir: Path,
    failed_index: Path,
    max_age_days: int,
    max_count: int,
    keep_failed: bool,
    dry_run: bool,
    total_candidates: int,
    deleted_paths: list[str],
    failed_reports: list[dict[str, Any]],
    error: str | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema_version": REPORT_RETENTION_SCHEMA_VERSION,
        "status": status,
        "started_at": started_at,
        "finished_at": utc_now_iso(),
        "report_dir": str(report_dir),
        "failed_index_path": str(failed_index),
        "policy": {
            "max_age_days": int(max_age_days),
            "max_count": int(max_count),
            "keep_failed": bool(keep_failed),
            "dry_run": bool(dry_run),
        },
        "total_candidates": int(total_candidates),
        "deleted_count": len(deleted_paths),
        "deleted_paths": deleted_paths,
        "failed_report_count": len(failed_reports),
    }
    if error:
        payload["error"] = error
    return payload


def _env_bool(key: str, *, default: bool) -> bool:
    raw = str(os.getenv(key) or "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{key} must be a boolean value")


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


__all__ = [
    "REPORT_RETENTION_SCHEMA_VERSION",
    "build_parser",
    "main",
    "prune_report_directory",
]


if __name__ == "__main__":
    main()
