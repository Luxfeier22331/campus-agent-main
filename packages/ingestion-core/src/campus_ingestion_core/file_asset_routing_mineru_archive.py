from __future__ import annotations

import json
import zipfile
from collections import defaultdict
from io import BytesIO
from typing import Any

from campus_ingestion_core.source_truth_common import is_bottom_band


def adapt_mineru_archive_to_canonical_provider_payload(archive_bytes: bytes) -> bytes:
    with zipfile.ZipFile(BytesIO(archive_bytes)) as archive:
        content_items = _load_mineru_content_items(archive)
        page_payloads = _build_page_payloads(content_items=content_items, archive=archive)
    payload = {
        "result": {
            "dataInfo": {
                "numPages": len(page_payloads),
                "type": "pdf_or_image",
            },
            "layoutParsingResults": page_payloads,
        }
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _load_mineru_content_items(archive: zipfile.ZipFile) -> list[dict[str, Any]]:
    if "content_list_v2.json" in archive.namelist():
        payload = json.loads(archive.read("content_list_v2.json").decode("utf-8"))
        normalized_items = _normalize_mineru_content_list_v2(payload)
        if normalized_items:
            return normalized_items

    preferred_names = [name for name in archive.namelist() if name.endswith("_content_list.json")]
    if preferred_names:
        for name in preferred_names:
            payload = json.loads(archive.read(name).decode("utf-8"))
            if isinstance(payload, list):
                return [item for item in payload if isinstance(item, dict)]

    for fallback_name in ("content_list_v2.json", "content_list.json"):
        if fallback_name not in archive.namelist():
            continue
        payload = json.loads(archive.read(fallback_name).decode("utf-8"))
        flattened: list[dict[str, Any]] = []
        _flatten_content_items(payload, flattened)
        if flattened:
            return flattened

    if "full.md" in archive.namelist():
        markdown = archive.read("full.md").decode("utf-8")
        return [{"type": "text", "text": markdown, "text_level": 0, "page_idx": 0}]

    raise ValueError("MinerU archive does not contain content_list or full.md")


def _normalize_mineru_content_list_v2(payload: object) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        return []

    if all(isinstance(page_items, list) for page_items in payload):
        normalized: list[dict[str, Any]] = []
        for page_idx, page_items in enumerate(payload):
            for item in page_items:
                if not isinstance(item, dict):
                    continue
                normalized.append(_with_mineru_page_idx(item=item, page_idx=page_idx))
        return normalized

    return [
        _with_mineru_page_idx(item=item, page_idx=_coerce_int(item.get("page_idx"), default=0))
        for item in payload
        if isinstance(item, dict)
    ]


def _with_mineru_page_idx(*, item: dict[str, Any], page_idx: int) -> dict[str, Any]:
    normalized = dict(item)
    normalized["page_idx"] = page_idx
    return normalized


def _flatten_content_items(payload: object, flattened: list[dict[str, Any]]) -> None:
    if isinstance(payload, dict):
        flattened.append(payload)
        return
    if isinstance(payload, list):
        for item in payload:
            _flatten_content_items(item, flattened)


def _build_page_payloads(
    *,
    content_items: list[dict[str, Any]],
    archive: zipfile.ZipFile,
) -> list[dict[str, Any]]:
    items_by_page: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in content_items:
        page_idx = _coerce_int(item.get("page_idx"), default=0)
        items_by_page[page_idx].append(item)

    if not items_by_page:
        full_md = archive.read("full.md").decode("utf-8") if "full.md" in archive.namelist() else ""
        return [
            {
                "pageInfo": {"height": 1000},
                "prunedResult": {"parsing_res_list": []},
                "markdown": {"text": full_md},
            }
        ]

    page_payloads: list[dict[str, Any]] = []
    for page_idx in range(max(items_by_page) + 1):
        page_items = items_by_page.get(page_idx, [])
        page_height = _infer_mineru_page_height(page_items)
        blocks = [
            _content_item_to_parsing_block(
                item=item,
                block_order=block_order,
                page_height=page_height,
            )
            for block_order, item in enumerate(page_items, start=1)
        ]
        page_markdown = "\n\n".join(
            text for text in (_content_item_markdown(item) for item in page_items) if text
        )
        page_payloads.append(
            {
                "pageInfo": {"height": page_height},
                "prunedResult": {"height": page_height, "parsing_res_list": blocks},
                "markdown": {"text": page_markdown},
            }
        )
    return page_payloads


def _content_item_to_parsing_block(
    *,
    item: dict[str, Any],
    block_order: int,
    page_height: float,
) -> dict[str, Any]:
    item_type = str(item.get("type") or "text").strip().lower()
    bbox = item.get("bbox") if isinstance(item.get("bbox"), list) else None
    block_content = _content_item_text(item)
    block_label = "text"

    if item_type == "table":
        block_label = "table"
        block_content = _content_item_table_html(item)
    elif item_type == "title":
        block_label = "doc_title" if block_order == 1 else "paragraph_title"
    elif item_type in {"header", "page_header"}:
        block_label = "header"
    elif item_type in {"footer", "page_footer"}:
        block_label = "footer"
    elif item_type in {"aside_text", "page_aside_text", "vertical_text"}:
        block_label = "vertical_text" if item_type == "vertical_text" else "aside_text"
    elif item_type == "page_number":
        block_label = "number"
    elif item_type == "text":
        text_level = _coerce_int(item.get("text_level"), default=0)
        if _looks_like_mineru_page_marker(
            text=block_content,
            bbox=bbox,
            page_height=page_height,
        ):
            block_label = "number"
        elif text_level >= 1 and block_order == 1:
            block_label = "doc_title"
        elif text_level >= 1:
            block_label = "paragraph_title"
    elif item_type in {"image", "figure"}:
        block_label = "image"
    elif item_type in {"list", "list_item"}:
        block_label = "list_item"

    return {
        "block_id": f"mineru-block-{block_order:04d}",
        "block_order": block_order,
        "block_bbox": bbox,
        "block_label": block_label,
        "block_content": block_content,
        "mineru_item_type": item_type,
        "mineru_text_level": _coerce_int(item.get("text_level"), default=0),
        "mineru_page_idx": _coerce_int(item.get("page_idx"), default=0),
        "mineru_page_height": page_height,
    }


def _content_item_text(item: dict[str, Any]) -> str:
    if isinstance(item.get("text"), str):
        return str(item["text"])
    list_text = _extract_list_item_text(item.get("list_items"))
    if list_text:
        return list_text
    content = item.get("content")
    if isinstance(content, dict):
        table_html = _content_item_table_html(item)
        if table_html:
            return table_html
        list_text = _extract_list_item_text(content.get("list_items"))
        if list_text:
            return list_text
        fragments = _extract_text_fragments(content)
        if fragments:
            return "".join(fragments).strip()
    if isinstance(item.get("table_body"), str):
        return str(item["table_body"])
    return ""


def _content_item_table_html(item: dict[str, Any]) -> str:
    table_body = item.get("table_body")
    if isinstance(table_body, str) and table_body.strip():
        return str(table_body)
    content = item.get("content")
    if not isinstance(content, dict):
        return ""
    html = content.get("html")
    if isinstance(html, str) and html.strip():
        return html
    nested_table_body = content.get("table_body")
    if isinstance(nested_table_body, str) and nested_table_body.strip():
        return nested_table_body
    return ""


def _content_item_markdown(item: dict[str, Any]) -> str:
    item_type = str(item.get("type") or "text").strip().lower()
    if item_type == "table":
        return _content_item_table_html(item)
    return _content_item_text(item)


def _extract_list_item_text(value: object) -> str:
    if not isinstance(value, list):
        return ""
    entries: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            entries.append(item.strip())
            continue
        if isinstance(item, dict):
            fragments = _extract_text_fragments(item)
            text = "".join(fragments).strip()
            if text:
                entries.append(text)
    return "\n".join(entries)


def _extract_text_fragments(value: object) -> list[str]:
    fragments: list[str] = []
    if isinstance(value, str):
        text = value.strip()
        if text:
            fragments.append(text)
        return fragments
    if isinstance(value, list):
        for item in value:
            fragments.extend(_extract_text_fragments(item))
        return fragments
    if not isinstance(value, dict):
        return fragments
    text = value.get("text")
    if isinstance(text, str) and text.strip():
        fragments.append(text.strip())
    content = value.get("content")
    if isinstance(content, str) and content.strip():
        fragments.append(content.strip())
    for key, nested in value.items():
        if key in {"text", "content", "type", "bbox", "page_idx", "page_id", "page_no"}:
            continue
        if key.endswith("_content") or key in {"list_items", "item_content", "items"}:
            fragments.extend(_extract_text_fragments(nested))
    return fragments


def _coerce_int(value: object, *, default: int) -> int:
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _infer_mineru_page_height(items: list[dict[str, Any]]) -> float:
    explicit_heights = [
        height for item in items if (height := _extract_page_height_hint(item)) is not None
    ]
    if explicit_heights:
        return max(explicit_heights)
    bbox_bottom = max(
        (
            float(item["bbox"][3])
            for item in items
            if isinstance(item.get("bbox"), list) and len(item["bbox"]) >= 4
        ),
        default=0.0,
    )
    return bbox_bottom or 1000.0


def _extract_page_height_hint(item: dict[str, Any]) -> float | None:
    candidate_values = [
        item.get("page_height"),
        item.get("pageHeight"),
    ]
    nested_candidates = [
        item.get("page_info"),
        item.get("pageInfo"),
        item.get("page_size"),
        item.get("pageSize"),
        item.get("page_metadata"),
        item.get("pageMetadata"),
    ]
    for value in candidate_values:
        height = _positive_float(value)
        if height is not None:
            return height
    for value in nested_candidates:
        height = _extract_height_from_nested_hint(value)
        if height is not None:
            return height
    return None


def _extract_height_from_nested_hint(value: object) -> float | None:
    if isinstance(value, dict):
        for key in ("height", "page_height", "pageHeight", "h"):
            height = _positive_float(value.get(key))
            if height is not None:
                return height
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return _positive_float(value[1])
    return None


def _positive_float(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric if numeric > 0 else None
    if isinstance(value, str) and value.strip():
        try:
            numeric = float(value)
        except ValueError:
            return None
        return numeric if numeric > 0 else None
    return None


def _looks_like_mineru_page_marker(
    *,
    text: str,
    bbox: list[object] | None,
    page_height: float,
) -> bool:
    normalized = text.strip()
    if not normalized.isdigit() or len(normalized) > 4:
        return False
    if not isinstance(bbox, list):
        return False
    normalized_bbox = [float(value) for value in bbox if isinstance(value, (int, float))]
    if len(normalized_bbox) < 4:
        return False
    return is_bottom_band(bbox=normalized_bbox, page_height=page_height)
