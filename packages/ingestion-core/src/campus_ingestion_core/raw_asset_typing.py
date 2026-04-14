from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import mimetypes
from pathlib import Path
from typing import Any

from PIL import Image


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


def infer_raw_asset_typed_metadata(*, source_path: Path, file_bytes: bytes) -> RawAssetTypedMetadata:
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
    max_nonempty_lines = max(candidate_signals["nonempty_line_count"], baseline_signals["nonempty_line_count"])
    max_image_refs = max(candidate_signals["image_reference_count"], baseline_signals["image_reference_count"])
    aspect_ratio = _aspect_ratio(typed_metadata=typed_metadata)
    winner = str(adjudication.get("winner") or "")
    reason_codes = tuple(str(item) for item in list(adjudication.get("reason_codes") or []) if str(item).strip())
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


__all__ = [
    "RawAssetTypeRefinement",
    "RawAssetTypedMetadata",
    "infer_raw_asset_typed_metadata",
    "refine_raw_asset_typed_metadata_with_ocr_evidence",
]
