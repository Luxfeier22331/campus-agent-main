from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_browser_url_backfill import (
    backfill_authenticated_notice_browser_urls,
)
from campus_ingestion_core.authenticated_notice_import import (
    load_authenticated_notice_bundle_payload,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Audit authenticated notice browser URL coverage across one or more bundles, "
            "and optionally write backfilled bundles."
        )
    )
    parser.add_argument("--bundle-path", action="append", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--summary-output-path", required=True)
    parser.add_argument("--output-dir")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    summary = audit_authenticated_notice_browser_url_bundles(
        bundle_paths=[Path(item) for item in args.bundle_path],
        output_dir=Path(args.output_dir) if args.output_dir else None,
        source_home_url=args.source_home_url,
    )
    _write_json(Path(args.summary_output_path), summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def audit_authenticated_notice_browser_url_bundles(
    *,
    bundle_paths: Sequence[Path],
    output_dir: Path | None,
    source_home_url: str,
) -> dict[str, Any]:
    bundle_summaries: list[dict[str, Any]] = []
    totals = _empty_totals()
    output_names_seen: set[str] = set()

    for index, bundle_path in enumerate(bundle_paths, start=1):
        result = backfill_authenticated_notice_browser_urls(
            bundle_records=load_authenticated_notice_bundle_payload(bundle_path),
            source_home_url=source_home_url,
        )
        output_path = _bundle_output_path(
            bundle_path=bundle_path,
            index=index,
            output_dir=output_dir,
            output_names_seen=output_names_seen,
        )
        if output_path is not None:
            _write_json(output_path, list(result.bundle_records))

        bundle_summary = {
            **result.summary,
            "bundle_path": str(bundle_path),
            "output_bundle_path": str(output_path) if output_path is not None else None,
        }
        bundle_summaries.append(bundle_summary)
        _add_summary(totals, result.summary)

    return {
        "bundle_count": len(bundle_summaries),
        **totals,
        "bundles": bundle_summaries,
    }


def _bundle_output_path(
    *,
    bundle_path: Path,
    index: int,
    output_dir: Path | None,
    output_names_seen: set[str],
) -> Path | None:
    if output_dir is None:
        return None
    candidate_name = bundle_path.name
    if candidate_name in output_names_seen:
        candidate_name = f"{bundle_path.stem}-{index}{bundle_path.suffix}"
    output_names_seen.add(candidate_name)
    return output_dir / candidate_name


def _empty_totals() -> dict[str, Any]:
    return {
        "records_seen": 0,
        "already_present_count": 0,
        "backfilled_count": 0,
        "missing_notice_type_count": 0,
        "unavailable_count": 0,
        "notice_browser_url_source_counts": {
            "api_notice_link": 0,
            "portal_print_route": 0,
            "unavailable": 0,
        },
    }


def _add_summary(totals: dict[str, Any], summary: dict[str, Any]) -> None:
    for key in (
        "records_seen",
        "already_present_count",
        "backfilled_count",
        "missing_notice_type_count",
        "unavailable_count",
    ):
        totals[key] = int(totals.get(key) or 0) + int(summary.get(key) or 0)
    source_counts = totals["notice_browser_url_source_counts"]
    for source, count in dict(summary.get("notice_browser_url_source_counts") or {}).items():
        source_counts[str(source)] = int(source_counts.get(str(source)) or 0) + int(count or 0)


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
