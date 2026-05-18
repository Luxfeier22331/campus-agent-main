from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
    AuthenticatedNoticeAttachmentFetchStatusRecord,
    build_authenticated_notice_attachment_fetch_status_store_from_env,
)
from campus_ingestion_core.registry import SHARED_POSTGRES_OPERATOR_ENV_KEY

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Show authenticated notice attachment fetch status rows"
    )
    parser.add_argument("--site-id", default="muc_internal_portal")
    parser.add_argument("--notice-id", action="append", default=[])
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    notice_ids = tuple(str(item).strip() for item in args.notice_id if str(item).strip())
    store = build_authenticated_notice_attachment_fetch_status_store_from_env(
        dict(os.environ),
        prefer_operator=_has_operator_database_url(dict(os.environ)),
    )
    records = store.list_by_notice_ids(site_id=args.site_id, notice_ids=notice_ids)
    print(
        json.dumps(
            _summary(site_id=args.site_id, notice_ids=notice_ids, records=records),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def _summary(
    *,
    site_id: str,
    notice_ids: Sequence[str],
    records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
) -> dict[str, object]:
    return {
        "site_id": site_id,
        "notice_ids": list(notice_ids),
        "record_count": len(records),
        "status_counts": dict(Counter(record.fetch_status for record in records)),
        "records": [asdict(record) for record in records],
    }


def _has_operator_database_url(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
        )
    )


__all__ = [
    "build_authenticated_notice_attachment_fetch_status_store_from_env",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
