from __future__ import annotations

from campus_ingestion_core.handbook_cleanup_normalize import (
    normalize_handbook_body_text,
    normalize_handbook_title,
)
from campus_ingestion_core.handbook_cleanup_shared import TITLE_VARIANT_SUFFIX_RE
from campus_ingestion_core.split_manifest import SplitManifestDocument


def project_manifest_rows(
    structured_rows: list[dict[str, object]],
    manifest_document: SplitManifestDocument,
) -> list[dict[str, object]]:
    selected = [
        row
        for row in structured_rows
        if coerce_int(row.get("page_start")) is not None
        and coerce_int(row.get("page_end")) is not None
        and int(row["page_start"]) >= manifest_document.page_start
        and int(row["page_end"]) <= manifest_document.page_end
    ]
    return sorted(selected, key=row_sort_key)


def row_sort_key(row: dict[str, object]) -> tuple[int, int, int, str]:
    return (
        coerce_int(row.get("page_start")) or 0,
        coerce_int(row.get("reading_order")) or coerce_int(row.get("row_index")) or 0,
        coerce_int(row.get("row_index")) or 0,
        str(row.get("row_id") or ""),
    )


def select_title(
    projected_rows: list[dict[str, object]],
    manifest_title: str,
    first_page: int,
) -> str:
    candidate_title = extract_handbook_title_candidate(
        structured_rows=projected_rows, first_page=first_page
    )
    if candidate_title is not None:
        if is_placeholder_title(manifest_title):
            return candidate_title
        if normalize_title_for_match(candidate_title) == normalize_title_for_match(manifest_title):
            return normalize_handbook_title(manifest_title)
        return normalize_handbook_title(manifest_title)
    return normalize_handbook_title(manifest_title)


def extract_handbook_title_candidate(
    *,
    structured_rows: list[dict[str, object]],
    first_page: int,
) -> str | None:
    candidates: list[tuple[float, float, int, str]] = []
    for row in structured_rows:
        if coerce_int(row.get("page_start")) != first_page:
            continue
        if str(row.get("row_type") or "") != "heading":
            continue
        if bool(row.get("is_repeated_candidate")):
            continue
        text = row_text(row)
        if not text:
            continue
        candidates.append(
            (
                float(row.get("title_candidate_score") or 0.0),
                float(row.get("classification_confidence") or 0.0),
                -(int(row.get("reading_order") or 0)),
                text,
            )
        )
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][3]


def is_placeholder_title(value: str) -> bool:
    return normalize_handbook_title(value) in {"制度标题", "占位标题"}


def normalize_title_for_match(value: str) -> str:
    normalized = normalize_handbook_title(value)
    return TITLE_VARIANT_SUFFIX_RE.sub("", normalized).strip()


def filter_content_rows(
    projected_rows: list[dict[str, object]],
    *,
    title: str,
) -> list[dict[str, object]]:
    title_anchor_index = find_title_anchor_index(
        projected_rows,
        title=title,
    )
    if title_anchor_index is None:
        raise ValueError(f"handbook document cleanup missing title anchor for {title!r}")
    filtered: list[dict[str, object]] = []
    title_consumed = False
    normalized_title = normalize_title_for_match(title)
    anchor_page = coerce_int(projected_rows[title_anchor_index].get("page_start"))
    for row in projected_rows[title_anchor_index:]:
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") in {"header", "footer", "page_number"}:
            continue
        text = row_text(row)
        if not text and str(row.get("row_type") or "") != "table":
            continue
        if not title_consumed and normalize_title_for_match(text) == normalized_title:
            title_consumed = True
            continue
        if (
            title_consumed
            and anchor_page is not None
            and coerce_int(row.get("page_start")) == anchor_page
            and looks_like_title_variant_suffix_line(text)
        ):
            continue
        filtered.append(row)
    return filtered


def find_title_anchor_index(
    projected_rows: list[dict[str, object]],
    *,
    title: str,
) -> int | None:
    normalized_title = normalize_title_for_match(title)
    if not normalized_title:
        return None
    for index, row in enumerate(projected_rows):
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") in {"header", "footer", "page_number", "table"}:
            continue
        text = row_text(row)
        if not text:
            continue
        if normalize_title_for_match(text) == normalized_title:
            return index
    return None


def row_text(row: dict[str, object]) -> str:
    for field_name in ("text_normalized", "text_raw"):
        value = row.get(field_name)
        if isinstance(value, str) and value.strip():
            return normalize_handbook_body_text(value)
    return ""


def looks_like_title_variant_suffix_line(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return bool(normalized and TITLE_VARIANT_SUFFIX_RE.fullmatch(normalized))


def coerce_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip():
        return int(value)
    return None


__all__ = [
    "coerce_int",
    "extract_handbook_title_candidate",
    "filter_content_rows",
    "find_title_anchor_index",
    "is_placeholder_title",
    "normalize_title_for_match",
    "project_manifest_rows",
    "row_text",
    "select_title",
]
