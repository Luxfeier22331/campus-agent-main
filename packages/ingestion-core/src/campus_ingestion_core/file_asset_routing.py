from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image

from campus_ingestion_core.file_asset_routing_mineru_archive import (
    adapt_mineru_archive_to_canonical_provider_payload,
)

_EXTENSION_CONTENT_TYPES = {
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".gif": "image/gif",
    ".htm": "text/html; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain; charset=utf-8",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
_OFFICE_EXTENSIONS = {
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
}
_TEXT_EXTENSIONS = {
    ".csv",
    ".htm",
    ".html",
    ".txt",
}
_SPATIAL_FILENAME_HINTS = (
    "map",
    "campus-map",
    "floor-plan",
    "floor_map",
    "navigation",
    "route",
    "地图",
    "平面图",
    "导览",
    "导航",
    "路线",
    "楼层",
    "示意图",
)

PADDLE_ASYNC_PROVIDER = "paddleocr_async_jobs"
MINERU_PROVIDER = "mineru_api"
PADDLE_PARSER_VERSION = "paddleocr-vl-1.5"
MINERU_ADAPTED_PARSER_VERSION = "mineru-vlm-adapted-v2"
RAW_PROVIDER_RESPONSE_ARCHIVE_FILENAME = "provider-response-raw.zip"
RAW_PROVIDER_RESPONSE_MANIFEST_FILENAME = "provider-response-raw.manifest.json"
RAW_PROVIDER_RESPONSE_SEGMENT_FILENAME_TEMPLATE = "provider-response-raw.part-{index:04d}.zip"

_MINERU_COMPLEX_IMAGE_SUBKINDS = {
    "complex_table_image",
    "wide_table_image",
    "wide_color_table_image",
    "merged_cell_table_image",
}
_PADDLE_PRIMARY_IMAGE_SUBKINDS = {
    "generic_image",
    "simple_table_image",
}
_DEFERRED_SUBKINDS = {
    "office_document",
    "semantic_image",
    "text_document",
    "spatial_image",
    "map_image",
}


@dataclass(frozen=True, slots=True)
class RawAssetTypedMetadata:
    content_type: str | None
    file_extension: str
    byte_size: int
    page_count: int | None
    image_width: int | None
    image_height: int | None
    asset_kind: str
    asset_subkind: str
    classification_confidence: float | None


@dataclass(frozen=True, slots=True)
class RawAssetTypeRefinement:
    asset_kind: str
    asset_subkind: str
    classification_confidence: float | None
    reason_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class OnlineOcrRoutingDecision:
    route_id: str
    canonical_allowed: bool
    canonical_provider: str | None
    fallback_provider: str | None
    parser_version: str | None
    reason_codes: tuple[str, ...]
    persist_raw_provider_artifact: bool


def infer_raw_asset_typed_metadata(
    *, source_path: Path, file_bytes: bytes
) -> RawAssetTypedMetadata:
    extension = source_path.suffix.strip().lower()
    guessed_content_type, _ = mimetypes.guess_type(source_path.name)
    content_type = _normalize_content_type(
        _EXTENSION_CONTENT_TYPES.get(extension)
        or guessed_content_type
        or "application/octet-stream"
    )
    byte_size = len(file_bytes)

    if extension == ".pdf" or content_type == "application/pdf":
        return RawAssetTypedMetadata(
            content_type="application/pdf",
            file_extension=".pdf",
            byte_size=byte_size,
            page_count=None,
            image_width=None,
            image_height=None,
            asset_kind="document",
            asset_subkind="pdf",
            classification_confidence=1.0,
        )

    if content_type.startswith("image/"):
        width: int | None = None
        height: int | None = None
        page_count: int | None = 1
        try:
            with Image.open(BytesIO(file_bytes)) as image:
                width, height = image.size
                page_count = int(getattr(image, "n_frames", 1) or 1)
        except Exception:
            width = None
            height = None
            page_count = 1
        return RawAssetTypedMetadata(
            content_type=content_type,
            file_extension=extension,
            byte_size=byte_size,
            page_count=page_count,
            image_width=width,
            image_height=height,
            asset_kind="image",
            asset_subkind="generic_image",
            classification_confidence=1.0 if extension else 0.75,
        )

    if extension in _OFFICE_EXTENSIONS:
        return RawAssetTypedMetadata(
            content_type=content_type,
            file_extension=extension,
            byte_size=byte_size,
            page_count=None,
            image_width=None,
            image_height=None,
            asset_kind="document",
            asset_subkind="office_document",
            classification_confidence=1.0,
        )

    if extension in _TEXT_EXTENSIONS:
        return RawAssetTypedMetadata(
            content_type=content_type,
            file_extension=extension,
            byte_size=byte_size,
            page_count=None,
            image_width=None,
            image_height=None,
            asset_kind="document",
            asset_subkind="text_document",
            classification_confidence=1.0,
        )

    return RawAssetTypedMetadata(
        content_type=content_type,
        file_extension=extension,
        byte_size=byte_size,
        page_count=None,
        image_width=None,
        image_height=None,
        asset_kind="binary" if content_type == "application/octet-stream" else "document",
        asset_subkind="unknown",
        classification_confidence=0.25 if content_type == "application/octet-stream" else 0.5,
    )


def refine_raw_asset_typed_metadata_with_ocr_evidence(
    *,
    typed_metadata: RawAssetTypedMetadata,
    source_name: str,
    candidate_summary: dict[str, object],
    baseline_summary: dict[str, object],
    adjudication: dict[str, Any],
) -> RawAssetTypeRefinement:
    current_subkind = typed_metadata.asset_subkind.strip().lower()
    if typed_metadata.asset_kind != "image":
        return RawAssetTypeRefinement(
            asset_kind=typed_metadata.asset_kind,
            asset_subkind=typed_metadata.asset_subkind,
            classification_confidence=typed_metadata.classification_confidence,
            reason_codes=("non_image_passthrough",),
        )
    if current_subkind and current_subkind != "generic_image":
        return RawAssetTypeRefinement(
            asset_kind=typed_metadata.asset_kind,
            asset_subkind=typed_metadata.asset_subkind,
            classification_confidence=typed_metadata.classification_confidence,
            reason_codes=("preclassified_image_passthrough",),
        )

    candidate_signals = _structure_signals(candidate_summary)
    baseline_signals = _structure_signals(baseline_summary)
    max_table_rows = max(candidate_signals["table_row_count"], baseline_signals["table_row_count"])
    max_nonempty_lines = max(
        candidate_signals["nonempty_line_count"],
        baseline_signals["nonempty_line_count"],
    )
    max_image_refs = max(
        candidate_signals["image_reference_count"],
        baseline_signals["image_reference_count"],
    )
    aspect_ratio = _aspect_ratio(typed_metadata=typed_metadata)
    winner = str(adjudication.get("winner") or "")
    reason_codes = tuple(
        str(item) for item in list(adjudication.get("reason_codes") or []) if str(item).strip()
    )
    source_name_lower = source_name.strip().lower()

    if _has_spatial_filename_hint(source_name_lower) and max_table_rows == 0:
        return RawAssetTypeRefinement(
            asset_kind="image",
            asset_subkind="spatial_image",
            classification_confidence=0.95,
            reason_codes=("spatial_filename_hint", *reason_codes),
        )
    if max_image_refs >= 1 and max_table_rows == 0 and max_nonempty_lines <= 8:
        return RawAssetTypeRefinement(
            asset_kind="image",
            asset_subkind="spatial_image",
            classification_confidence=0.8,
            reason_codes=("image_reference_without_table_structure", *reason_codes),
        )

    if (
        max_table_rows >= 6
        or (aspect_ratio is not None and aspect_ratio >= 1.8 and max_table_rows >= 3)
        or "candidate_structure_advantage" in reason_codes
    ):
        refinement_reasons = []
        if max_table_rows >= 6:
            refinement_reasons.append("dense_table_structure")
        if aspect_ratio is not None and aspect_ratio >= 1.8 and max_table_rows >= 3:
            refinement_reasons.append("wide_aspect_ratio")
        if "candidate_structure_advantage" in reason_codes:
            refinement_reasons.append("candidate_structure_advantage")
        return RawAssetTypeRefinement(
            asset_kind="image",
            asset_subkind="complex_table_image",
            classification_confidence=0.92,
            reason_codes=tuple(refinement_reasons or ("complex_table_structure",)),
        )

    if max_table_rows >= 2:
        refinement_reasons = ["table_structure_detected"]
        if winner == "baseline":
            refinement_reasons.append("baseline_kept_as_safe_table_provider")
        if "candidate_empty_output" in reason_codes or "candidate_provider_failure" in reason_codes:
            refinement_reasons.append("mineru_not_safe_for_this_table")
        return RawAssetTypeRefinement(
            asset_kind="image",
            asset_subkind="simple_table_image",
            classification_confidence=0.9,
            reason_codes=tuple(refinement_reasons),
        )

    if not _usable_output(candidate_summary) and not _usable_output(baseline_summary):
        return RawAssetTypeRefinement(
            asset_kind="image",
            asset_subkind="generic_image",
            classification_confidence=0.5,
            reason_codes=("no_usable_ocr_output",),
        )

    return RawAssetTypeRefinement(
        asset_kind="image",
        asset_subkind="generic_image",
        classification_confidence=0.55,
        reason_codes=("insufficient_refinement_signal",),
    )


def select_online_ocr_routing(
    *,
    asset_kind: str,
    asset_subkind: str,
    mineru_available: bool,
) -> OnlineOcrRoutingDecision:
    normalized_asset_kind = asset_kind.strip().lower()
    normalized_asset_subkind = asset_subkind.strip().lower()

    if normalized_asset_subkind == "pdf":
        if mineru_available:
            return OnlineOcrRoutingDecision(
                route_id="pdf_mineru_primary_with_paddle_fallback",
                canonical_allowed=True,
                canonical_provider=MINERU_PROVIDER,
                fallback_provider=PADDLE_ASYNC_PROVIDER,
                parser_version=MINERU_ADAPTED_PARSER_VERSION,
                reason_codes=("asset_subkind_pdf", "mineru_available", "pdf_primary_candidate"),
                persist_raw_provider_artifact=True,
            )
        return OnlineOcrRoutingDecision(
            route_id="pdf_paddle_primary",
            canonical_allowed=True,
            canonical_provider=PADDLE_ASYNC_PROVIDER,
            fallback_provider=None,
            parser_version=PADDLE_PARSER_VERSION,
            reason_codes=("asset_subkind_pdf", "mineru_unavailable"),
            persist_raw_provider_artifact=False,
        )

    if normalized_asset_subkind in _MINERU_COMPLEX_IMAGE_SUBKINDS:
        if mineru_available:
            return OnlineOcrRoutingDecision(
                route_id="complex_image_mineru_primary_with_paddle_fallback",
                canonical_allowed=True,
                canonical_provider=MINERU_PROVIDER,
                fallback_provider=PADDLE_ASYNC_PROVIDER,
                parser_version=MINERU_ADAPTED_PARSER_VERSION,
                reason_codes=("complex_table_image", "explicit_allow", "mineru_available"),
                persist_raw_provider_artifact=True,
            )
        return OnlineOcrRoutingDecision(
            route_id="complex_image_paddle_primary",
            canonical_allowed=True,
            canonical_provider=PADDLE_ASYNC_PROVIDER,
            fallback_provider=None,
            parser_version=PADDLE_PARSER_VERSION,
            reason_codes=("complex_table_image", "mineru_unavailable"),
            persist_raw_provider_artifact=False,
        )

    if normalized_asset_subkind in _DEFERRED_SUBKINDS:
        return OnlineOcrRoutingDecision(
            route_id=f"{normalized_asset_subkind}_deferred",
            canonical_allowed=False,
            canonical_provider=None,
            fallback_provider=None,
            parser_version=None,
            reason_codes=(f"{normalized_asset_subkind}_deferred",),
            persist_raw_provider_artifact=False,
        )

    if (
        normalized_asset_subkind in _PADDLE_PRIMARY_IMAGE_SUBKINDS
        or normalized_asset_kind == "image"
    ):
        return OnlineOcrRoutingDecision(
            route_id="generic_image_paddle_primary",
            canonical_allowed=True,
            canonical_provider=PADDLE_ASYNC_PROVIDER,
            fallback_provider=None,
            parser_version=PADDLE_PARSER_VERSION,
            reason_codes=("generic_or_simple_image",),
            persist_raw_provider_artifact=False,
        )

    if normalized_asset_kind == "binary":
        return OnlineOcrRoutingDecision(
            route_id="binary_deferred",
            canonical_allowed=False,
            canonical_provider=None,
            fallback_provider=None,
            parser_version=None,
            reason_codes=("binary_deferred",),
            persist_raw_provider_artifact=False,
        )

    return OnlineOcrRoutingDecision(
        route_id="default_paddle_primary",
        canonical_allowed=True,
        canonical_provider=PADDLE_ASYNC_PROVIDER,
        fallback_provider=None,
        parser_version=PADDLE_PARSER_VERSION,
        reason_codes=("default_safe_paddle",),
        persist_raw_provider_artifact=False,
    )


def select_adjudicated_image_routing(
    *,
    refined_asset_subkind: str,
    candidate_summary: dict[str, object],
    baseline_summary: dict[str, object],
) -> OnlineOcrRoutingDecision:
    asset_subkind = refined_asset_subkind.strip().lower()
    candidate_provider = str(candidate_summary.get("provider") or MINERU_PROVIDER)
    baseline_provider = str(baseline_summary.get("provider") or PADDLE_ASYNC_PROVIDER)
    candidate_usable = bool(candidate_summary.get("usable_output"))
    baseline_usable = bool(baseline_summary.get("usable_output"))

    if asset_subkind in _DEFERRED_SUBKINDS:
        return OnlineOcrRoutingDecision(
            route_id=f"{asset_subkind}_deferred",
            canonical_allowed=False,
            canonical_provider=None,
            fallback_provider=None,
            parser_version=None,
            reason_codes=(f"{asset_subkind}_deferred", "dual_run_refined"),
            persist_raw_provider_artifact=False,
        )

    if asset_subkind in _MINERU_COMPLEX_IMAGE_SUBKINDS:
        if candidate_usable:
            return OnlineOcrRoutingDecision(
                route_id="complex_image_mineru_selected",
                canonical_allowed=True,
                canonical_provider=candidate_provider,
                fallback_provider=baseline_provider if baseline_usable else None,
                parser_version=_parser_version_for_provider(candidate_provider),
                reason_codes=("complex_table_image", "dual_run_refined", "mineru_selected"),
                persist_raw_provider_artifact=(candidate_provider == MINERU_PROVIDER),
            )
        if baseline_usable:
            return OnlineOcrRoutingDecision(
                route_id="complex_image_paddle_salvage",
                canonical_allowed=True,
                canonical_provider=baseline_provider,
                fallback_provider=None,
                parser_version=_parser_version_for_provider(baseline_provider),
                reason_codes=("complex_table_image", "dual_run_refined", "paddle_salvage"),
                persist_raw_provider_artifact=False,
            )
        return OnlineOcrRoutingDecision(
            route_id="complex_image_unusable",
            canonical_allowed=False,
            canonical_provider=None,
            fallback_provider=None,
            parser_version=None,
            reason_codes=("complex_table_image", "dual_run_refined", "no_usable_provider"),
            persist_raw_provider_artifact=False,
        )

    if asset_subkind == "simple_table_image":
        if baseline_usable:
            return OnlineOcrRoutingDecision(
                route_id="simple_table_image_paddle_primary",
                canonical_allowed=True,
                canonical_provider=baseline_provider,
                fallback_provider=candidate_provider if candidate_usable else None,
                parser_version=_parser_version_for_provider(baseline_provider),
                reason_codes=("simple_table_image", "dual_run_refined", "paddle_primary"),
                persist_raw_provider_artifact=False,
            )
        if candidate_usable:
            return OnlineOcrRoutingDecision(
                route_id="simple_table_image_mineru_salvage",
                canonical_allowed=True,
                canonical_provider=candidate_provider,
                fallback_provider=None,
                parser_version=_parser_version_for_provider(candidate_provider),
                reason_codes=("simple_table_image", "dual_run_refined", "mineru_salvage"),
                persist_raw_provider_artifact=(candidate_provider == MINERU_PROVIDER),
            )
        return OnlineOcrRoutingDecision(
            route_id="simple_table_image_unusable",
            canonical_allowed=False,
            canonical_provider=None,
            fallback_provider=None,
            parser_version=None,
            reason_codes=("simple_table_image", "dual_run_refined", "no_usable_provider"),
            persist_raw_provider_artifact=False,
        )

    if asset_subkind == "generic_image":
        if baseline_usable:
            return OnlineOcrRoutingDecision(
                route_id="generic_image_paddle_primary",
                canonical_allowed=True,
                canonical_provider=baseline_provider,
                fallback_provider=None,
                parser_version=_parser_version_for_provider(baseline_provider),
                reason_codes=("generic_image", "dual_run_refined", "paddle_safe_default"),
                persist_raw_provider_artifact=False,
            )
        if candidate_usable:
            return OnlineOcrRoutingDecision(
                route_id="generic_image_mineru_salvage",
                canonical_allowed=True,
                canonical_provider=candidate_provider,
                fallback_provider=None,
                parser_version=_parser_version_for_provider(candidate_provider),
                reason_codes=("generic_image", "dual_run_refined", "mineru_availability_salvage"),
                persist_raw_provider_artifact=(candidate_provider == MINERU_PROVIDER),
            )
        return OnlineOcrRoutingDecision(
            route_id="generic_image_unusable",
            canonical_allowed=False,
            canonical_provider=None,
            fallback_provider=None,
            parser_version=None,
            reason_codes=("generic_image", "dual_run_refined", "no_usable_provider"),
            persist_raw_provider_artifact=False,
        )

    return OnlineOcrRoutingDecision(
        route_id="default_paddle_primary",
        canonical_allowed=True,
        canonical_provider=PADDLE_ASYNC_PROVIDER,
        fallback_provider=None,
        parser_version=PADDLE_PARSER_VERSION,
        reason_codes=("default_safe_paddle", "dual_run_refined"),
        persist_raw_provider_artifact=False,
    )


def _normalize_content_type(value: str | None) -> str:
    normalized = (value or "application/octet-stream").strip().lower()
    if normalized == "text/html":
        return "text/html; charset=utf-8"
    if normalized == "text/plain":
        return "text/plain; charset=utf-8"
    return normalized


def _structure_signals(summary: dict[str, object]) -> dict[str, int]:
    payload = summary.get("structure_signals")
    if not isinstance(payload, dict):
        return {
            "table_row_count": 0,
            "nonempty_line_count": 0,
            "image_reference_count": 0,
        }
    return {
        "table_row_count": int(payload.get("table_row_count") or 0),
        "nonempty_line_count": int(payload.get("nonempty_line_count") or 0),
        "image_reference_count": int(payload.get("image_reference_count") or 0),
    }


def _usable_output(summary: dict[str, object]) -> bool:
    return bool(summary.get("usable_output"))


def _aspect_ratio(*, typed_metadata: RawAssetTypedMetadata) -> float | None:
    if (
        typed_metadata.image_width is None
        or typed_metadata.image_height is None
        or typed_metadata.image_width <= 0
        or typed_metadata.image_height <= 0
    ):
        return None
    return round(typed_metadata.image_width / typed_metadata.image_height, 4)


def _has_spatial_filename_hint(source_name: str) -> bool:
    normalized = source_name.strip().lower()
    return any(token in normalized for token in _SPATIAL_FILENAME_HINTS)


def _parser_version_for_provider(provider: str) -> str:
    return MINERU_ADAPTED_PARSER_VERSION if provider == MINERU_PROVIDER else PADDLE_PARSER_VERSION


__all__ = [
    "MINERU_ADAPTED_PARSER_VERSION",
    "MINERU_PROVIDER",
    "PADDLE_ASYNC_PROVIDER",
    "PADDLE_PARSER_VERSION",
    "RAW_PROVIDER_RESPONSE_ARCHIVE_FILENAME",
    "RAW_PROVIDER_RESPONSE_MANIFEST_FILENAME",
    "RAW_PROVIDER_RESPONSE_SEGMENT_FILENAME_TEMPLATE",
    "OnlineOcrRoutingDecision",
    "RawAssetTypeRefinement",
    "RawAssetTypedMetadata",
    "adapt_mineru_archive_to_canonical_provider_payload",
    "infer_raw_asset_typed_metadata",
    "refine_raw_asset_typed_metadata_with_ocr_evidence",
    "select_adjudicated_image_routing",
    "select_online_ocr_routing",
]
