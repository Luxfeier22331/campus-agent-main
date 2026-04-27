from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.internal_notice_consumption_admission import (
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)
from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.notice_consumption_projection import (
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticePurgeReport:
    source_corpus: str
    source_collection: str
    purged_notice_ids: tuple[str, ...]
    projection_removed_count: int
    read_model_removed_count: int
    batch_id: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Purge WeChat public-notice projection and read-model rows"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="wechat_public_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    notice_ids = normalize_notice_ids(args.notice_ids)
    if not notice_ids:
        parser.error("pass at least one --notice-id")
    source_corpus = str(args.corpus or "").strip() or "campus_notices"
    source_collection = str(args.collection or "").strip() or "wechat_public_notice"
    projection_store = build_notice_consumption_projection_store_from_env(prefer_operator=True)
    read_model_store = build_internal_notice_read_model_store_from_env(prefer_operator=True)
    admission_store = build_internal_notice_consumption_admission_store_from_env(
        prefer_operator=True
    )
    created_at = utc_now()
    batch_id = record_internal_notice_consumption_admission(
        source_corpus=source_corpus,
        source_collection=source_collection,
        command="wechat_public_notice_purge",
        notice_ids=notice_ids,
        status="started",
        created_at=created_at,
        selection_source="explicit_notice_ids",
        command_args={"notice_ids": list(notice_ids)},
        store=admission_store,
    )
    projection_removed_count = len(
        projection_store.list_by_scope(source_corpus, source_collection, notice_ids=notice_ids)
    )
    read_model_removed_count = len(
        read_model_store.list_by_scope(source_corpus, source_collection, notice_ids=notice_ids)
    )
    projection_store.replace_notices(
        source_corpus,
        source_collection,
        notice_ids=notice_ids,
        records=(),
    )
    read_model_store.replace_notices(
        source_corpus,
        source_collection,
        notice_ids=notice_ids,
        records=(),
    )
    batch_id = record_internal_notice_consumption_admission(
        source_corpus=source_corpus,
        source_collection=source_collection,
        command="wechat_public_notice_purge",
        notice_ids=notice_ids,
        status="completed",
        batch_id=batch_id,
        created_at=created_at,
        selection_source="explicit_notice_ids",
        command_args={"notice_ids": list(notice_ids)},
        result_counts={
            "projection_removed_count": projection_removed_count,
            "read_model_removed_count": read_model_removed_count,
        },
        store=admission_store,
    )
    report = WeChatPublicNoticePurgeReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        purged_notice_ids=notice_ids,
        projection_removed_count=projection_removed_count,
        read_model_removed_count=read_model_removed_count,
        batch_id=batch_id,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


__all__ = ["WeChatPublicNoticePurgeReport", "build_parser", "main"]


if __name__ == "__main__":
    main()
