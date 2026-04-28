from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from collections.abc import Sequence
from typing import Any

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
    build_notice_consumption_projection_store_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="List internal_notice service-status consumption projection candidates"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--consumption-status", action="append", default=[])
    parser.add_argument("--limit", type=int, default=200)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    statuses = _normalize(args.consumption_status)
    notice_ids = _normalize(args.notice_ids)
    limit = max(1, min(int(args.limit), 1000))
    store = build_notice_consumption_projection_store_from_env(
        dict(os.environ),
        prefer_operator=True,
    )
    entries = store.list_by_scope(
        args.corpus,
        args.collection,
        notice_ids=notice_ids,
    )
    candidates = _candidate_rows(entries, statuses=statuses, limit=limit)
    payload = {
        "source_corpus": args.corpus,
        "source_collection": args.collection,
        "selected_notice_ids": notice_ids,
        "consumption_statuses": statuses,
        "candidate_count": len(candidates),
        "notice_family_counts": dict(
            sorted(Counter(row["notice_family"] for row in candidates).items())
        ),
        "candidate_kind_counts": dict(
            sorted(Counter(row["service_status_candidate_kind"] for row in candidates).items())
        ),
        "candidates": candidates,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def _candidate_rows(
    entries: Sequence[NoticeConsumptionProjectionEntry],
    *,
    statuses: Sequence[str],
    limit: int,
) -> list[dict[str, Any]]:
    selected_statuses = set(statuses)
    rows: list[dict[str, Any]] = []
    for entry in sorted(entries, key=lambda item: (item.source_notice_id, item.unit_id)):
        if entry.target_surface != NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE:
            continue
        if selected_statuses and entry.consumption_status not in selected_statuses:
            continue
        metadata = dict(entry.role_metadata or {})
        rows.append(
            {
                "source_notice_id": entry.source_notice_id,
                "unit_id": entry.unit_id,
                "primary_role": entry.primary_role,
                "target_surface": entry.target_surface,
                "consumption_status": entry.consumption_status,
                "notice_family": str(metadata.get("notice_family") or "").strip(),
                "service_status_candidate_kind": (
                    str(metadata.get("service_status_candidate_kind") or "service_status").strip()
                    or "service_status"
                ),
                "notice_title": str(metadata.get("notice_title") or "").strip(),
                "source_notice_release_time": entry.source_notice_release_time or "",
                "source_notice_document_id": entry.source_notice_document_id,
                "source_document_id": entry.source_document_id,
                "source_ref": _source_ref(entry),
            }
        )
        if len(rows) >= limit:
            break
    return rows


def _source_ref(entry: NoticeConsumptionProjectionEntry) -> str:
    if entry.source_notice_document_id.startswith("notice:"):
        return entry.source_notice_document_id
    return f"notice:muc_internal_portal:{entry.source_notice_id}"


def _normalize(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
