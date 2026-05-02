from __future__ import annotations

import hashlib
import html
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.historical_regulation_chunk_backfill import (
    build_candidate_store_noop_assertion,
    build_serving_closed_assertion,
)

HISTORICAL_REGULATION_SCHOOL_LEVEL_INVENTORY_SCHEMA_VERSION = (
    "historical_regulation_school_level_inventory.v1"
)

SCHOOL_LEVEL_READY_FOR_CANONICAL_CHUNK = "school_level_ready_for_canonical_chunk"
SCOPED_RULE_CHUNK_ONLY_NON_SERVING = "scoped_rule_chunk_only_non_serving"
WRAPPER_NEEDS_OWNER_TEXT_RECOVERY = "wrapper_needs_owner_text_recovery"
WRAPPER_SUMMARY_BACKLOG = "wrapper_summary_backlog"
DUPLICATE_HOLD = "duplicate_hold"
ALREADY_COMPLETED_HOLD = "already_completed_hold"
OPERATOR_EXCLUDED_HOLD = "operator_excluded_hold"
NOT_REGULATION_LIKE_HOLD = "not_regulation_like_hold"

INSTITUTIONAL_RULES = "institutional_rules"
SCOPED_RULES = "scoped_rules"

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
_WRAPPER_PREFIXES = ("关于发布", "关于印发", "关于修订", "关于转发", "关于公布")
_OWNER_TEXT_STRUCTURE_RE = re.compile(
    r"(^|\n)\s*(?:第[一二三四五六七八九十百千万0-9]+条|[一二三四五六七八九十]+[、.]|[（(][一二三四五六七八九十0-9]+[)）]|[0-9]{1,2}[、.])",
    re.MULTILINE,
)
_INLINE_ARTICLE_MARKER_RE = re.compile(r"第[一二三四五六七八九十百千万0-9]+条")
_QUOTE_TITLE_RE = re.compile(r"《([^》]{2,200})》")
_SLUG_CLEAN_RE = re.compile(r"[^\w\u4e00-\u9fff]+")
_REPEATED_DASH_RE = re.compile(r"-{2,}")

_SCOPED_TITLE_MARKERS = (
    "学院",
    "书院",
    "研究院",
    "中心",
    "系",
    "实验室",
    "医院",
    "硕博连读",
    "英才计划",
    "推免",
    "免试攻读",
    "招生实施细则",
    "暑假期间",
    "寒假期间",
)
_SCHOOL_LEVEL_POSITIVE_MARKERS = (
    "中央民族大学",
    "我校",
    "学校",
    "全校",
    "各单位",
    "各部门",
    "各学院",
)
_WRAPPER_SUMMARY_BODY_MARKERS = (
    "请遵照执行",
    "遵照执行",
    "请认真贯彻执行",
    "现予以印发",
    "现予以发布",
)
_SCHOOL_LEVEL_ORGANIZATIONS = {
    "学校办公室",
    "党委办公室",
    "校长办公室",
    "教务处",
    "研究生院",
    "学生工作部",
    "校医院",
    "采购与招标管理中心",
}
_SCHOOL_LEVEL_NOTICE_ID_OVERRIDES = {
    "191705": "historical_manual_school_level_regulation",
    "187233": "historical_manual_school_level_target_recovery",
}
_OPERATOR_EXCLUDED_NOTICE_IDS = {
    "351119": "operator_excluded_from_owner_recovery",
}
_SOURCE_NOTICE_IDS_REQUIRING_COMPLETE_OWNER_TEXT = {
    "187233": "body_text_not_complete_owner_policy",
}
_DUPLICATE_SURVIVOR_BY_NOTICE_ID = {
    "191177": "191176",
}


def build_historical_regulation_school_level_inventory(
    *,
    collected_bundle: object,
    completed_manifest: Mapping[str, Any] | None = None,
    generated_at: str | None = None,
    generated_by: str = ("campus_ingestion_core.historical_regulation_school_level_inventory"),
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    completed_ids = _completed_source_notice_ids(completed_manifest or {})
    records = _build_records(
        bundle_rows=_bundle_rows(collected_bundle),
        completed_ids=completed_ids,
    )
    status_counts = Counter(str(record["status"]) for record in records)
    target_collection_counts = Counter(
        str(record["target_collection"])
        for record in records
        if str(record.get("target_collection") or "")
    )
    school_level_ready = [
        record for record in records if record["status"] == SCHOOL_LEVEL_READY_FOR_CANONICAL_CHUNK
    ]
    scoped_non_serving = [
        record for record in records if record["status"] == SCOPED_RULE_CHUNK_ONLY_NON_SERVING
    ]
    recovery_records = [
        record
        for record in records
        if record["status"] in {WRAPPER_NEEDS_OWNER_TEXT_RECOVERY, WRAPPER_SUMMARY_BACKLOG}
    ]
    hold_records = [
        record
        for record in records
        if record["status"]
        in {
            DUPLICATE_HOLD,
            ALREADY_COMPLETED_HOLD,
            OPERATOR_EXCLUDED_HOLD,
            NOT_REGULATION_LIKE_HOLD,
        }
    ]
    canonical_chunk_candidates = [*school_level_ready, *scoped_non_serving]
    return {
        "schema_version": HISTORICAL_REGULATION_SCHOOL_LEVEL_INVENTORY_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "offline_school_level_regulation_inventory",
        "write_enabled": False,
        "scope": "already_collected_regulation_like_notice_inventory",
        "input_notice_count": len(records),
        "status_counts": dict(sorted(status_counts.items())),
        "target_collection_counts": dict(sorted(target_collection_counts.items())),
        "school_level_ready_notice_ids": _notice_ids(school_level_ready),
        "canonical_chunk_candidate_notice_ids": _notice_ids(canonical_chunk_candidates),
        "downstream_eligible_notice_ids": _notice_ids(school_level_ready),
        "non_serving_notice_ids": _notice_ids(scoped_non_serving),
        "recovery_notice_ids": _notice_ids(recovery_records),
        "hold_notice_ids": _notice_ids(hold_records),
        "records": records,
        "policy": {
            "scope_baseline": (
                "only_school_level_regulations_enter_document_site_or_rag_consumption"
            ),
            "school_level_collection": INSTITUTIONAL_RULES,
            "non_serving_collection": SCOPED_RULES,
            "canonical_chunk_candidate_statuses": [
                SCHOOL_LEVEL_READY_FOR_CANONICAL_CHUNK,
                SCOPED_RULE_CHUNK_ONLY_NON_SERVING,
            ],
            "downstream_consumption_eligible_collections": [INSTITUTIONAL_RULES],
            "stop_point": "canonical_document_units_chunk_quality_only",
            "disallowed_downstream_steps": [
                "rag_release_candidate_enqueue",
                "embedding",
                "index_release",
                "alias_publish",
                "document_site_publish_for_scoped_rules",
            ],
        },
        "serving_closed_assertion": build_serving_closed_assertion(generated_at=timestamp),
        "candidate_store_noop_assertion": _candidate_store_noop_assertion(generated_at=timestamp),
    }


def _build_records(
    *,
    bundle_rows: Sequence[Mapping[str, Any]],
    completed_ids: set[str],
) -> list[dict[str, Any]]:
    prelim_records = [
        _build_prelim_record(row=row, completed_ids=completed_ids) for row in bundle_rows
    ]
    duplicate_survivor_by_id = _duplicate_survivor_by_notice_id(prelim_records)
    return [
        _finalize_record(
            prelim=prelim,
            duplicate_survivor_notice_id=duplicate_survivor_by_id.get(
                str(prelim["source_notice_id"])
            ),
        )
        for prelim in prelim_records
    ]


def _build_prelim_record(
    *,
    row: Mapping[str, Any],
    completed_ids: set[str],
) -> dict[str, Any]:
    notice = row.get("notice") if isinstance(row.get("notice"), Mapping) else {}
    notice_id = _required_text(row.get("notice_id") or notice.get("notice_id"), "notice_id")
    title = _required_text(notice.get("notice_title") or row.get("notice_title"), "title")
    body_text = _html_to_text(str(notice.get("notice_content") or row.get("notice_content") or ""))
    organization_name = str(
        notice.get("organization_name") or row.get("organization_name") or ""
    ).strip()
    published_at = str(
        notice.get("notice_release_time")
        or notice.get("notice_first_time")
        or row.get("notice_release_time")
        or ""
    ).strip()
    effective_title = _effective_regulation_title(title=title, body_text=body_text)
    regulation_like = _looks_like_regulation_like(title=title, body_text=body_text)
    owner_text_present = _has_owner_text_body(title=title, body_text=body_text)
    wrapper = _looks_like_wrapper(title)
    scoped = (
        False
        if notice_id in _SCHOOL_LEVEL_NOTICE_ID_OVERRIDES
        else _looks_scoped(title=title, body_text=body_text, organization_name=organization_name)
    )
    target_collection = _target_collection(scoped=scoped, regulation_like=regulation_like)
    status, reason_codes = _classify_status(
        notice_id=notice_id,
        title=title,
        body_text=body_text,
        completed_ids=completed_ids,
        regulation_like=regulation_like,
        owner_text_present=owner_text_present,
        wrapper=wrapper,
        scoped=scoped,
    )
    target_document_id = (
        _target_document_id(title=effective_title, target_collection=target_collection)
        if target_collection
        else ""
    )
    object_storage_prefix = (
        _object_storage_prefix(title=effective_title, target_collection=target_collection)
        if target_collection
        else ""
    )
    return {
        "source_notice_id": notice_id,
        "title": title,
        "effective_regulation_title": effective_title,
        "organization_name": organization_name,
        "published_at": published_at,
        "status": status,
        "target_collection": target_collection,
        "target_surface": f"regulations/{target_collection}" if target_collection else "",
        "target_document_id": target_document_id,
        "object_storage_prefix": object_storage_prefix,
        "body_text_length": len(body_text),
        "owner_text_present": owner_text_present,
        "wrapper_notice": wrapper,
        "school_level_candidate": target_collection == INSTITUTIONAL_RULES,
        "scoped_rule_candidate": target_collection == SCOPED_RULES,
        "document_site_eligible": False,
        "rag_consumption_eligible": False,
        "downstream_consumption_status": "not_ready_for_downstream_consumption",
        "reason_codes": reason_codes,
        "duplicate_survivor_notice_id": "",
        "already_completed": notice_id in completed_ids,
        "query_serving_opened": False,
        "rag_release_opened": False,
        "embedding_opened": False,
        "index_release_opened": False,
        "alias_publish_opened": False,
    }


def _finalize_record(
    *,
    prelim: Mapping[str, Any],
    duplicate_survivor_notice_id: str | None,
) -> dict[str, Any]:
    record = dict(prelim)
    if duplicate_survivor_notice_id:
        record["status"] = DUPLICATE_HOLD
        record["reason_codes"] = ["duplicate_regulation_title_hold"]
        record["duplicate_survivor_notice_id"] = duplicate_survivor_notice_id
        record["target_collection"] = ""
        record["target_surface"] = ""
        record["target_document_id"] = ""
        record["object_storage_prefix"] = ""
        record["school_level_candidate"] = False
        record["scoped_rule_candidate"] = False
    elif record["status"] == SCHOOL_LEVEL_READY_FOR_CANONICAL_CHUNK:
        record["document_site_eligible"] = True
        record["rag_consumption_eligible"] = True
        record["downstream_consumption_status"] = "eligible_after_release_gate"
    elif record["status"] == SCOPED_RULE_CHUNK_ONLY_NON_SERVING:
        record["document_site_eligible"] = False
        record["rag_consumption_eligible"] = False
        record["downstream_consumption_status"] = "chunk_only_non_serving"
    return record


def _classify_status(
    *,
    notice_id: str,
    title: str,
    body_text: str,
    completed_ids: set[str],
    regulation_like: bool,
    owner_text_present: bool,
    wrapper: bool,
    scoped: bool,
) -> tuple[str, list[str]]:
    if notice_id in completed_ids:
        return ALREADY_COMPLETED_HOLD, ["already_completed_in_prior_canonical_chunk_cohort"]
    if notice_id in _OPERATOR_EXCLUDED_NOTICE_IDS:
        return OPERATOR_EXCLUDED_HOLD, [_OPERATOR_EXCLUDED_NOTICE_IDS[notice_id]]
    if notice_id in _SOURCE_NOTICE_IDS_REQUIRING_COMPLETE_OWNER_TEXT:
        return WRAPPER_NEEDS_OWNER_TEXT_RECOVERY, [
            _SOURCE_NOTICE_IDS_REQUIRING_COMPLETE_OWNER_TEXT[notice_id]
        ]
    if not regulation_like:
        return NOT_REGULATION_LIKE_HOLD, ["not_regulation_like_after_inventory_scan"]
    if wrapper and not owner_text_present:
        if _looks_like_summary_notice_body(body_text):
            return WRAPPER_SUMMARY_BACKLOG, ["wrapper_summary_not_owner_text"]
        return WRAPPER_NEEDS_OWNER_TEXT_RECOVERY, ["wrapper_not_owner_text"]
    if wrapper and _looks_like_summary_notice_body(body_text):
        return WRAPPER_SUMMARY_BACKLOG, ["wrapper_summary_not_owner_text"]
    if not owner_text_present:
        return WRAPPER_NEEDS_OWNER_TEXT_RECOVERY, ["owner_text_not_sufficient"]
    if scoped:
        return SCOPED_RULE_CHUNK_ONLY_NON_SERVING, [
            "scoped_or_college_level_regulation",
            "non_serving_by_policy",
        ]
    return SCHOOL_LEVEL_READY_FOR_CANONICAL_CHUNK, [
        "school_level_regulation_candidate",
        "requires_canonical_document_units_chunk_quality_gate",
    ]


def _duplicate_survivor_by_notice_id(
    records: Sequence[Mapping[str, Any]],
) -> dict[str, str]:
    duplicate_by_notice: dict[str, str] = dict(_DUPLICATE_SURVIVOR_BY_NOTICE_ID)
    survivor_by_key: dict[tuple[str, str], str] = {}
    for record in records:
        notice_id = str(record.get("source_notice_id") or "")
        if notice_id in duplicate_by_notice:
            survivor = duplicate_by_notice[notice_id]
            target_collection = str(record.get("target_collection") or "")
            effective_title = str(
                record.get("effective_regulation_title") or record.get("title") or ""
            )
            key = (target_collection, _normalize_match(effective_title))
            if key[0] and key[1]:
                survivor_by_key[key] = survivor
    for record in records:
        if record.get("status") not in {
            SCHOOL_LEVEL_READY_FOR_CANONICAL_CHUNK,
            SCOPED_RULE_CHUNK_ONLY_NON_SERVING,
        }:
            continue
        notice_id = str(record.get("source_notice_id") or "")
        if notice_id in duplicate_by_notice:
            continue
        target_collection = str(record.get("target_collection") or "")
        effective_title = str(record.get("effective_regulation_title") or record.get("title") or "")
        key = (target_collection, _normalize_match(effective_title))
        if not key[0] or not key[1]:
            continue
        survivor = survivor_by_key.setdefault(key, notice_id)
        if survivor != notice_id:
            duplicate_by_notice[notice_id] = survivor
    return duplicate_by_notice


def _target_collection(*, scoped: bool, regulation_like: bool) -> str:
    if not regulation_like:
        return ""
    return SCOPED_RULES if scoped else INSTITUTIONAL_RULES


def _looks_like_regulation_like(*, title: str, body_text: str) -> bool:
    text = f"{title}\n{body_text}"
    return any(keyword in text for keyword in _FORMAL_REGULATION_KEYWORDS)


def _has_owner_text_body(*, title: str, body_text: str) -> bool:
    if not body_text.strip():
        return False
    if _OWNER_TEXT_STRUCTURE_RE.search(body_text) or _INLINE_ARTICLE_MARKER_RE.search(body_text):
        return True
    if len(body_text) >= 80 and any(
        keyword in body_text for keyword in _FORMAL_REGULATION_KEYWORDS
    ):
        return True
    return not _looks_like_wrapper(title) and len(body_text) >= 40


def _looks_like_wrapper(title: str) -> bool:
    normalized = title.strip()
    if any(normalized.startswith(prefix) for prefix in _WRAPPER_PREFIXES):
        return True
    return "通知" in normalized and _QUOTE_TITLE_RE.search(normalized) is not None


def _looks_like_summary_notice_body(body_text: str) -> bool:
    return any(marker in body_text for marker in _WRAPPER_SUMMARY_BODY_MARKERS) and not (
        _OWNER_TEXT_STRUCTURE_RE.search(body_text) or _INLINE_ARTICLE_MARKER_RE.search(body_text)
    )


def _looks_scoped(*, title: str, body_text: str, organization_name: str) -> bool:
    combined_without_org = f"{title}\n{body_text}"
    combined = f"{combined_without_org}\n{organization_name}"
    marker_text = (
        combined_without_org if organization_name in _SCHOOL_LEVEL_ORGANIZATIONS else combined
    )
    if any(marker in marker_text for marker in _SCOPED_TITLE_MARKERS):
        return "各学院" not in combined and "各教学单位" not in combined
    return bool(
        organization_name
        and organization_name not in _SCHOOL_LEVEL_ORGANIZATIONS
        and not any(marker in combined for marker in _SCHOOL_LEVEL_POSITIVE_MARKERS)
    )


def _effective_regulation_title(*, title: str, body_text: str) -> str:
    for value in (
        _extract_quoted_title(title),
        title,
        _extract_quoted_title(body_text),
    ):
        cleaned = str(value or "").strip()
        if cleaned:
            return _strip_title_noise(cleaned)
    return _strip_title_noise(title)


def _extract_quoted_title(value: str) -> str:
    match = _QUOTE_TITLE_RE.search(value)
    return match.group(1).strip() if match is not None else ""


def _strip_title_noise(value: str) -> str:
    cleaned = str(value or "").strip()
    cleaned = re.sub(r"^\s*附件\s*\d*\s*[:：、.-]?\s*", "", cleaned)
    return re.sub(r"^重要通知[-—–_ ]*", "", cleaned).strip()


def _target_document_id(*, title: str, target_collection: str) -> str:
    digest = hashlib.sha256(f"{target_collection}\n{_normalize_match(title)}".encode())
    prefix = (
        "institutional_regulation" if target_collection == INSTITUTIONAL_RULES else "scoped_rule"
    )
    return f"{prefix}:muc:{_slug(title)}:{digest.hexdigest()[:12]}"


def _object_storage_prefix(*, title: str, target_collection: str) -> str:
    digest = hashlib.sha256(f"{target_collection}\n{_normalize_match(title)}".encode())
    return (
        f"regulations/documents/{target_collection}/"
        f"{_slug(title)}--{digest.hexdigest()[:8]}/current-effective/undated/"
    )


def _slug(value: str) -> str:
    slug = _SLUG_CLEAN_RE.sub("-", value.strip())
    slug = _REPEATED_DASH_RE.sub("-", slug).strip("-")
    return slug[:80] or "untitled"


def _normalize_match(value: str) -> str:
    return re.sub(r"[\s《》“”\"'‘’()（）【】\[\]：:、，,。.;；·\-—_<>]", "", value)


def _html_to_text(value: str) -> str:
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", value)
    text = re.sub(r"(?i)</\s*p\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text).replace("\xa0", " ")
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _bundle_rows(payload: object) -> tuple[Mapping[str, Any], ...]:
    rows: object
    if isinstance(payload, Mapping):
        rows = payload.get("notices") or payload.get("records") or payload.get("items") or ()
    else:
        rows = payload
    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
        return ()
    return tuple(row for row in rows if isinstance(row, Mapping))


def _completed_source_notice_ids(manifest: Mapping[str, Any]) -> set[str]:
    return {
        str(entry.get("source_notice_id") or "").strip()
        for entry in _mapping_rows(manifest.get("entries"))
        if str(entry.get("source_notice_id") or "").strip()
    }


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(row for row in value if isinstance(row, Mapping))


def _notice_ids(records: Sequence[Mapping[str, Any]]) -> list[str]:
    return [str(record["source_notice_id"]) for record in records]


def _candidate_store_noop_assertion(*, generated_at: str) -> dict[str, Any]:
    assertion = build_candidate_store_noop_assertion(generated_at=generated_at)
    assertion["candidate_enqueue_opened"] = False
    assertion["rag_release_candidate_rows_created"] = 0
    return assertion


def _required_text(value: object, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{label} is required")
    return text


__all__ = [
    "ALREADY_COMPLETED_HOLD",
    "DUPLICATE_HOLD",
    "HISTORICAL_REGULATION_SCHOOL_LEVEL_INVENTORY_SCHEMA_VERSION",
    "NOT_REGULATION_LIKE_HOLD",
    "OPERATOR_EXCLUDED_HOLD",
    "SCHOOL_LEVEL_READY_FOR_CANONICAL_CHUNK",
    "SCOPED_RULE_CHUNK_ONLY_NON_SERVING",
    "WRAPPER_NEEDS_OWNER_TEXT_RECOVERY",
    "WRAPPER_SUMMARY_BACKLOG",
    "build_historical_regulation_school_level_inventory",
]
