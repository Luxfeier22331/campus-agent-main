from __future__ import annotations

import unicodedata

from campus_contracts import EvidenceSource
from llama_index.core.schema import TextNode


def _record_to_text_node(point_id: object, payload: dict[str, object]) -> TextNode | None:
    node_content = payload.get("_node_content")
    if isinstance(node_content, str):
        parsed = TextNode.model_validate_json(node_content)
        if parsed.metadata:
            return parsed

    text = _coerce_text_payload(payload)
    if not text:
        return None
    return TextNode(
        id_=str(point_id),
        text=text,
        metadata=payload,
    )


def _coerce_text_payload(payload: dict[str, object]) -> str:
    for key in ("text", "display_text", "snippet"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _coerce_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _coerce_structural_path(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    normalized: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if text:
            normalized.append(text)
    return tuple(normalized)


def _resolve_source_title(
    metadata: dict[str, object],
    *,
    document_id: str,
    anchor: dict[str, object],
) -> str:
    for key in ("source_title", "title", "document_title"):
        value = _optional_text(metadata.get(key))
        if value is not None:
            return value
    structural_path = _coerce_structural_path(anchor.get("section_path"))
    if structural_path:
        first_segment = structural_path[0]
        if ":" not in first_segment:
            return first_segment
    return document_id.split(":", 1)[-1].strip()


def _resolve_content_kind(
    metadata: dict[str, object],
    *,
    collection: str,
    snippet: str,
    anchor: dict[str, object],
) -> str:
    explicit_kind = _optional_text(metadata.get("unit_type"))
    if explicit_kind is not None:
        return explicit_kind
    if _looks_like_curriculum_table_unit(collection=collection, snippet=snippet, anchor=anchor):
        return "table_unit"
    return ""


def _resolve_content_role(
    metadata: dict[str, object],
    *,
    collection: str,
    snippet: str,
    anchor: dict[str, object],
) -> str:
    explicit_role = _optional_text(metadata.get("content_role"))
    if explicit_role is not None:
        return explicit_role
    structural_path = _coerce_structural_path(anchor.get("section_path"))
    if any(segment.endswith("附则") or segment == "附则" for segment in structural_path):
        return "closing_provision"
    content_kind = _resolve_content_kind(
        metadata,
        collection=collection,
        snippet=snippet,
        anchor=anchor,
    )
    if content_kind == "table_unit":
        return "table_fact"
    return ""


def _resolve_detail_label(
    metadata: dict[str, object],
    *,
    anchor: dict[str, object],
) -> str:
    explicit_label = _optional_text(metadata.get("detail_label"))
    if explicit_label is not None:
        return explicit_label
    for key in ("article_label", "provision_label", "table_context"):
        value = _optional_text(anchor.get(key))
        if value is not None:
            return value
    return ""


def _resolve_canonical_source_id(metadata: dict[str, object]) -> str:
    return (
        _optional_text(metadata.get("canonical_source_id"))
        or _optional_text(metadata.get("source_doc_id"))
        or ""
    )


def _resolve_canonical_source_title(metadata: dict[str, object]) -> str:
    return (
        _optional_text(metadata.get("canonical_source_title"))
        or _optional_text(metadata.get("source_doc_title"))
        or ""
    )


def _resolve_source_unit_kind(
    metadata: dict[str, object],
    *,
    collection: str,
    anchor: dict[str, object],
) -> str:
    explicit_kind = _optional_text(metadata.get("source_unit_kind"))
    if explicit_kind is not None:
        return explicit_kind
    if collection != "program_semester_facts":
        return ""
    return (
        _optional_text(metadata.get("content_role"))
        or _optional_text(anchor.get("fact_type"))
        or ""
    )


def _resolve_source_unit_key(
    metadata: dict[str, object],
    *,
    collection: str,
) -> str:
    explicit_key = _optional_text(metadata.get("source_unit_key"))
    if explicit_key is not None:
        return explicit_key
    if collection != "program_semester_facts":
        return ""
    semester_index = _optional_text(metadata.get("semester_index"))
    if semester_index is None:
        return ""
    normalized = semester_index.strip()
    return f"semester-{normalized}" if normalized else ""


def _resolve_is_answer_bearing(
    metadata: dict[str, object],
    *,
    collection: str,
    snippet: str,
    anchor: dict[str, object],
) -> bool:
    explicit_value = _optional_bool(metadata.get("is_answer_bearing"))
    if explicit_value is not None:
        return explicit_value
    content_role = _resolve_content_role(
        metadata,
        collection=collection,
        snippet=snippet,
        anchor=anchor,
    )
    if content_role == "closing_provision":
        return False
    detail_label = _resolve_detail_label(metadata, anchor=anchor)
    content_kind = _resolve_content_kind(
        metadata,
        collection=collection,
        snippet=snippet,
        anchor=anchor,
    )
    if content_role == "table_fact":
        return True
    return bool(detail_label) and content_kind in {
        "article_body",
        "policy_page",
        "section_text",
        "table_unit",
    }


def _looks_like_curriculum_table_unit(
    *,
    collection: str,
    snippet: str,
    anchor: dict[str, object],
) -> bool:
    if collection != "curriculum_plan":
        return False
    normalized_snippet = unicodedata.normalize("NFKC", snippet)
    if "|" not in normalized_snippet:
        return False
    if "课程名称" not in normalized_snippet:
        return False
    if "修读学期" in normalized_snippet or "开设学期" in normalized_snippet:
        return True
    if "table_group_id" in anchor and "课程清单如下" in normalized_snippet:
        return True
    return False


def _is_curriculum_course_list_table_source(source: EvidenceSource) -> bool:
    if source.collection != "curriculum_plan" or source.content_role != "table_fact":
        return False
    normalized_snippet = unicodedata.normalize("NFKC", source.snippet)
    return "|" in normalized_snippet and "课程名称" in normalized_snippet


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _optional_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    return None
