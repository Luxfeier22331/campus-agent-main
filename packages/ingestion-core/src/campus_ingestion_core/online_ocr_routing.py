from __future__ import annotations

from campus_ingestion_core.file_asset_routing import (
    MINERU_ADAPTED_PARSER_VERSION,
    MINERU_PROVIDER,
    OnlineOcrRoutingDecision,
    PADDLE_ASYNC_PROVIDER,
    PADDLE_PARSER_VERSION,
    RAW_PROVIDER_RESPONSE_ARCHIVE_FILENAME,
    adapt_mineru_archive_to_canonical_provider_payload,
    select_adjudicated_image_routing,
    select_online_ocr_routing as _select_file_asset_online_ocr_routing,
)
from campus_ingestion_core.models import RawAssetRecord


def select_online_ocr_routing(
    *,
    raw_asset_record: RawAssetRecord,
    mineru_available: bool,
) -> OnlineOcrRoutingDecision:
    return _select_file_asset_online_ocr_routing(
        asset_kind=raw_asset_record.asset_kind,
        asset_subkind=raw_asset_record.asset_subkind,
        mineru_available=mineru_available,
    )


__all__ = [
    "MINERU_ADAPTED_PARSER_VERSION",
    "MINERU_PROVIDER",
    "OnlineOcrRoutingDecision",
    "PADDLE_ASYNC_PROVIDER",
    "PADDLE_PARSER_VERSION",
    "RAW_PROVIDER_RESPONSE_ARCHIVE_FILENAME",
    "adapt_mineru_archive_to_canonical_provider_payload",
    "select_adjudicated_image_routing",
    "select_online_ocr_routing",
]
