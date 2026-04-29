from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict, is_dataclass
from typing import Any

from campus_ingestion_core.authenticated_document_holding_status import (
    build_authenticated_document_holding_status_report,
)
from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    build_authenticated_notice_file_release_inventory_store_from_env,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    build_notice_consumption_projection_store_from_env,
)
from campus_ingestion_core.registry import (
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Show authenticated document holding status")
    parser.add_argument("--corpus", default="authenticated_documents")
    parser.add_argument(
        "--collection",
        default="common_download_source",
        choices=("common_download_source", "file_release_source"),
    )
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--file-release-id", action="append", default=[])
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    source = dict(os.environ)
    object_store_settings = ObjectStoreSettings.from_env(source)
    report = build_authenticated_document_holding_status_report(
        source_corpus=str(args.corpus or "").strip() or "authenticated_documents",
        source_collection=str(args.collection or "").strip() or "common_download_source",
        notice_ids=tuple(str(item).strip() for item in args.notice_id if str(item).strip()),
        file_release_ids=tuple(
            str(item).strip() for item in args.file_release_id if str(item).strip()
        ),
        document_registry=build_document_registry_from_env(source, prefer_operator=True),
        raw_asset_registry=build_raw_asset_registry_from_env(source, prefer_operator=True),
        source_truth_inventory_store=build_authenticated_notice_source_truth_inventory_store_from_env(
            source,
            prefer_operator=True,
        ),
        file_release_inventory_store=build_authenticated_notice_file_release_inventory_store_from_env(
            source,
            prefer_operator=True,
        ),
        projection_store=build_notice_consumption_projection_store_from_env(prefer_operator=True),
        read_model_store=build_internal_notice_read_model_store_from_env(prefer_operator=True),
        object_store=S3ObjectStoreAdmin(object_store_settings),
        source_bucket=object_store_settings.bucket_source,
    )
    payload = asdict(report) if is_dataclass(report) else _normalize_payload(report)
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def _normalize_payload(result: Any) -> Any:
    if isinstance(result, dict):
        return result
    raise TypeError("worker result must be a dataclass or dict")


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
