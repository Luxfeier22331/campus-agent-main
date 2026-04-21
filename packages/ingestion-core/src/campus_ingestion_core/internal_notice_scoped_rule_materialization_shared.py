from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from dataclasses import dataclass

from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionDocumentReport,
)
from campus_ingestion_core.models import DocumentRegistryRecord

_TARGET_SCOPE = ("regulations", "scoped_rules")
_TARGET_SOURCE_FILENAME = "internal-notice-scoped-rules-manifest.json"
_TARGET_IMPORT_SOURCE = "internal_notice_scoped_rule_materialization"
_TARGET_PARSER_VERSION = "internal_notice_scoped_rule_materialization_v1"
_SOURCE_URL_PREFIX = "campusrag://promotion/internal_notice_scoped_rules"
_YEAR_RE = re.compile(r"(19|20)\d{2}")
_INSTITUTION_PREFIX = "中央民族大学"
_SCHOOL_UNIT_RE = re.compile(
    r"(?P<unit>[一-龥]{2,30}(?:学院|学部|研究院|中心|处|部|办公室|实验室))"
)
_SCHOOL_UNIT_FULL_RE = re.compile(r"^[一-龥]{2,30}(?:学院|学部|研究院|中心|处|部|办公室|实验室)$")
_CAMPUS_SITE_RE = re.compile(r"(?P<site>[一-龥A-Za-z0-9]{2,20}校区)")
_PROVISIONAL_IN_FORCE_RE = re.compile(r"(暂行|试行)")


@dataclass(frozen=True, slots=True)
class InternalNoticeScopedRuleCandidate:
    source_document_id: str
    notice_id: str
    site_id: str
    source_kind: str
    input_lane: str
    revision_track: str
    version_id: str
    document_nature: str
    title: str
    issuing_org: str | None
    effective_date: str | None
    revision_signal: str | None
    source_notice_release_time: str | None
    source_parent_document_id: str | None
    source_attachment_ref_id: str | None
    source_attachment_sha256: str | None
    duplicate_group_key: str | None
    source_uri: str
    entitlement_groups: tuple[str, ...]
    visibility_scope: str | None
    visibility_level: str
    is_current: bool
    reasons: tuple[str, ...]
    promotion_body: str
    cycle_year: str | None
    school_unit_name: str | None
    campus_site: str | None
    force_status: str | None


@dataclass(frozen=True, slots=True)
class InternalNoticeScopedRuleMaterializationReport:
    scoped_rule_candidate_count: int
    materialized_document_count: int
    created_document_ids: tuple[str, ...]
    updated_document_ids: tuple[str, ...]
    document_nature_counts: dict[str, int]
    source_notice_ids: tuple[str, ...]
    source_document_ids: tuple[str, ...]
    raw_asset_id: str
    raw_version_id: str


@dataclass(frozen=True, slots=True)
class _ScopedRuleAggregation:
    primary_report: InternalNoticeRegulationPromotionDocumentReport
    primary_candidate: InternalNoticeScopedRuleCandidate
    source_record: DocumentRegistryRecord
    duplicate_reports: tuple[InternalNoticeRegulationPromotionDocumentReport, ...]


def _detect_scoped_rule_nature(
    report: InternalNoticeRegulationPromotionDocumentReport,
) -> str | None:
    if report.target_collection != _TARGET_SCOPE[1]:
        return None
    if report.document_nature in {"annual_cycle_rule", "time_bound_operational_rule"}:
        return report.document_nature
    return None


def _candidate_group_key(candidate: InternalNoticeScopedRuleCandidate) -> str:
    return (
        _candidate_semantic_group_key(candidate)
        or candidate.duplicate_group_key
        or candidate.source_attachment_sha256
        or candidate.version_id
        or candidate.source_document_id
    )


def _candidate_semantic_group_key(candidate: InternalNoticeScopedRuleCandidate) -> str | None:
    body = candidate.promotion_body.strip()
    title = candidate.title.strip()
    if not title or not body:
        return None
    digest = hashlib.sha256(
        "\n".join(
            (
                candidate.document_nature,
                title,
                body,
                candidate.effective_date or "",
                candidate.revision_signal or "",
            )
        ).encode("utf-8")
    ).hexdigest()
    return f"semantic:{digest}"


def _scoped_rule_sort_key(candidate: InternalNoticeScopedRuleCandidate) -> tuple[object, ...]:
    lane_rank = {
        "attachment_text_extractable": 0,
        "attachment_ocr_required": 1,
        "notice_body": 2,
    }.get(candidate.input_lane, 3)
    revision_rank = {
        "current-effective": 0,
        "source-faithful": 1,
    }.get(candidate.revision_track, 2)
    return (lane_rank, revision_rank, candidate.source_document_id)


def _aggregate_notice_ids(aggregation: _ScopedRuleAggregation) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                aggregation.primary_candidate.notice_id,
                *(report.notice_id for report in aggregation.duplicate_reports),
            }
        )
    )


def _extract_cycle_year(text: str) -> str | None:
    match = _YEAR_RE.search(text)
    return match.group(0) if match is not None else None


def _extract_school_unit_name(text: str) -> str | None:
    match = _SCHOOL_UNIT_RE.search(text)
    if match is None:
        return None
    unit = match.group("unit").strip()
    if unit.startswith(_INSTITUTION_PREFIX):
        normalized = unit.removeprefix(_INSTITUTION_PREFIX).strip()
        if normalized and _SCHOOL_UNIT_FULL_RE.fullmatch(normalized) is not None:
            return normalized
    return unit if _SCHOOL_UNIT_FULL_RE.fullmatch(unit) is not None else None


def _extract_campus_site(text: str) -> str | None:
    match = _CAMPUS_SITE_RE.search(text)
    return match.group("site") if match is not None else None


def _extract_force_status(text: str) -> str | None:
    if _PROVISIONAL_IN_FORCE_RE.search(text):
        return "provisional_in_force"
    return None


def _infer_year_label(candidate: InternalNoticeScopedRuleCandidate) -> str | None:
    for value in (
        candidate.cycle_year,
        candidate.effective_date,
        candidate.source_notice_release_time,
        candidate.title,
    ):
        if value is None:
            continue
        match = _YEAR_RE.search(value)
        if match is not None:
            return match.group(0)
    return None


def _split_markdown_blocks(body: str) -> tuple[dict[str, str], ...]:
    blocks: list[dict[str, str]] = []
    for raw_block in body.split("\n\n"):
        cleaned = raw_block.strip()
        if not cleaned:
            continue
        row_type = "heading" if cleaned.startswith("#") else "paragraph"
        blocks.append({"row_type": row_type, "text": cleaned})
    return tuple(blocks)


def _strip_heading(text: str) -> str:
    return re.sub(r"^\s*#+\s*", "", text.strip())


def _read_embedding_model_name(env: Mapping[str, str]) -> str:
    return str(env.get("EMBEDDING_MODEL") or "Qwen3-Embedding-4B")
