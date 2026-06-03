from __future__ import annotations

import copy
import unittest
from pathlib import Path

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    FETCH_STATUS_COLLECTED_INTERNAL,
    FETCH_STATUS_TERMINAL_UNAVAILABLE,
    TERMINAL_REASON_HTTP_404,
    InMemoryAuthenticatedNoticeAttachmentFetchStatusStore,
)
from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
)
from campus_ingestion_core.internal_notice_consumer_admission_builder import (
    build_internal_notice_consumer_admission_manifest_from_bundle_records,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    write_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.internal_notice_read_model import InMemoryInternalNoticeReadModelStore
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    InMemoryNoticeConsumptionProjectionStore,
)

from .authenticated_notice_import_test_support import *


def _write_consumer_manifest(
    path: Path,
    *,
    bundle_records: list[dict[str, object]],
    selection_path: str,
) -> None:
    config = load_authenticated_notice_notice_family_config(
        Path(
            "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
        )
    )
    manifest = build_internal_notice_consumer_admission_manifest_from_bundle_records(
        bundle_records=bundle_records,
        config=config,
        admission_run_id="consumer-admission-test",
        selection_source="bundle_dry_run",
        selection_path=selection_path,
        site_id="muc_internal_portal",
        created_at="2026-04-27T00:00:00+00:00",
    )
    write_internal_notice_consumer_admission_manifest(path, manifest)


def _sample_notice_bundle_with_id(
    notice_id: int,
    *,
    title: str,
    content: str,
) -> list[dict[str, object]]:
    bundle = copy.deepcopy(_sample_notice_bundle())
    bundle[0]["notice_id"] = notice_id
    notice = bundle[0]["notice"]
    if isinstance(notice, dict):
        notice["notice_id"] = notice_id
        notice["notice_title"] = title
        notice["notice_content"] = content
        for category in notice.get("categories") or ():
            if isinstance(category, dict):
                category["notice_id"] = notice_id
    for relation_key in ("links", "notice_attachments"):
        for relation in bundle[0].get(relation_key) or ():
            if isinstance(relation, dict):
                relation["notice_id"] = notice_id
    return bundle


__all__ = [name for name in globals() if not name.startswith("__")]
