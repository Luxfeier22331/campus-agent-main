from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from campus_shared.regulation_semantic_registry import resolve_regulation_action_type

from campus_ingestion_core.regulation_semantics import (
    infer_negative_semantic_role,
    infer_regulation_body_content_role,
    load_default_regulation_semantics_registry,
    looks_like_condition_claim_text,
    normalize_regulation_semantic_text,
)

_APPENDIX_PREFIXES = ("附件", "附表", "附录")
_FORM_KEYWORDS = ("申请表", "审批表", "登记表", "备案表", "信息表")
_FORM_FIELD_KEYWORDS = (
    "姓名",
    "学号",
    "学院",
    "专业",
    "联系电话",
    "签字",
    "签章",
    "盖章",
    "申请理由",
    "认定结果",
)
_FORM_CHECKBOX_MARKERS = ("☐", "□", "■", "✓", "√")
_DATE_EFFECTIVE_RE = re.compile(
    r"^(?:本(?:办法|规定|细则|制度|通知|规则)|该(?:办法|规定|细则|制度|通知|规则)).{0,24}自\d{4}年\d{1,2}月\d{1,2}日起(?:开始)?(?:实施|施行|执行)"
)
_NESTED_NUMBERED_LINE_RE = re.compile(
    r"^(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])"
)
_EXPLICIT_REGULATION_BODY_CONTENT_ROLES = frozenset({"regulation_body", "scoped_rule_body"})


@dataclass(frozen=True, slots=True)
class HandbookSemanticMetadata:
    content_kind: str
    content_role: str
    detail_label: str
    is_answer_bearing: bool
    semantic_role: str = ""
    polarity: str = ""
    action_type: str = ""
    claim_type: str = ""
    audience_scope: str = ""
    article_no: str = ""
    clause_no: str = ""
    section_kind: str = ""


def derive_handbook_semantic_metadata(
    *,
    unit_type: str,
    anchor: Mapping[str, object] | None,
    metadata: Mapping[str, object] | None,
    text: str,
) -> HandbookSemanticMetadata:
    resolved_anchor = anchor or {}
    resolved_metadata = metadata or {}
    detail_label = _resolve_detail_label(
        unit_type=unit_type,
        anchor=resolved_anchor,
        metadata=resolved_metadata,
    )
    content_kind = _resolve_content_kind(
        unit_type=unit_type,
        anchor=resolved_anchor,
        metadata=resolved_metadata,
        text=text,
        detail_label=detail_label,
    )
    content_role = _resolve_content_role(
        content_kind=content_kind,
        detail_label=detail_label,
        anchor=resolved_anchor,
        metadata=resolved_metadata,
        text=text,
    )
    semantic_role = _resolve_semantic_role(
        content_role=content_role,
        detail_label=detail_label,
        anchor=resolved_anchor,
        metadata=resolved_metadata,
        text=text,
    )
    polarity = _resolve_polarity(metadata=resolved_metadata, text=text, semantic_role=semantic_role)
    action_type = _resolve_action_type(
        anchor=resolved_anchor, metadata=resolved_metadata, text=text
    )
    claim_type = _resolve_claim_type(
        content_role=content_role,
        semantic_role=semantic_role,
        polarity=polarity,
        anchor=resolved_anchor,
        metadata=resolved_metadata,
        text=text,
    )
    return HandbookSemanticMetadata(
        content_kind=content_kind,
        content_role=content_role,
        detail_label=detail_label,
        is_answer_bearing=_resolve_is_answer_bearing(
            content_kind=content_kind,
            content_role=content_role,
            detail_label=detail_label,
            metadata=resolved_metadata,
        ),
        semantic_role=semantic_role,
        polarity=polarity,
        action_type=action_type,
        claim_type=claim_type,
        audience_scope=_resolve_audience_scope(
            anchor=resolved_anchor,
            metadata=resolved_metadata,
            text=text,
        ),
        article_no=_resolve_article_no(anchor=resolved_anchor, metadata=resolved_metadata),
        clause_no=_resolve_clause_no(anchor=resolved_anchor, metadata=resolved_metadata),
        section_kind=_resolve_section_kind(
            content_kind=content_kind,
            content_role=content_role,
            anchor=resolved_anchor,
            metadata=resolved_metadata,
        ),
    )


def _resolve_content_kind(
    *,
    unit_type: str,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
    text: str,
    detail_label: str,
) -> str:
    explicit_kind = _text(metadata.get("content_kind"))
    if explicit_kind:
        return explicit_kind
    if _looks_like_form(metadata=metadata, text=text, detail_label=detail_label):
        return "form"
    if _looks_like_structural_heading(anchor=anchor, text=text):
        return "navigation"
    if _looks_like_navigation(
        anchor=anchor, metadata=metadata, text=text, detail_label=detail_label
    ):
        return "navigation"
    if _looks_like_appendix(anchor=anchor, metadata=metadata, text=text, detail_label=detail_label):
        return "appendix"
    normalized_unit_type = unit_type.strip() or "policy_page"
    if normalized_unit_type == "table":
        return "table"
    return normalized_unit_type


def _resolve_content_role(
    *,
    content_kind: str,
    detail_label: str,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
    text: str,
) -> str:
    explicit_role = _text(metadata.get("content_role"))
    if explicit_role and explicit_role not in _EXPLICIT_REGULATION_BODY_CONTENT_ROLES:
        return explicit_role
    if content_kind == "navigation":
        return "navigation"
    if content_kind in {"appendix", "form"}:
        return "appendix"
    if content_kind == "table_unit":
        return "table_fact"
    if _is_amount_or_quota_fact(text):
        return "table_fact"
    if _is_closing_provision(detail_label=detail_label, anchor=anchor, text=text):
        return "closing_provision"
    shared_body_role = infer_regulation_body_content_role(
        detail_label=detail_label,
        section_leaf=_section_leaf(anchor),
        text=text,
    )
    if shared_body_role:
        return shared_body_role
    if explicit_role in _EXPLICIT_REGULATION_BODY_CONTENT_ROLES:
        return explicit_role
    return ""


def _resolve_is_answer_bearing(
    *,
    content_kind: str,
    content_role: str,
    detail_label: str,
    metadata: Mapping[str, object],
) -> bool:
    explicit_value = metadata.get("is_answer_bearing")
    if isinstance(explicit_value, bool):
        return explicit_value
    if content_kind in {"appendix", "form", "navigation"}:
        return False
    if content_role in {"appendix", "background", "closing_provision", "navigation", "scope_rule"}:
        return False
    if content_role in {
        "procedure",
        "requirement",
        "eligibility",
        "time_rule",
        "deadline",
        "table_fact",
        "definition",
    }:
        return True
    return bool(detail_label)


def _resolve_semantic_role(
    *,
    content_role: str,
    detail_label: str,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
    text: str,
) -> str:
    explicit_role = _text(metadata.get("semantic_role"))
    if explicit_role:
        return explicit_role
    normalized = _semantic_search_space(detail_label=detail_label, anchor=anchor, text=text)
    negative_role = infer_negative_semantic_role(normalized)
    if negative_role:
        return negative_role
    if content_role == "procedure":
        return "procedure_step"
    if content_role in {"eligibility", "requirement"}:
        return "condition"
    if content_role in {"deadline", "time_rule"}:
        return "time_constraint"
    if content_role == "definition":
        return "definition"
    return ""


def _resolve_polarity(
    *,
    metadata: Mapping[str, object],
    text: str,
    semantic_role: str,
) -> str:
    registry = load_default_regulation_semantics_registry()
    explicit_polarity = _text(metadata.get("polarity"))
    if explicit_polarity:
        return explicit_polarity
    normalized = normalize_regulation_semantic_text(text)
    if semantic_role in {"exception", "prohibition", "exclusion"}:
        return "negative"
    if any(keyword in normalized for keyword in registry.negative_polarity_keywords):
        return "negative"
    if normalized:
        return "positive"
    return ""


def _resolve_action_type(
    *,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
    text: str,
) -> str:
    assignment = resolve_regulation_action_type(
        text=text,
        section_path=_section_path(anchor),
        document_title=_text(metadata.get("title")),
        explicit_action_type=_text(metadata.get("action_type")),
    )
    return assignment.value


def _resolve_claim_type(
    *,
    content_role: str,
    semantic_role: str,
    polarity: str,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
    text: str,
) -> str:
    registry = load_default_regulation_semantics_registry()
    explicit_claim_type = _text(metadata.get("claim_type"))
    if explicit_claim_type:
        return explicit_claim_type
    if polarity == "negative":
        return "cannot_do"
    if content_role == "procedure" or semantic_role == "procedure_step":
        return "procedure"
    if content_role == "requirement":
        normalized = _semantic_search_space(detail_label="", anchor=anchor, text=text)
        if any(keyword in normalized for keyword in registry.material_markers):
            return "material_requirement"
        return "condition"
    if content_role == "eligibility" or semantic_role == "condition":
        return "condition"
    if content_role in {"deadline", "time_rule"}:
        return "time_constraint"
    if content_role == "definition":
        return "definition"
    if content_role == "table_fact":
        if _is_amount_or_quota_fact(text):
            return "amount_or_quota"
        return "table_fact"
    normalized = normalize_regulation_semantic_text(text)
    if looks_like_condition_claim_text(normalized):
        return "condition"
    return ""


def _is_amount_or_quota_fact(text: str) -> bool:
    normalized = normalize_regulation_semantic_text(text)
    if not normalized:
        return False
    return (
        "标准" in normalized
        and "元" in normalized
        and any(keyword in normalized for keyword in ("金额", "奖金", "奖励", "名额", "比例"))
    )


def _resolve_audience_scope(
    *,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
    text: str,
) -> str:
    registry = load_default_regulation_semantics_registry()
    explicit_scope = _text(metadata.get("audience_scope"))
    if explicit_scope:
        return explicit_scope
    normalized = _semantic_search_space(detail_label="", anchor=anchor, text=text)
    matched_scopes: list[str] = []
    for scope, keywords in registry.audience_scope_keywords.items():
        if any(keyword in normalized for keyword in keywords):
            matched_scopes.append(scope)
    if not matched_scopes:
        return ""
    if "undergraduate" in matched_scopes:
        return "undergraduate"
    if "graduate" in matched_scopes:
        return "graduate"
    return matched_scopes[0]


def _resolve_article_no(
    *,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
) -> str:
    return (
        _text(metadata.get("article_no"))
        or _text(anchor.get("article_no"))
        or _text(anchor.get("article_label"))
    )


def _resolve_clause_no(
    *,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
) -> str:
    return (
        _text(metadata.get("clause_no"))
        or _text(anchor.get("clause_no"))
        or _text(anchor.get("provision_label"))
    )


def _resolve_section_kind(
    *,
    content_kind: str,
    content_role: str,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
) -> str:
    explicit_kind = _text(metadata.get("section_kind"))
    if explicit_kind:
        return explicit_kind
    section_leaf = _section_leaf(anchor)
    if content_role == "closing_provision" or section_leaf == "附则":
        return "closing"
    if content_kind == "appendix" or content_role == "appendix":
        return "appendix"
    if content_kind == "navigation" or content_role == "navigation":
        return "navigation"
    if content_kind:
        return "body"
    return ""


def _resolve_detail_label(
    *,
    unit_type: str,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
) -> str:
    explicit_label = _text(metadata.get("detail_label"))
    if explicit_label:
        return explicit_label
    for key in ("article_label", "provision_label", "table_context"):
        value = _text(anchor.get(key))
        if value:
            return value
    if unit_type in {"policy_page", "section_text"}:
        section_leaf = _section_leaf(anchor)
        if section_leaf:
            return section_leaf
    return ""


def _is_closing_provision(*, detail_label: str, anchor: Mapping[str, object], text: str) -> bool:
    section_leaf = _section_leaf(anchor)
    if detail_label == "附则" or section_leaf == "附则":
        return True
    lines = _meaningful_lines(text)
    if not lines:
        return False
    return all(_is_terminal_provision_line(line) for line in lines)


def _looks_like_appendix(
    *,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
    text: str,
    detail_label: str,
) -> bool:
    search_space = (
        detail_label,
        _section_leaf(anchor),
        _text(metadata.get("title")),
        _first_meaningful_line(text),
    )
    return any(part and part.startswith(_APPENDIX_PREFIXES) for part in search_space)


def _looks_like_form(*, metadata: Mapping[str, object], text: str, detail_label: str) -> bool:
    candidates: list[str] = []
    candidates.extend(_normalize_sequence(metadata.get("caption_lines")))
    candidates.extend(_normalize_sequence(metadata.get("note_lines")))
    candidates.extend(_flatten_table_text(metadata.get("table_header_rows")))
    candidates.extend(_flatten_table_text(metadata.get("table_body_rows")))
    candidates.append(detail_label)
    combined = "\n".join(item for item in candidates if item)
    if not combined:
        return False
    if any(marker in combined for marker in _FORM_CHECKBOX_MARKERS):
        return True
    if any(keyword in combined for keyword in _FORM_KEYWORDS):
        return True
    field_hits = sum(1 for keyword in _FORM_FIELD_KEYWORDS if keyword in combined)
    return field_hits >= 2


def _looks_like_navigation(
    *,
    anchor: Mapping[str, object],
    metadata: Mapping[str, object],
    text: str,
    detail_label: str,
) -> bool:
    registry = load_default_regulation_semantics_registry()
    del metadata
    scope = " ".join(
        part for part in (detail_label, _section_leaf(anchor), _first_meaningful_line(text)) if part
    )
    if any(keyword in scope for keyword in registry.navigation_keywords):
        lines = _meaningful_lines(text)
        if sum(1 for line in lines if _NESTED_NUMBERED_LINE_RE.match(line)) >= 2:
            return True
        if "→" in text or "->" in text:
            return True
    return False


def _looks_like_structural_heading(*, anchor: Mapping[str, object], text: str) -> bool:
    lines = _meaningful_lines(text)
    if len(lines) != 1:
        return False
    section_leaf = _normalize_text(_section_leaf(anchor))
    if not section_leaf:
        return False
    normalized_text = _normalize_text(lines[0])
    if not normalized_text:
        return False
    return normalized_text == section_leaf


def _is_terminal_provision_line(line: str) -> bool:
    registry = load_default_regulation_semantics_registry()
    normalized = _strip_leading_label(_normalize_text(line))
    if not normalized:
        return False
    if any(keyword in normalized for keyword in registry.terminal_provision_markers):
        return True
    return bool(_DATE_EFFECTIVE_RE.match(normalized))


def _section_leaf(anchor: Mapping[str, object]) -> str:
    section_path = anchor.get("section_path")
    if not isinstance(section_path, Sequence):
        return ""
    for item in reversed(section_path):
        value = _text(item)
        if value:
            return value
    return ""


def _section_path(anchor: Mapping[str, object]) -> tuple[str, ...]:
    section_path = anchor.get("section_path")
    if not isinstance(section_path, Sequence) or isinstance(section_path, (str, bytes)):
        return ()
    return tuple(_text(item) for item in section_path if _text(item))


def _meaningful_lines(text: str) -> tuple[str, ...]:
    return tuple(line.strip() for line in text.splitlines() if line.strip())


def _first_meaningful_line(text: str) -> str:
    return next(iter(_meaningful_lines(text)), "")


def _semantic_search_space(
    *,
    detail_label: str,
    anchor: Mapping[str, object],
    text: str,
) -> str:
    return " ".join(
        part for part in (detail_label, _section_leaf(anchor), _normalize_text(text)) if part
    )


def _normalize_sequence(value: object) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
    normalized: list[str] = []
    for item in value:
        item_text = _text(item)
        if item_text:
            normalized.append(item_text)
    return normalized


def _flatten_table_text(value: object) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
    normalized: list[str] = []
    for row in value:
        if not isinstance(row, Sequence) or isinstance(row, (str, bytes)):
            continue
        for cell in row:
            cell_text = _text(cell)
            if cell_text:
                normalized.append(cell_text)
    return normalized


def _strip_leading_label(text: str) -> str:
    if not text:
        return ""
    if "、" in text[:6]:
        return text.split("、", 1)[1].strip()
    if text.startswith(("(", "（")) and ")" in text:
        return text.split(")", 1)[1].strip()
    if text.startswith(("(", "（")) and "）" in text:
        return text.split("）", 1)[1].strip()
    if "." in text[:4]:
        return text.split(".", 1)[1].strip()
    return text


def _normalize_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value.strip())


def _text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


__all__ = ["HandbookSemanticMetadata", "derive_handbook_semantic_metadata"]
