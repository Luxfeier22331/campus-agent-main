from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_classification import (
    classification_evidence_strength,
    classification_target_candidates,
)
from campus_ingestion_core.internal_notice_regulation_projection import (
    build_institutional_regulation_document_id,
)

REGULATION_TARGET = "regulation"
INSTITUTIONAL_TARGET_COLLECTION = "institutional_rules"
SCOPED_TARGET_COLLECTION = "scoped_rules"

REGULATION_CLASS_INSTITUTIONAL = "institutional_rules_candidate"
REGULATION_CLASS_SCOPED = "scoped_rules_candidate"
REGULATION_CLASS_NEEDS_MULTIMODAL = "needs_multimodal"
REGULATION_CLASS_WRAPPER_ONLY = "wrapper_only_searchable"
REGULATION_CLASS_DUPLICATE_HOLD = "duplicate_hold"
REGULATION_CLASS_HISTORICAL_ANNUAL_CYCLE_HOLD = "historical_annual_cycle_rule_hold"
REGULATION_CLASS_MANUAL_REVIEW = "manual_review"
REGULATION_CLASS_INVALID_CAPTURE = "invalid_capture"

_FORMAL_REGULATION_KEYWORDS = (
    "办法",
    "规定",
    "细则",
    "条例",
    "章程",
    "准则",
    "指导意见",
    "管理制度",
    "管理办法",
    "规章",
    "制度",
)
_WRAPPER_NOTICE_PREFIXES = ("关于发布", "关于印发", "关于修订", "关于转发", "关于公布")
_WRAPPER_NOTICE_KEYWORDS = ("通知", "现将", "予以发布", "予以印发", "请遵照执行", "转发")
_ANNUAL_CYCLE_OR_PROGRAM_RULE_KEYWORDS = (
    "报名时间",
    "网上报名",
    "报名网址",
    "选拔对象",
    "申请条件",
    "综合考核",
    "拟录取",
    "推免",
    "免试攻读",
    "硕博连读",
    "英才计划",
    "招生实施细则",
    "家庭经济困难学生认定",
)
_TIME_BOUND_OPERATIONAL_KEYWORDS = (
    "暑假期间",
    "寒假期间",
    "假期期间",
    "临时",
    "暂行",
    "试行",
    "过渡期",
)
_DRAFT_OR_SCHEME_KEYWORDS = ("征求意见稿", "草案", "讨论稿", "工作方案", "实施方案")
_QUOTE_TITLE_RE = re.compile(r"《([^》]{2,200})》")
_ARTICLE_MARKER_RE = re.compile(r"(^|\n)\s*第[一二三四五六七八九十百千万0-9]+条", re.MULTILINE)
_SECTION_MARKER_RE = re.compile(r"(^|\n)\s*[一二三四五六七八九十]+[、.]", re.MULTILINE)
_SUBSECTION_MARKER_RE = re.compile(r"(^|\n)\s*[（(][一二三四五六七八九十0-9]+[)）]", re.MULTILINE)
_NUMERIC_LIST_MARKER_RE = re.compile(r"(^|\n)\s*[0-9]{1,2}[、.]", re.MULTILINE)
_TEXT_MATCH_NORMALIZE_RE = re.compile(r"[\s《》“”\"'‘’()（）【】\[\]：:、，,。.;；·\-—_<>]")
_FILENAME_SUFFIX_RE = re.compile(r"\.(?:docx?|pdf|xlsx?)$", re.IGNORECASE)


def _looks_like_regulation_candidate(
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
) -> bool:
    if _has_strong_classified_regulation_route(unit):
        return True
    if _has_formal_owner_title(unit) and _has_source_owned_regulation_surface(unit):
        return True
    if _looks_like_wrapper_notice(unit) and _wrapper_notice_names_formal_regulation(unit):
        return True
    if _has_regulation_body_structure(str(unit.get("body_text") or "")) and _has_formal_owner_title(
        unit
    ):
        return True
    unit_id = str(unit.get("unit_id") or "")
    for row in multimodal_candidate_inventory.get("candidates") or ():
        if not isinstance(row, Mapping):
            continue
        if str(row.get("unit_id") or "") != unit_id:
            continue
        raw_hints = row.get("target_hints") or ()
        if (
            any(str(item).strip() == REGULATION_TARGET for item in raw_hints)
            and _has_formal_owner_title(unit)
            and _has_source_owned_regulation_surface(unit)
        ):
            return True
    return False


def _has_strong_classified_regulation_route(unit: Mapping[str, Any]) -> bool:
    if REGULATION_TARGET not in classification_target_candidates(unit):
        return False
    strength = classification_evidence_strength(unit)
    return strength in {"strong", "route_signal"}


def _has_source_owned_regulation_surface(unit: Mapping[str, Any]) -> bool:
    source_surface = str(unit.get("source_surface") or "").strip()
    if source_surface == "file_release":
        return True
    title = str(unit.get("title") or "").strip()
    return "通知" not in title or bool(_extract_quoted_title(title))


def _wrapper_notice_names_formal_regulation(unit: Mapping[str, Any]) -> bool:
    title = str(unit.get("title") or "").strip()
    quoted_title = _extract_quoted_title(title)
    return bool(quoted_title and _contains_regulation_keyword(quoted_title))


def _target_hints(unit: Mapping[str, Any]) -> list[str]:
    hints = unit.get("target_hints")
    if not isinstance(hints, Mapping):
        return []
    values = hints.get("candidate_targets")
    if not isinstance(values, list | tuple):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def _multimodal_policy(unit: Mapping[str, Any]) -> str:
    if _owner_text_status(unit) == "ready":
        return "completed"
    status = str(unit.get("multimodal_status") or "").strip()
    if status in {
        "not_required",
        "pending",
        "completed",
        "failed",
        "manual_review",
        "failed_retryable",
    }:
        return status
    return "not_required"


def _owner_text_status(unit: Mapping[str, Any]) -> str:
    status = str(unit.get("owner_text_status") or "").strip()
    if status == "ready":
        return "ready"
    return "not_ready"


def _looks_like_wrapper_notice(unit: Mapping[str, Any]) -> bool:
    title = str(unit.get("title") or "").strip()
    body = str(unit.get("body_text") or "").strip()
    combined = "\n".join((title, body))
    if any(title.startswith(prefix) for prefix in _WRAPPER_NOTICE_PREFIXES):
        return True
    if "通知" in title and _QUOTE_TITLE_RE.search(title):
        return True
    return bool(unit.get("attachment_refs")) and any(
        keyword in combined for keyword in _WRAPPER_NOTICE_KEYWORDS
    )


def _looks_like_draft_or_operational_scheme(unit: Mapping[str, Any]) -> bool:
    text = _policy_text(unit)
    return any(keyword in text for keyword in _DRAFT_OR_SCHEME_KEYWORDS)


def _has_formal_owner_title(unit: Mapping[str, Any]) -> bool:
    source_title = str(unit.get("title") or "").strip()
    quoted_title = _extract_quoted_title(source_title)
    if quoted_title:
        return _contains_regulation_keyword(quoted_title)
    if "通知" in source_title:
        return False
    if source_title.endswith(("公示", "提醒", "公告", "安排")):
        return False
    return _contains_regulation_keyword(source_title)


def _target_collection_for_text(unit: Mapping[str, Any]) -> str:
    text = _policy_text(unit)
    if any(keyword in text for keyword in _ANNUAL_CYCLE_OR_PROGRAM_RULE_KEYWORDS):
        return SCOPED_TARGET_COLLECTION
    if any(keyword in text for keyword in _TIME_BOUND_OPERATIONAL_KEYWORDS):
        return SCOPED_TARGET_COLLECTION
    return INSTITUTIONAL_TARGET_COLLECTION


def _is_historical_annual_cycle_rule(
    unit: Mapping[str, Any],
    *,
    generated_at: str,
) -> bool:
    if _target_collection_for_text(unit) != SCOPED_TARGET_COLLECTION:
        return False
    text = _policy_text(unit)
    if not any(keyword in text for keyword in _ANNUAL_CYCLE_OR_PROGRAM_RULE_KEYWORDS):
        return False
    cycle_year = _cycle_year_int(unit)
    generated_year = _year_from_text(generated_at)
    return cycle_year is not None and generated_year is not None and cycle_year < generated_year


def _cycle_year(unit: Mapping[str, Any]) -> str | None:
    cycle_year = _cycle_year_int(unit)
    return str(cycle_year) if cycle_year is not None else None


def _cycle_year_int(unit: Mapping[str, Any]) -> int | None:
    for value in (
        *_structured_cycle_year_values(unit),
        unit.get("title"),
        _regulation_title(unit),
        unit.get("published_at"),
        unit.get("source_notice_release_time"),
        unit.get("created_at"),
        unit.get("body_text"),
        unit.get("body_excerpt"),
        unit.get("search_text"),
    ):
        year = _year_from_text(value)
        if year is not None:
            return year
    return None


def _structured_cycle_year_values(unit: Mapping[str, Any]) -> tuple[object, ...]:
    values: list[object] = [unit.get("cycle_year")]
    for key in ("role_metadata", "target_hints"):
        metadata = unit.get(key)
        if isinstance(metadata, Mapping):
            values.append(metadata.get("cycle_year"))
    return tuple(values)


def _year_from_text(value: object) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        parsed = None
    if parsed is not None:
        return parsed.year
    match = re.search(r"(?:19|20)\d{2}", text)
    return int(match.group(0)) if match is not None else None


def _has_regulation_body_structure(body: str) -> bool:
    if not body.strip():
        return False
    return any(
        pattern.search(body) is not None
        for pattern in (
            _ARTICLE_MARKER_RE,
            _SECTION_MARKER_RE,
            _SUBSECTION_MARKER_RE,
            _NUMERIC_LIST_MARKER_RE,
        )
    )


def _coerce_recovered_owner_text_payload(value: object) -> dict[str, Any] | None:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        return {"owner_text": text}
    if not isinstance(value, Mapping):
        return None
    text = str(value.get("owner_text") or value.get("text") or "").strip()
    if not text:
        return None
    return {"owner_text": text, **{str(key): item for key, item in value.items()}}


def _read_owner_text_from_searchable_merge_input(
    *,
    object_store: Any,
    ref: Mapping[str, Any],
) -> str:
    data = object_store.get_bytes(
        bucket=_required_ref_text(ref, "bucket"),
        key=_required_ref_text(ref, "key"),
    )
    payload = json.loads(data.decode("utf-8"))
    if not isinstance(payload, Mapping):
        return ""
    return str(payload.get("owner_text") or "").strip()


def _read_owner_text_from_plain_text_ref(
    *,
    object_store: Any,
    ref: Mapping[str, Any],
) -> str:
    data = object_store.get_bytes(
        bucket=_required_ref_text(ref, "bucket"),
        key=_required_ref_text(ref, "key"),
    )
    texts: list[str] = []
    for line in data.decode("utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, Mapping):
            continue
        text = str(payload.get("text") or "").strip()
        if text:
            texts.append(text)
    return "\n\n".join(texts)


def _required_ref_text(ref: Mapping[str, Any], key: str) -> str:
    value = str(ref.get(key) or "").strip()
    if not value:
        raise ValueError(f"owner text ref missing {key}")
    return value


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _contains_regulation_keyword(text: str) -> bool:
    return any(keyword in text for keyword in _FORMAL_REGULATION_KEYWORDS)


def _regulation_title(unit: Mapping[str, Any]) -> str | None:
    title = _clean_title(str(unit.get("title") or ""))
    body = str(unit.get("body_text") or "")
    for candidate in (
        _extract_quoted_title(title),
        title,
        _extract_quoted_title(body),
    ):
        cleaned = _clean_title(candidate or "")
        if cleaned:
            return cleaned
    return None


def _extract_quoted_title(value: str | None) -> str | None:
    if value is None:
        return None
    match = _QUOTE_TITLE_RE.search(value)
    if match is None:
        return None
    return match.group(1).strip() or None


def _clean_title(value: str) -> str:
    cleaned = str(value or "").strip()
    cleaned = re.sub(r"^\s*附件\s*\d*\s*[:：、.-]?\s*", "", cleaned)
    return _FILENAME_SUFFIX_RE.sub("", cleaned).strip()


def _issuing_org(unit: Mapping[str, Any]) -> str:
    text = _policy_text(unit)
    if "中央民族大学" in text:
        return "中央民族大学"
    return "中央民族大学"


def _candidate_key(
    *,
    regulation_title: str | None,
    issuing_org: str,
    target_collection: str | None,
) -> str | None:
    if not regulation_title or not target_collection:
        return None
    digest = hashlib.sha256(
        "\n".join(
            (
                _normalize_text_match(regulation_title),
                issuing_org.strip(),
                f"regulations/{target_collection}",
            )
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"regulation-candidate:{target_collection}:{digest}"


def _target_identity_preview(
    *,
    regulation_title: str | None,
    issuing_org: str,
    target_collection: str | None,
) -> str | None:
    if not regulation_title or not target_collection:
        return None
    return build_institutional_regulation_document_id(
        regulation_title_normalized=regulation_title,
        regulation_work_title=regulation_title,
        issuing_org=issuing_org,
        semantic_scope=f"regulations/{target_collection}",
    )


def _normalize_text_match(value: str | None) -> str:
    if value is None:
        return ""
    return _TEXT_MATCH_NORMALIZE_RE.sub("", value)


def _policy_text(unit: Mapping[str, Any]) -> str:
    return "\n".join(
        str(unit.get(key) or "") for key in ("title", "body_text", "body_excerpt", "search_text")
    )


def _preconditions(decision: Any) -> list[str]:
    if not decision.admitted:
        return []
    return [
        "searchable_unit_present",
        "source_object_refs_present",
        "regulation_candidate_audit_passed",
        "no_current_promotion",
        "phase6r2_gated_materialization_required",
    ]


def _queue_trace_by_unit_id(
    queue_consume_trace: Mapping[str, Any] | None,
) -> dict[str, Mapping[str, Any]]:
    if not queue_consume_trace:
        return {}
    rows_by_unit: dict[str, Mapping[str, Any]] = {}
    for row in queue_consume_trace.get("trace_rows") or ():
        if not isinstance(row, Mapping):
            continue
        for unit_id in row.get("searchable_unit_refs") or ():
            normalized = str(unit_id or "").strip()
            if normalized:
                rows_by_unit[normalized] = row
    return rows_by_unit


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


__all__ = [
    "INSTITUTIONAL_TARGET_COLLECTION",
    "REGULATION_CLASS_DUPLICATE_HOLD",
    "REGULATION_CLASS_HISTORICAL_ANNUAL_CYCLE_HOLD",
    "REGULATION_CLASS_INSTITUTIONAL",
    "REGULATION_CLASS_INVALID_CAPTURE",
    "REGULATION_CLASS_MANUAL_REVIEW",
    "REGULATION_CLASS_NEEDS_MULTIMODAL",
    "REGULATION_CLASS_SCOPED",
    "REGULATION_CLASS_WRAPPER_ONLY",
    "REGULATION_TARGET",
    "SCOPED_TARGET_COLLECTION",
    "_candidate_key",
    "_coerce_recovered_owner_text_payload",
    "_cycle_year",
    "_has_formal_owner_title",
    "_has_regulation_body_structure",
    "_is_historical_annual_cycle_rule",
    "_issuing_org",
    "_load_json_object",
    "_looks_like_draft_or_operational_scheme",
    "_looks_like_regulation_candidate",
    "_looks_like_wrapper_notice",
    "_mapping_rows",
    "_multimodal_policy",
    "_owner_text_status",
    "_policy_text",
    "_preconditions",
    "_queue_trace_by_unit_id",
    "_read_owner_text_from_plain_text_ref",
    "_read_owner_text_from_searchable_merge_input",
    "_regulation_title",
    "_target_collection_for_text",
    "_target_identity_preview",
]
