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
    title_anchor_span = find_title_anchor_span(
        projected_rows,
        title=title,
    )
    if title_anchor_span is None:
        raise ValueError(f"handbook document cleanup missing title anchor for {title!r}")
    title_anchor_index, title_anchor_end_index = title_anchor_span
    filtered: list[dict[str, object]] = []
    anchor_page = coerce_int(projected_rows[title_anchor_index].get("page_start"))
    for index, row in enumerate(projected_rows[title_anchor_index:], start=title_anchor_index):
        if index <= title_anchor_end_index:
            continue
        if bool(row.get("is_repeated_candidate")):
            continue
        if str(row.get("row_type") or "") in {"header", "footer", "page_number"}:
            continue
        text = row_text(row)
        if not text and str(row.get("row_type") or "") != "table":
            continue
        if (
            anchor_page is not None
            and coerce_int(row.get("page_start")) == anchor_page
            and looks_like_title_variant_suffix_line(text)
        ):
            continue
        filtered.append(row)
    return filtered


def find_title_anchor_span(
    projected_rows: list[dict[str, object]],
    *,
    title: str,
) -> tuple[int, int] | None:
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
            return (index, index)
        multiline_anchor_span = _find_multiline_title_anchor_span(
            projected_rows=projected_rows,
            start_index=index,
            normalized_title=normalized_title,
        )
        if multiline_anchor_span is not None:
            return multiline_anchor_span
    return None


def find_title_anchor_index(
    projected_rows: list[dict[str, object]],
    *,
    title: str,
) -> int | None:
    title_anchor_span = find_title_anchor_span(projected_rows, title=title)
    if title_anchor_span is None:
        return None
    return title_anchor_span[0]


def _find_multiline_title_anchor_span(
    *,
    projected_rows: list[dict[str, object]],
    start_index: int,
    normalized_title: str,
    max_heading_rows: int = 3,
) -> tuple[int, int] | None:
    start_row = projected_rows[start_index]
    if str(start_row.get("row_type") or "") != "heading":
        return None
    start_page = coerce_int(start_row.get("page_start"))
    if start_page is None:
        return None
    combined_text = row_text(start_row)
    if not combined_text:
        return None
    end_limit = min(len(projected_rows), start_index + max_heading_rows)
    for end_index in range(start_index + 1, end_limit):
        next_row = projected_rows[end_index]
        if bool(next_row.get("is_repeated_candidate")):
            break
        if coerce_int(next_row.get("page_start")) != start_page:
            break
        if str(next_row.get("row_type") or "") != "heading":
            break
        next_text = row_text(next_row)
        if not next_text:
            break
        combined_text = f"{combined_text}\n{next_text}"
        if normalize_title_for_match(combined_text) == normalized_title:
            return (start_index, end_index)
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
    "find_title_anchor_span",
    "is_placeholder_title",
    "normalize_title_for_match",
    "project_manifest_rows",
    "row_text",
    "select_title",
]
