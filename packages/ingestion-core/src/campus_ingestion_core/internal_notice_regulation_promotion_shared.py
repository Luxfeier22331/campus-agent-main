from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

_INTERNAL_NOTICE_SCOPE = ("campus_notices", "internal_notice")
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
)
_NORMATIVE_HANDBOOK_KEYWORDS = ("手册", "应知应会", "工作手册")
_WRAPPER_NOTICE_PREFIXES = ("关于发布", "关于印发", "关于修订", "关于转发", "关于公布")
_WRAPPER_NOTICE_KEYWORDS = ("通知", "现将", "予以发布", "予以印发", "请遵照执行", "转发")
_WRAPPER_BODY_KEYWORDS = ("现将", "予以发布", "予以印发", "请遵照执行", "转发")
_ATTACHMENT_REFERENCE_KEYWORDS = ("附件：", "附件:", "见附件", "详见附件", "参见附件")
_FILE_RELEASE_REFERENCE_KEYWORDS = (
    "信息门户-文件发布",
    "文件发布",
    "自行下载",
    "下载参照执行",
    "下载后参照执行",
)
_DRAFT_KEYWORDS = ("征求意见稿", "草案", "讨论稿")
_OPERATIONAL_SCHEME_KEYWORDS = ("工作方案", "实施方案", "专项方案")
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
)
_TIME_BOUND_OPERATIONAL_KEYWORDS = (
    "暑假期间",
    "寒假期间",
    "假期期间",
    "正式运营前",
    "正式运营后取消",
    "临时医疗点",
    "临时就医点",
    "暂设立",
)
_NOTICE_ID_PATTERN = re.compile(r"^notice:(?P<site_id>[^:]+):(?P<notice_id>[^:]+)$")
_ATTACHMENT_ID_PATTERN = re.compile(
    r"^notice_attachment:(?P<site_id>[^:]+):(?P<notice_id>[^:]+):(?P<attachment_ref_id>[^:]+)$"
)
_FRONT_MATTER_DELIMITER = "---"
_HEADING_RE = re.compile(r"^\s*#+\s*")
_QUOTE_TITLE_RE = re.compile(r"《([^》]{2,200})》")
_DATE_RE = re.compile(r"(20\d{2}[-/年\.]\d{1,2}[-/月\.]\d{1,2}日?)")
_REVISION_SIGNAL_RE = re.compile(r"(修订|修正|最新版|更新版|20\d{2}版)")
_ISSUING_ORG_RE = re.compile(r"(中央民族大学)")
_DOCUMENT_NUMBER_RE = re.compile(r"^[^\n]{0,40}[〔【\[]\d{4}[〕】\]][^\n]{0,20}号$")
_TEXT_MATCH_NORMALIZE_RE = re.compile(r"[\s《》“”\"'‘’()（）【】\[\]：:、，,。.;；·\-—_<>]")
_TRAILING_PARENTHETICAL_RE = re.compile(
    r"^(?P<work>.+?)\s*[（(](?P<label>[^()（）]{1,40})[)）]\s*$"
)
_TRAILING_BARE_EDITION_RE = re.compile(
    r"^(?P<work>.+?)\s+(?P<label>(?:20\d{2}\s*版|20\d{2}年(?:修订|修正版|更新版)|第?\d+版|最新版|修订版|修正版|更新版))\s*$"
)
_ARTICLE_MARKER_RE = re.compile(r"(^|\n)\s*第[一二三四五六七八九十百千万0-9]+条", re.MULTILINE)
_SECTION_MARKER_RE = re.compile(r"(^|\n)\s*[一二三四五六七八九十]+[、.]", re.MULTILINE)
_SUBSECTION_MARKER_RE = re.compile(r"(^|\n)\s*[（(][一二三四五六七八九十0-9]+[)）]", re.MULTILINE)
_NUMERIC_LIST_MARKER_RE = re.compile(r"(^|\n)\s*[0-9]{1,2}[、.]", re.MULTILINE)
_CIRCLED_LIST_MARKER_RE = re.compile(r"(^|\n)\s*[①②③④⑤⑥⑦⑧⑨⑩]", re.MULTILINE)
_SECTION_HEADING_TITLE_RE = re.compile(
    r"^(?:"
    r"[一二三四五六七八九十百]+[、.．]"
    r"|第[一二三四五六七八九十百千万0-9]+[章节条款项]"
    r"|\d{1,2}[、.．)]"
    r"|[（(][一二三四五六七八九十0-9]+[)）]"
    r")"
)


class InternalNoticePromotionObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class InternalNoticeParentRegulationBodyPreview:
    source_title: str
    regulation_title_normalized: str | None
    cleaned_body: str
    removed_leading_lines: tuple[str, ...]
    removed_trailing_lines: tuple[str, ...]
    wrapper_semantics_removed: bool
    standalone_body_quality_passed: bool
    regulation_structure_retained: bool
    promotable_standalone_body: bool


@dataclass(frozen=True, slots=True)
class InternalNoticePromotionRoutingClassConfig:
    promotion_class: str
    admission_goal: str | None = None
    accepted_revision_tracks: tuple[str, ...] = ()
    required_quality_gates: tuple[str, ...] = ()
    default_action: str | None = None
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class InternalNoticePromotionRoutingConfig:
    schema_version: str
    source_corpus: str
    source_collection: str
    target_corpus: str
    target_collection: str
    document_nature_target_collections: dict[str, str]
    default_action: str
    accepted_input_lanes: tuple[str, ...]
    terminal_outcomes_excluded_from_promotion: tuple[str, ...]
    promotion_classes: dict[str, InternalNoticePromotionRoutingClassConfig]
    required_promotion_metadata: tuple[str, ...]
    identity_rules: dict[str, object]
    notes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationPromotionRequest:
    corpus: str = "campus_notices"
    collection: str = "internal_notice"
    promotion_routing_path: Path | None = None
    notice_ids: tuple[str, ...] = ()
    document_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        from campus_ingestion_core.scope_catalog import assert_known_scope

        if self.promotion_routing_path is not None:
            object.__setattr__(self, "promotion_routing_path", Path(self.promotion_routing_path))
        object.__setattr__(self, "notice_ids", _normalize_id_tuple(self.notice_ids))
        object.__setattr__(self, "document_ids", _normalize_id_tuple(self.document_ids))
        assert_known_scope(self.corpus, self.collection)


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationPromotionDocumentReport:
    document_id: str
    notice_id: str
    site_id: str
    source_kind: str
    source_title: str
    input_lane: str
    revision_track: str
    version_id: str
    action: str
    promotion_class: str
    document_nature: str
    semantic_owner_kind: str
    target_corpus: str
    target_collection: str
    regulation_title_normalized: str | None
    issuing_org: str | None
    effective_date: str | None
    revision_signal: str | None
    source_notice_release_time: str | None
    source_parent_document_id: str | None
    source_attachment_ref_id: str | None
    source_attachment_sha256: str | None
    duplicate_group_key: str | None
    duplicate_primary_document_id: str | None
    quality_gates_passed: tuple[str, ...]
    missing_required_metadata: tuple[str, ...]
    reasons: tuple[str, ...]
    artifact_key: str | None
    owner_source_missing_reason: str | None = None
    read_failure: str | None = None
    regulation_work_title: str | None = None
    regulation_edition_label: str | None = None
    regulation_display_title: str | None = None
    source_title_literal: str | None = None


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationPromotionManifestReport:
    corpus: str
    collection: str
    target_corpus: str
    target_collection: str
    target_serving_stage: str
    registry_record_count: int
    selected_record_count: int
    selected_notice_ids: tuple[str, ...]
    selected_document_ids: tuple[str, ...]
    scanned_document_count: int
    candidate_count: int
    hold_count: int
    manual_review_count: int
    promotion_class_counts: dict[str, int]
    action_counts: dict[str, int]
    lane_counts: dict[str, int]
    documents: tuple[InternalNoticeRegulationPromotionDocumentReport, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationCandidateArtifactRef:
    candidate_id: str
    source_document_id: str
    artifact_markdown_path: str


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationCandidateArtifactDocument:
    candidate_id: str
    source_document_id: str
    notice_id: str
    site_id: str
    source_kind: str
    input_lane: str
    revision_track: str
    version_id: str
    promotion_class: str
    document_nature: str
    semantic_owner_kind: str
    target_corpus: str
    target_collection: str
    regulation_title_normalized: str
    issuing_org: str | None
    effective_date: str | None
    revision_signal: str | None
    source_notice_release_time: str | None
    source_parent_document_id: str | None
    source_attachment_ref_id: str | None
    source_attachment_sha256: str | None
    source_uri: str
    entitlement_groups: tuple[str, ...]
    visibility_scope: str | None
    visibility_level: str
    embedding_model: str
    is_current: bool
    quality_gates_passed: tuple[str, ...]
    reasons: tuple[str, ...]
    promotion_body: str
    artifact_markdown_path: str
    artifact_body_sha256: str
    regulation_work_title: str | None = None
    regulation_edition_label: str | None = None
    regulation_display_title: str | None = None
    source_title_literal: str | None = None
    source_notice_document_id: str | None = None
    source_attachment_document_id: str | None = None
    semantic_owner_document_id: str | None = None


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationCandidateArtifactManifest:
    schema_version: str
    exported_at: str
    corpus: str
    collection: str
    target_corpus: str
    target_collection: str
    source_manifest_candidate_count: int
    exported_candidate_count: int
    selected_notice_ids: tuple[str, ...]
    selected_document_ids: tuple[str, ...]
    documents: tuple[InternalNoticeRegulationCandidateArtifactRef, ...]


def _split_front_matter(markdown: str) -> tuple[dict[str, str], str]:
    normalized = markdown.replace("\r\n", "\n")
    if not normalized.startswith(f"{_FRONT_MATTER_DELIMITER}\n"):
        return {}, normalized
    end = normalized.find(f"\n{_FRONT_MATTER_DELIMITER}\n", len(_FRONT_MATTER_DELIMITER) + 1)
    if end < 0:
        return {}, normalized
    raw_metadata = normalized[len(_FRONT_MATTER_DELIMITER) + 1 : end]
    body = normalized[end + len(_FRONT_MATTER_DELIMITER) + 2 :]
    metadata: dict[str, str] = {}
    for line in raw_metadata.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata, body.lstrip("\n")


def _optional_text(value: object) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _normalize_id_tuple(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def _is_missing_metadata(
    *,
    field_name: str,
    value: object,
    source_kind: str,
) -> bool:
    if source_kind == "parent_notice" and field_name in {
        "source_attachment_ref_id",
        "source_attachment_sha256",
    }:
        return False
    if field_name == "supersedes_candidate_keys":
        return value is None
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


__all__ = [
    "InternalNoticeParentRegulationBodyPreview",
    "InternalNoticePromotionObjectStore",
    "InternalNoticePromotionRoutingClassConfig",
    "InternalNoticePromotionRoutingConfig",
    "InternalNoticeRegulationCandidateArtifactDocument",
    "InternalNoticeRegulationCandidateArtifactManifest",
    "InternalNoticeRegulationCandidateArtifactRef",
    "InternalNoticeRegulationPromotionDocumentReport",
    "InternalNoticeRegulationPromotionManifestReport",
    "InternalNoticeRegulationPromotionRequest",
]
