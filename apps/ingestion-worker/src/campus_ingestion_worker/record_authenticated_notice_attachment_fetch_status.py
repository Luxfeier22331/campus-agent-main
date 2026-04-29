from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY,
    DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
    AuthenticatedNoticeAttachmentFetchStatusRecord,
    build_attachment_fetch_status_records_from_bundle_records,
    build_attachment_source_url_hash,
    build_authenticated_notice_attachment_fetch_status_store_from_env,
)
from campus_ingestion_core.authenticated_notice_import import (
    load_authenticated_notice_bundle_payload,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Record authenticated notice attachment fetch status rows from a bundle"
    )
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--site-id", default="muc_internal_portal")
    parser.add_argument("--observed-at")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    bundle_records = load_authenticated_notice_bundle_payload(Path(args.bundle_path))
    records = build_attachment_fetch_status_records_from_bundle_records(
        bundle_records=bundle_records,
        site_id=args.site_id,
        observed_at=args.observed_at,
    )
    store = build_authenticated_notice_attachment_fetch_status_store_from_env(
        dict(os.environ),
        prefer_operator=_has_operator_database_url(dict(os.environ)),
    )
    store.upsert_many(records)
    print(json.dumps(_summary(records), ensure_ascii=False, indent=2, sort_keys=True))


def _summary(
    records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
) -> dict[str, object]:
    notice_ids = sorted({record.notice_id for record in records})
    return {
        "record_count": len(records),
        "selected_notice_ids": notice_ids,
        "status_counts": dict(Counter(record.fetch_status for record in records)),
        "records": [asdict(record) for record in records],
    }


def _has_operator_database_url(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
            DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
        )
    )


__all__ = [
    "build_attachment_fetch_status_records_from_bundle_records",
    "build_attachment_source_url_hash",
    "build_authenticated_notice_attachment_fetch_status_store_from_env",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
