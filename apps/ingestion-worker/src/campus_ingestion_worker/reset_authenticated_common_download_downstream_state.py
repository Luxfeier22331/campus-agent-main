from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict, is_dataclass
from typing import Any

from campus_ingestion_core.authenticated_common_download_downstream_reset import (
    reset_authenticated_common_download_downstream_state,
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
    parser = argparse.ArgumentParser(
        description="Reset authenticated common-download downstream contamination"
    )
    parser.add_argument("--site-id", default="muc_internal_portal")
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--yes", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if not args.yes:
        parser.error("pass --yes to execute reset")
    notice_ids = tuple(str(item).strip() for item in args.notice_id if str(item).strip())
    if not notice_ids:
        parser.error("pass at least one --notice-id")
    source = dict(os.environ)
    object_store_settings = ObjectStoreSettings.from_env(source)
    report = reset_authenticated_common_download_downstream_state(
        site_id=str(args.site_id or "").strip() or "muc_internal_portal",
        notice_ids=notice_ids,
        source_truth_inventory_store=build_authenticated_notice_source_truth_inventory_store_from_env(
            source,
            prefer_operator=True,
        ),
        document_registry=build_document_registry_from_env(source, prefer_operator=True),
        raw_asset_registry=build_raw_asset_registry_from_env(source, prefer_operator=True),
        projection_store=build_notice_consumption_projection_store_from_env(prefer_operator=True),
        read_model_store=build_internal_notice_read_model_store_from_env(prefer_operator=True),
        object_store=S3ObjectStoreAdmin(object_store_settings),
        source_bucket=object_store_settings.bucket_source,
        derived_bucket=object_store_settings.bucket_derived,
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
