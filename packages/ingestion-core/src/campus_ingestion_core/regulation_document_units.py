from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
)

INSTITUTIONAL_TARGET_COLLECTION = "institutional_rules"
SCOPED_TARGET_COLLECTION = "scoped_rules"
STUDENT_TARGET_COLLECTION = "student_rules"
DOCUMENT_UNITS_SCHEMA_VERSION = "document_units_jsonl"

_CHINESE_NUMBER = "一二三四五六七八九十百千万〇零两0-9"
_STRUCTURAL_BLOCK_START_RE = re.compile(
    rf"(?=^(?:第[{_CHINESE_NUMBER}]+[章节条]|[{_CHINESE_NUMBER}]+、|[（(][{_CHINESE_NUMBER}]+[)）]))",
    re.MULTILINE,
)
_ARTICLE_LABEL_RE = re.compile(rf"^(?P<label>第[{_CHINESE_NUMBER}]+条)")
_ARTICLE_HEADING_LEAF_RE = re.compile(
    rf"^第[{_CHINESE_NUMBER}]+条\s*(?P<body>[^。；，,：:]{{1,30}})$"
)
_ARTICLE_HEADING_KEYWORDS = (
    "条件",
    "材料",
    "程序",
    "政策",
    "标准",
    "要求",
    "范围",
    "对象",
    "资格",
    "办法",
    "原则",
    "职责",
    "纪律",
    "监督",
    "附则",
    "类型",
)
_ARTICLE_BODY_VERB_MARKERS = (
    "应",
    "须",
    "需",
    "由",
    "负责",
    "符合",
    "适用",
    "执行",
    "遵守",
    "不得",
    "可以",
    "按照",
    "根据",
)
_BODY_LIST_ITEM_MARKERS = (
    *_ARTICLE_BODY_VERB_MARKERS,
    "认定",
    "给予",
    "下列",
    "违反",
    "处理",
)
_CHAPTER_OR_SECTION_HEADING_RE = re.compile(rf"^第[{_CHINESE_NUMBER}]+[章节][^。；]*$")
_TOP_LEVEL_HEADING_RE = re.compile(rf"^(?P<label>[{_CHINESE_NUMBER}]+、)[^。；]{{1,60}}$")
_SUBSECTION_HEADING_RE = re.compile(
    rf"^(?P<label>[（(][{_CHINESE_NUMBER}]+[)）][、.]?)[^。；]{{0,60}}$"
)
_SUBSECTION_LABEL_RE = re.compile(rf"^(?P<label>[（(][{_CHINESE_NUMBER}]+[)）][、.]?)")
_NUMERIC_ITEM_RE = re.compile(r"^(?P<label>[0-9]+[.、])")
_POLICY_DOC_NO_RE = re.compile(r"^[\u4e00-\u9fffA-Za-z]{2,20}[〔（(\[]\d{4}[〕）)\]]\d{1,8}号$")
_EDITION_NOTE_RE = re.compile(r"^[（(][^（）()]{0,12}(?:试行|修订|暂行|草案)[）)]$")
_IMPRINT_DATE_LINE_RE = re.compile(r"^\d{4}年\d{1,2}月\d{1,2}日(?:印发|发布|公布|施行)?$")
_SHORT_CONTEXT_HEADING_RE = re.compile(
    r"^[^\n。；;,，]{0,24}(?:包括|如下|义务|权利|职责|条件|材料|范围|对象|类型|奖项)[：:]$"
)
_BARE_ATTACHMENT_MARKER_RE = re.compile(r"^(?:附件|附表)\s*\d*$")
_INLINE_ARTICLE_BREAK_RE = re.compile(
    rf"(?P<head>第[{_CHINESE_NUMBER}]+[章节][^\n。；:：]{{0,30}}?)(?P<tail>第[{_CHINESE_NUMBER}]+条)"
)
_INLINE_PUNCTUATION_BREAK_RE = re.compile(
    rf"(?P<punct>[。；;：:！？!?])(?P<tail>第[{_CHINESE_NUMBER}]+[章节条]|[{_CHINESE_NUMBER}]+、|[（(][{_CHINESE_NUMBER}]+[)）])"
)


def serialize_regulation_document_units(
    *,
    target_collection: str,
    target_document_id: str,
    version_id: str,
    title: str,
    canonical_markdown: str,
    source_url: str,
    visibility_level: str,
    visibility_scope: str | None,
    entitlement_groups: list[str],
    common_metadata: Mapping[str, Any],
    semantic_content_hash: str,
) -> bytes:
    body_chunks = canonical_body_chunks(canonical_markdown)
    title_unit_type, body_unit_type, title_content_role, body_content_role = (
        _collection_unit_contract(target_collection)
    )
    rows = [
        _document_unit_row(
            document_id=target_document_id,
            version_id=version_id,
            index=1,
            row_type="heading",
            unit_type=title_unit_type,
            text=title,
            title=title,
            source_url=source_url,
            visibility_level=visibility_level,
            visibility_scope=visibility_scope,
            entitlement_groups=entitlement_groups,
            metadata={
                **dict(common_metadata),
                "content_role": title_content_role,
                "section_path": [title],
                "is_answer_bearing": True,
                "semantic_content_hash": semantic_content_hash,
            },
        )
    ]
    current_section_path: tuple[str, ...] = ()
    for offset, chunk in enumerate(body_chunks, start=2):
        structure = resolve_regulation_block_structure(
            chunk, current_section_path=current_section_path
        )
        current_section_path = structure["next_section_path"]
        rows.append(
            _document_unit_row(
                document_id=target_document_id,
                version_id=version_id,
                index=offset,
                row_type=structure["row_type"],
                unit_type=body_unit_type,
                text=chunk,
                title=title,
                source_url=source_url,
                visibility_level=visibility_level,
                visibility_scope=visibility_scope,
                entitlement_groups=entitlement_groups,
                metadata={
                    **dict(common_metadata),
                    "content_role": body_content_role,
                    "section_path": list(structure["section_path"]),
                    "article_label": structure["article_label"],
                    "provision_label": structure["provision_label"],
                    "is_answer_bearing": structure["row_type"] != "heading",
                    "semantic_content_hash": semantic_content_hash,
                },
            )
        )
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


def canonical_body_chunks(canonical_markdown: str) -> tuple[str, ...]:
    lines = canonical_markdown.strip().splitlines()
    body_lines = lines
    if lines and lines[0].startswith("# "):
        body_lines = lines[1:]
    if body_lines and body_lines[0].strip().startswith("> Source URL:"):
        body_lines = body_lines[1:]
    body = normalize_regulation_canonical_body("\n".join(body_lines))
    if not body:
        return ()
    starts = [match.start() for match in _STRUCTURAL_BLOCK_START_RE.finditer(body)]
    if not starts:
        return tuple(_split_blank_blocks(body)) or (body,)
    chunks: list[str] = []
    prefix = body[: starts[0]].strip()
    chunks.extend(_split_blank_blocks(prefix))
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(body)
        chunks.extend(_split_structural_region(body[start:end].strip()))
    return tuple(chunks)


def resolve_regulation_block_structure(
    text: str,
    *,
    current_section_path: tuple[str, ...],
) -> dict[str, Any]:
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    if _POLICY_DOC_NO_RE.match(first_line) is not None:
        return _heading_structure(current_section_path)
    if _is_non_contextual_heading_line(first_line):
        return _heading_structure(current_section_path)
    article_match = _ARTICLE_LABEL_RE.match(first_line)
    if article_match is not None:
        article_label = article_match.group("label").strip()
        article_body = first_line[article_match.end() :].strip()
        current_article_scope = _drop_trailing_transient_context(current_section_path)
        if article_body and _looks_like_article_heading_leaf(first_line):
            next_path = (*current_article_scope, first_line)
            return {
                "row_type": "heading",
                "section_path": current_article_scope,
                "article_label": article_label,
                "provision_label": None,
                "next_section_path": next_path,
            }
        return {
            "row_type": "paragraph" if article_body else "heading",
            "section_path": current_article_scope,
            "article_label": article_label,
            "provision_label": None,
            "next_section_path": current_article_scope,
        }
    if _CHAPTER_OR_SECTION_HEADING_RE.match(first_line) or _TOP_LEVEL_HEADING_RE.match(first_line):
        return {
            "row_type": "heading",
            "section_path": (first_line,),
            "article_label": None,
            "provision_label": None,
            "next_section_path": (first_line,),
        }
    body_list_match = _body_list_item_match(first_line)
    if body_list_match is not None:
        return {
            "row_type": "paragraph",
            "section_path": current_section_path,
            "article_label": None,
            "provision_label": body_list_match.group("label").strip(),
            "next_section_path": current_section_path,
        }
    subsection_match = _SUBSECTION_HEADING_RE.match(first_line)
    if subsection_match is not None:
        parent_path = _drop_trailing_transient_context(current_section_path)
        section_path = (*parent_path, first_line) if parent_path else (first_line,)
        return {
            "row_type": "heading",
            "section_path": section_path,
            "article_label": None,
            "provision_label": None,
            "next_section_path": section_path,
        }
    if _is_short_context_heading_line(first_line):
        parent_path = _drop_trailing_transient_context(current_section_path)
        section_path = (*parent_path, first_line) if parent_path else (first_line,)
        return {
            "row_type": "heading",
            "section_path": section_path,
            "article_label": None,
            "provision_label": None,
            "next_section_path": section_path,
        }
    numeric_item = _NUMERIC_ITEM_RE.match(first_line)
    if numeric_item is not None:
        return {
            "row_type": "paragraph",
            "section_path": current_section_path,
            "article_label": None,
            "provision_label": numeric_item.group("label").strip(),
            "next_section_path": current_section_path,
        }
    return {
        "row_type": "paragraph",
        "section_path": current_section_path,
        "article_label": None,
        "provision_label": None,
        "next_section_path": current_section_path,
    }


def regulation_common_metadata(
    *,
    title: str,
    title_base: str,
    title_raw: str,
    normalizer_version: str = REGULATION_CANONICAL_NORMALIZER_VERSION,
    cleaning_policy_version: str,
    normalization_quality: Mapping[str, Any],
    extra_metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = {
        "title": title,
        "title_base": title_base,
        "title_raw": title_raw,
        "normalizer_version": normalizer_version,
        "cleaning_policy_version": cleaning_policy_version,
        "document_units_schema_version": DOCUMENT_UNITS_SCHEMA_VERSION,
        "normalization_quality": dict(normalization_quality),
    }
    if extra_metadata:
        metadata.update(dict(extra_metadata))
    return metadata


def normalize_regulation_canonical_body(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    previous = ""
    current = normalized
    while current != previous:
        previous = current
        current = _INLINE_PUNCTUATION_BREAK_RE.sub(
            lambda match: f"{match.group('punct')}\n{match.group('tail')}",
            current,
        )
        current = _INLINE_ARTICLE_BREAK_RE.sub(
            lambda match: f"{match.group('head').rstrip()}\n{match.group('tail')}",
            current,
        )
    return current


def _collection_unit_contract(target_collection: str) -> tuple[str, str, str, str]:
    if target_collection in {INSTITUTIONAL_TARGET_COLLECTION, STUDENT_TARGET_COLLECTION}:
        return ("regulation_title", "regulation_body", "regulation_title", "regulation_body")
    return ("scoped_rule_title", "scoped_rule_body", "scoped_rule_title", "scoped_rule_body")


def _document_unit_row(
    *,
    document_id: str,
    version_id: str,
    index: int,
    row_type: str,
    unit_type: str,
    text: str,
    title: str,
    source_url: str,
    visibility_level: str,
    visibility_scope: str | None,
    entitlement_groups: list[str],
    metadata: Mapping[str, Any],
) -> dict[str, Any]:
    row_id = f"{document_id}:unit-{index:04d}"
    raw_section_path = metadata.get("section_path")
    section_path = list(raw_section_path) if isinstance(raw_section_path, list) else []
    anchor: dict[str, Any] = {"section_path": section_path} if section_path else {}
    article_label = str(metadata.get("article_label") or "").strip()
    if article_label:
        anchor["article_label"] = article_label
    provision_label = str(metadata.get("provision_label") or "").strip()
    if provision_label:
        anchor["provision_label"] = provision_label
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": row_id,
        "row_id": row_id,
        "row_type": row_type,
        "clean_text": text.strip(),
        "source_pdf": source_url.rsplit("/", 1)[-1] if source_url else "source.pdf",
        "source_url": source_url,
        "source": {"id": source_url},
        "page_start": None,
        "page_end": None,
        "entitlement_groups": entitlement_groups,
        "visibility_scope": visibility_scope,
        "visibility_level": visibility_level,
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "unit_type": unit_type,
        "root_unit_id": row_id,
        "anchor": anchor,
        "metadata": dict(metadata),
    }


def _heading_structure(current_section_path: tuple[str, ...]) -> dict[str, Any]:
    return {
        "row_type": "heading",
        "section_path": current_section_path,
        "article_label": None,
        "provision_label": None,
        "next_section_path": current_section_path,
    }


def _split_structural_region(text: str) -> tuple[str, ...]:
    normalized = text.strip()
    if not normalized:
        return ()
    lines = normalized.splitlines()
    first_line_index = next((index for index, line in enumerate(lines) if line.strip()), None)
    if first_line_index is None:
        return ()
    first_line = lines[first_line_index].strip()
    remainder = "\n".join(lines[first_line_index + 1 :]).strip()
    if _ARTICLE_LABEL_RE.match(first_line):
        if _looks_like_article_heading_leaf(first_line) and remainder:
            return (first_line, *_split_blank_blocks(remainder))
        return (normalized,)
    if _looks_like_first_batch_structural_heading(first_line) and remainder:
        return (first_line, *_split_blank_blocks(remainder))
    return tuple(_split_blank_blocks(normalized)) or (normalized,)


def _split_blank_blocks(text: str) -> tuple[str, ...]:
    return tuple(chunk.strip() for chunk in re.split(r"\n{2,}", text.strip()) if chunk.strip())


def _looks_like_first_batch_structural_heading(text: str) -> bool:
    normalized = text.strip()
    if _looks_like_body_list_item(normalized):
        return False
    return bool(
        _CHAPTER_OR_SECTION_HEADING_RE.match(normalized)
        or _TOP_LEVEL_HEADING_RE.match(normalized)
        or _SUBSECTION_HEADING_RE.match(normalized)
    )


def _is_non_contextual_heading_line(text: str) -> bool:
    normalized = text.strip()
    return (
        _POLICY_DOC_NO_RE.match(normalized) is not None
        or _EDITION_NOTE_RE.match(normalized) is not None
        or _IMPRINT_DATE_LINE_RE.match(normalized) is not None
        or _BARE_ATTACHMENT_MARKER_RE.match(normalized) is not None
    )


def _is_short_context_heading_line(text: str) -> bool:
    return _SHORT_CONTEXT_HEADING_RE.match(text.strip()) is not None


def _looks_like_article_heading_leaf(text: str) -> bool:
    match = _ARTICLE_HEADING_LEAF_RE.match(text.strip())
    if match is None:
        return False
    body = match.group("body").strip()
    return bool(
        body
        and len(body) <= 12
        and not any(marker in body for marker in _ARTICLE_BODY_VERB_MARKERS)
        and any(body.endswith(keyword) for keyword in _ARTICLE_HEADING_KEYWORDS)
    )


def _drop_trailing_article_heading(section_path: tuple[str, ...]) -> tuple[str, ...]:
    if section_path and _looks_like_article_heading_leaf(section_path[-1]):
        return section_path[:-1]
    return section_path


def _drop_trailing_short_context_heading(section_path: tuple[str, ...]) -> tuple[str, ...]:
    pruned = section_path
    while pruned and _is_short_context_heading_line(pruned[-1]):
        pruned = pruned[:-1]
    return pruned


def _drop_trailing_same_level_subsection(section_path: tuple[str, ...]) -> tuple[str, ...]:
    pruned = section_path
    while pruned and _SUBSECTION_HEADING_RE.match(pruned[-1]):
        pruned = pruned[:-1]
    return pruned


def _drop_trailing_transient_context(section_path: tuple[str, ...]) -> tuple[str, ...]:
    return _drop_trailing_same_level_subsection(
        _drop_trailing_short_context_heading(_drop_trailing_article_heading(section_path))
    )


def _body_list_item_match(text: str) -> re.Match[str] | None:
    match = _SUBSECTION_LABEL_RE.match(text.strip())
    if match is not None and _looks_like_body_list_item(text):
        return match
    return None


def _looks_like_body_list_item(text: str) -> bool:
    normalized = text.strip()
    match = _SUBSECTION_LABEL_RE.match(normalized)
    if match is None:
        return False
    body = normalized[match.end("label") :].strip()
    if not body:
        return False
    if normalized.endswith(("；", ";", "。", "，", ",", "：", ":")) and (
        len(body) > 18 or any(marker in body for marker in _BODY_LIST_ITEM_MARKERS)
    ):
        return True
    if len(body) > 18 and any(marker in body for marker in _BODY_LIST_ITEM_MARKERS):
        return True
    return len(body) > 28


__all__ = [
    "DOCUMENT_UNITS_SCHEMA_VERSION",
    "INSTITUTIONAL_TARGET_COLLECTION",
    "SCOPED_TARGET_COLLECTION",
    "STUDENT_TARGET_COLLECTION",
    "canonical_body_chunks",
    "normalize_regulation_canonical_body",
    "regulation_common_metadata",
    "resolve_regulation_block_structure",
    "serialize_regulation_document_units",
]
