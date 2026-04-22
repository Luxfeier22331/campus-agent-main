from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run authenticated notice bootstrap import smoke checks"
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--manifest-path")
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--entitlement-group", action="append", default=[])
    parser.add_argument("--visibility-scope", default="campus")
    parser.add_argument("--expect-notice-count", type=int)
    parser.add_argument("--summary-output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    entitlement_groups = tuple(
        str(item).strip() for item in args.entitlement_group if str(item).strip()
    )
    request = AuthenticatedNoticeImportRequest(
        bundle_path=Path(args.bundle_path),
        export_manifest_path=(Path(args.manifest_path) if args.manifest_path else None),
        site_id=args.site_id,
        source_home_url=args.source_home_url,
        corpus=args.corpus,
        collection=args.collection,
        default_entitlement_groups=(entitlement_groups or ("campus_members",)),
        visibility_scope=args.visibility_scope,
    )
    result = import_authenticated_notice_export(request=request)
    summary = build_smoke_summary(
        result=result,
        expected_notice_count=args.expect_notice_count,
        execution={
            "summary_generated_at": datetime.now(UTC).isoformat(),
            "bundle_path": str(request.bundle_path),
            "manifest_path": (
                str(request.export_manifest_path)
                if request.export_manifest_path is not None
                else None
            ),
            "site_id": request.site_id,
            "source_home_url": request.source_home_url,
            "corpus": request.corpus,
            "collection": request.collection,
            "entitlement_groups": list(request.default_entitlement_groups),
            "visibility_scope": request.visibility_scope,
        },
    )
    if args.summary_output_path:
        _write_summary(Path(args.summary_output_path), summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not summary["ok"]:
        raise SystemExit(1)


def build_smoke_summary(
    *,
    result: dict[str, Any],
    expected_notice_count: int | None,
    execution: dict[str, Any] | None = None,
) -> dict[str, Any]:
    notice_count = int(result.get("notice_count") or 0)
    errors = tuple(str(item) for item in result.get("errors") or [])
    created_document_ids = tuple(str(item) for item in result.get("created_document_ids") or [])
    updated_document_ids = tuple(str(item) for item in result.get("updated_document_ids") or [])
    skipped_document_ids = tuple(str(item) for item in result.get("skipped_document_ids") or [])
    raw_uploaded_count = int(result.get("raw_uploaded_count") or 0)
    raw_reused_count = int(result.get("raw_reused_count") or 0)
    checks = {
        "non_empty_notice_count": _check_status(notice_count > 0),
        "no_import_errors": _check_status(not errors),
        "document_outcomes_match_notice_count": _check_status(
            len(created_document_ids) + len(updated_document_ids) + len(skipped_document_ids)
            == notice_count
        ),
        "raw_asset_outcomes_match_notice_count": _check_status(
            raw_uploaded_count + raw_reused_count == notice_count
        ),
    }
    if expected_notice_count is not None:
        checks["expected_notice_count"] = _check_status(notice_count == expected_notice_count)
    summary = {
        "ok": all(status == "passed" for status in checks.values()),
        "checks": checks,
        "result": {
            "notice_count": notice_count,
            "created_document_ids": list(created_document_ids),
            "updated_document_ids": list(updated_document_ids),
            "skipped_document_ids": list(skipped_document_ids),
            "raw_uploaded_count": raw_uploaded_count,
            "raw_reused_count": raw_reused_count,
            "errors": list(errors),
        },
    }
    if execution is not None:
        summary["execution"] = execution
    return summary


def _write_summary(path: Path, summary: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{json.dumps(summary, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


def _check_status(passed: bool) -> str:
    return "passed" if passed else "failed"


__all__ = [
    "AuthenticatedNoticeImportRequest",
    "build_parser",
    "build_smoke_summary",
    "import_authenticated_notice_export",
    "main",
]


if __name__ == "__main__":
    main()
