from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any, Protocol, Sequence

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.collection_config import resolve_collection_truth_config
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.scope_catalog import assert_known_scope
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names


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
_TRAILING_PARENTHETICAL_RE = re.compile(r"^(?P<work>.+?)\s*[（(](?P<label>[^()（）]{1,40})[)）]\s*$")
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


def build_internal_notice_regulation_promotion_manifest(
    *,
    request: InternalNoticeRegulationPromotionRequest,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticePromotionObjectStore | None = None,
) -> InternalNoticeRegulationPromotionManifestReport:
    if (request.corpus, request.collection) != _INTERNAL_NOTICE_SCOPE:
        raise ValueError(
            "internal notice regulation promotion only supports campus_notices/internal_notice"
        )
    source = env if env is not None else dict(os.environ)
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_inventory = source_truth_inventory_store or build_authenticated_notice_source_truth_inventory_store_from_env(
        source
    )
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    routing = load_internal_notice_promotion_routing_config(
        request.promotion_routing_path or read_internal_notice_promotion_routing_path(source)
    )
    target_profile = load_runtime_profile(routing.target_corpus, routing.target_collection)
    bucket_source, bucket_derived = resolve_object_store_bucket_names(source)
    scope_records = _select_latest_scope_records(
        runtime_registry.list_by_scope(request.corpus, request.collection)
    )
    selected_records = _filter_selected_records(
        scope_records,
        notice_ids=request.notice_ids,
        document_ids=request.document_ids,
    )
    notice_ids = tuple(sorted({_extract_notice_id(record.document_id) for record in selected_records}))
    inventory_entries = runtime_inventory.list_by_scope(
        request.corpus,
        request.collection,
        notice_ids=notice_ids,
    )
    inventory_by_notice = {entry.notice_id: entry for entry in inventory_entries}
    attachment_plan_by_ref = _build_attachment_plan_index(inventory_entries)
    materialized_attachment_refs_by_notice = _build_materialized_attachment_ref_index(scope_records)

    reports = tuple(
        _scan_document(
            record=record,
            bucket_derived=bucket_derived,
            object_store=runtime_object_store,
            routing=routing,
            inventory_entry=inventory_by_notice.get(_extract_notice_id(record.document_id)),
            attachment_plan_by_ref=attachment_plan_by_ref,
            bucket_source=bucket_source,
            materialized_attachment_refs_by_notice=materialized_attachment_refs_by_notice,
        )
        for record in selected_records
    )
    reports = _apply_duplicate_resolution(reports)
    reports = _apply_required_quality_gate_enforcement(reports, routing=routing)

    promotion_class_counts: Counter[str] = Counter()
    action_counts: Counter[str] = Counter()
    lane_counts: Counter[str] = Counter()
    candidate_count = 0
    hold_count = 0
    manual_review_count = 0
    for report in reports:
        promotion_class_counts[report.promotion_class] += 1
        action_counts[report.action] += 1
        lane_counts[report.input_lane] += 1
        if report.action == "promote_candidate":
            candidate_count += 1
        elif report.action == "manual_review_required":
            manual_review_count += 1
        else:
            hold_count += 1

    return InternalNoticeRegulationPromotionManifestReport(
        corpus=request.corpus,
        collection=request.collection,
        target_corpus=routing.target_corpus,
        target_collection=routing.target_collection,
        target_serving_stage=target_profile.serving_stage,
        registry_record_count=len(scope_records),
        selected_record_count=len(selected_records),
        selected_notice_ids=notice_ids,
        selected_document_ids=request.document_ids,
        scanned_document_count=len(reports),
        candidate_count=candidate_count,
        hold_count=hold_count,
        manual_review_count=manual_review_count,
        promotion_class_counts=dict(sorted(promotion_class_counts.items())),
        action_counts=dict(sorted(action_counts.items())),
        lane_counts=dict(sorted(lane_counts.items())),
        documents=reports,
    )


def build_internal_notice_regulation_candidate_artifact_manifest(
    *,
    request: InternalNoticeRegulationPromotionRequest,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticePromotionObjectStore | None = None,
) -> tuple[
    InternalNoticeRegulationCandidateArtifactManifest,
    tuple[InternalNoticeRegulationCandidateArtifactDocument, ...],
]:
    if (request.corpus, request.collection) != _INTERNAL_NOTICE_SCOPE:
        raise ValueError(
            "internal notice regulation candidate artifacts only support campus_notices/internal_notice"
        )
    source = env if env is not None else dict(os.environ)
    runtime_registry = registry or build_document_registry_from_env(source)
    runtime_inventory = source_truth_inventory_store or build_authenticated_notice_source_truth_inventory_store_from_env(
        source
    )
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    scope_records = _select_latest_scope_records(
        runtime_registry.list_by_scope(request.corpus, request.collection)
    )
    selected_records = _filter_selected_records(
        scope_records,
        notice_ids=request.notice_ids,
        document_ids=request.document_ids,
    )
    record_by_document_id = {record.document_id: record for record in selected_records}
    notice_ids = tuple(sorted({_extract_notice_id(record.document_id) for record in selected_records}))
    inventory_entries = runtime_inventory.list_by_scope(
        request.corpus,
        request.collection,
        notice_ids=notice_ids,
    )
    inventory_by_notice = {entry.notice_id: entry for entry in inventory_entries}
    bucket_derived = resolve_object_store_bucket_names(source)[1]
    report = build_internal_notice_regulation_promotion_manifest(
        request=request,
        env=source,
        registry=runtime_registry,
        source_truth_inventory_store=runtime_inventory,
        object_store=runtime_object_store,
    )

    candidate_documents: list[InternalNoticeRegulationCandidateArtifactDocument] = []
    candidate_refs: list[InternalNoticeRegulationCandidateArtifactRef] = []
    for document_report in report.documents:
        if document_report.action != "promote_candidate":
            continue
        source_record = record_by_document_id.get(document_report.document_id)
        if source_record is None:
            raise ValueError(
                f"candidate artifact export requires selected registry record: {document_report.document_id}"
            )
        inventory_entry = inventory_by_notice.get(document_report.notice_id)
        candidate_document = _build_candidate_artifact_document(
            report=document_report,
            record=source_record,
            inventory_entry=inventory_entry,
            object_store=runtime_object_store,
            bucket_derived=bucket_derived,
        )
        candidate_documents.append(candidate_document)
        candidate_refs.append(
            InternalNoticeRegulationCandidateArtifactRef(
                candidate_id=candidate_document.candidate_id,
                source_document_id=candidate_document.source_document_id,
                artifact_markdown_path=candidate_document.artifact_markdown_path,
            )
        )

    manifest = InternalNoticeRegulationCandidateArtifactManifest(
        schema_version="internal_notice_promotion_candidate_artifact_v1",
        exported_at=datetime.now(timezone.utc).isoformat(),
        corpus=report.corpus,
        collection=report.collection,
        target_corpus=report.target_corpus,
        target_collection=report.target_collection,
        source_manifest_candidate_count=report.candidate_count,
        exported_candidate_count=len(candidate_documents),
        selected_notice_ids=report.selected_notice_ids,
        selected_document_ids=report.selected_document_ids,
        documents=tuple(candidate_refs),
    )
    return manifest, tuple(candidate_documents)


def export_internal_notice_regulation_candidate_artifacts(
    *,
    output_dir: Path,
    manifest: InternalNoticeRegulationCandidateArtifactManifest,
    documents: Sequence[InternalNoticeRegulationCandidateArtifactDocument],
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "promotion-candidate-manifest.json"
    documents_path = output_dir / "candidate-documents.jsonl"
    for document in documents:
        candidate_markdown_path = output_dir / document.artifact_markdown_path
        candidate_markdown_path.parent.mkdir(parents=True, exist_ok=True)
        candidate_markdown_path.write_text(
            _render_candidate_artifact_markdown(document),
            encoding="utf-8",
        )
    manifest_path.write_text(
        json.dumps(asdict(manifest), ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    with documents_path.open("w", encoding="utf-8") as handle:
        for document in documents:
            handle.write(json.dumps(asdict(document), ensure_ascii=False, sort_keys=True))
            handle.write("\n")
    return manifest_path, documents_path


def export_internal_notice_regulation_promotion_manifest(
    *,
    output_dir: Path,
    report: InternalNoticeRegulationPromotionManifestReport,
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "promotion-manifest.json"
    document_reports_path = output_dir / "document-reports.jsonl"
    payload = asdict(report)
    documents = payload.pop("documents")
    payload["document_report_count"] = len(documents)
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    with document_reports_path.open("w", encoding="utf-8") as handle:
        for document in report.documents:
            handle.write(json.dumps(asdict(document), ensure_ascii=False, sort_keys=True))
            handle.write("\n")
    return manifest_path, document_reports_path


def read_internal_notice_promotion_routing_path(env: dict[str, str] | None = None) -> Path:
    del env
    config = resolve_collection_truth_config(*_INTERNAL_NOTICE_SCOPE)
    path = config.config_root / "promotion-routing.v1.json"
    if not path.exists():
        raise ValueError(f"promotion routing config not found: {path}")
    return path


def load_internal_notice_promotion_routing_config(
    path: Path | str,
) -> InternalNoticePromotionRoutingConfig:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    promotion_classes = {
        key: InternalNoticePromotionRoutingClassConfig(
            promotion_class=key,
            admission_goal=_optional_text(value.get("admission_goal")),
            accepted_revision_tracks=tuple(
                str(item) for item in value.get("accepted_revision_tracks") or ()
            ),
            required_quality_gates=tuple(
                str(item) for item in value.get("required_quality_gates") or ()
            ),
            default_action=_optional_text(value.get("default_action")),
            reason=_optional_text(value.get("reason")),
        )
        for key, value in dict(payload.get("promotion_classes") or {}).items()
    }
    return InternalNoticePromotionRoutingConfig(
        schema_version=str(payload.get("schema_version") or ""),
        source_corpus=str(payload.get("source_corpus") or ""),
        source_collection=str(payload.get("source_collection") or ""),
        target_corpus=str(payload.get("target_corpus") or ""),
        target_collection=str(payload.get("target_collection") or ""),
        document_nature_target_collections={
            str(key).strip(): str(value).strip()
            for key, value in dict(payload.get("document_nature_target_collections") or {}).items()
            if str(key).strip() and str(value).strip()
        },
        default_action=str(payload.get("default_action") or "hold_in_internal_notice"),
        accepted_input_lanes=tuple(
            str(item) for item in payload.get("accepted_input_lanes") or ()
        ),
        terminal_outcomes_excluded_from_promotion=tuple(
            str(item)
            for item in payload.get("terminal_outcomes_excluded_from_promotion") or ()
        ),
        promotion_classes=promotion_classes,
        required_promotion_metadata=tuple(
            str(item) for item in payload.get("required_promotion_metadata") or ()
        ),
        identity_rules=dict(payload.get("identity_rules") or {}),
        notes=tuple(str(item) for item in payload.get("notes") or ()),
    )


def _scan_document(
    *,
    record: DocumentRegistryRecord,
    bucket_derived: str,
    object_store: InternalNoticePromotionObjectStore,
    routing: InternalNoticePromotionRoutingConfig,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    attachment_plan_by_ref: dict[tuple[str, str], dict[str, Any]],
    bucket_source: str,
    materialized_attachment_refs_by_notice: dict[str, frozenset[str]],
) -> InternalNoticeRegulationPromotionDocumentReport:
    site_id, notice_id, source_kind, attachment_ref_id = _parse_document_lineage(record.document_id)
    attachment_plan = (
        attachment_plan_by_ref.get((notice_id, attachment_ref_id))
        if attachment_ref_id is not None
        else None
    )
    input_lane = _resolve_input_lane(source_kind=source_kind, attachment_plan=attachment_plan)
    source_parent_document_id = (
        f"notice:{site_id}:{notice_id}" if source_kind == "attachment_document" else record.document_id
    )
    source_attachment_sha256 = _resolve_source_attachment_sha256(
        notice_id=notice_id,
        attachment_ref_id=attachment_ref_id,
        attachment_plan=attachment_plan,
        inventory_entry=inventory_entry,
        object_store=object_store,
        bucket_source=bucket_source,
    )
    source_notice_release_time = _extract_source_notice_release_time(inventory_entry, record)
    missing_materialized_attachment_refs = _missing_materialized_attachment_refs(
        notice_id=notice_id,
        inventory_entry=inventory_entry,
        materialized_attachment_refs_by_notice=materialized_attachment_refs_by_notice,
    )

    reasons: list[str] = []
    try:
        if record.canonical_markdown_object_key is None:
            raise ValueError("canonical_markdown_object_key is required")
        markdown = object_store.get_bytes(
            bucket=bucket_derived,
            key=record.canonical_markdown_object_key,
        ).decode("utf-8")
    except Exception as exc:
        reasons.append("canonical_text_unavailable")
        return InternalNoticeRegulationPromotionDocumentReport(
            document_id=record.document_id,
            notice_id=notice_id,
            site_id=site_id,
            source_kind=source_kind,
            source_title=record.document_id,
            input_lane=input_lane,
            revision_track=record.revision_track,
            version_id=record.version_id,
            action="manual_review_required",
            promotion_class="manual_promotion_review",
            document_nature="institutional_regulation",
            semantic_owner_kind=_determine_semantic_owner_kind(
                source_kind=source_kind,
                missing_owner_reason=None,
            ),
            target_corpus=routing.target_corpus,
            target_collection=routing.target_collection,
            regulation_title_normalized=None,
            issuing_org=None,
            effective_date=None,
            revision_signal=None,
            source_notice_release_time=source_notice_release_time,
            source_parent_document_id=source_parent_document_id,
            source_attachment_ref_id=attachment_ref_id,
            source_attachment_sha256=source_attachment_sha256,
            duplicate_group_key=None,
            duplicate_primary_document_id=None,
            quality_gates_passed=(),
            missing_required_metadata=tuple(routing.required_promotion_metadata),
            reasons=tuple(reasons),
            artifact_key=record.canonical_markdown_object_key,
            owner_source_missing_reason=None,
            read_failure=str(exc),
        )

    _metadata, body = _split_front_matter(markdown)
    source_title = _extract_source_title(
        body=body,
        record=record,
        inventory_entry=inventory_entry,
        source_kind=source_kind,
    )
    parent_body_preview = (
        extract_internal_notice_parent_regulation_body_preview(markdown, source_title=source_title)
        if source_kind == "parent_notice"
        else None
    )
    promotion_body = (
        body
        if parent_body_preview is None
        else (parent_body_preview.cleaned_body or body)
    )
    combined_text = "\n".join(
        item for item in (source_title, promotion_body, _extract_notice_title(inventory_entry)) if item
    )
    regulation_title_normalized = _normalize_regulation_title(
        source_title=source_title,
        body=promotion_body,
        inventory_entry=inventory_entry,
    )
    (
        regulation_work_title,
        regulation_edition_label,
        regulation_display_title,
        source_title_literal,
    ) = _split_regulation_title_fields(regulation_title_normalized)
    issuing_org = _extract_issuing_org(combined_text)
    effective_date = _optional_text(record.effective_date) or _extract_effective_date(promotion_body)
    revision_signal = _extract_revision_signal(combined_text)
    duplicate_group_key = _build_duplicate_group_key(
        source_attachment_sha256=source_attachment_sha256,
        regulation_title_normalized=regulation_title_normalized,
        promotion_body=promotion_body,
        fallback_content_hash=record.content_hash,
    )
    quality_gates: list[str] = []
    document_nature = _detect_document_nature(
        source_kind=source_kind,
        source_title=source_title,
        body=promotion_body,
        inventory_entry=inventory_entry,
    )
    target_collection = _resolve_target_collection(
        routing=routing,
        document_nature=document_nature,
    )

    if _has_substantive_text(promotion_body):
        quality_gates.append("canonical_text_available")
    else:
        reasons.append("insufficient_body_text")

    if source_kind == "attachment_document":
        if not _looks_like_wrapper_notice(source_title=source_title, body=body):
            quality_gates.append("wrapper_semantics_removed")
        else:
            reasons.append("wrapper_semantics_still_present")
        if _has_standalone_body_quality(body):
            quality_gates.append("standalone_body_quality_passed")
        else:
            reasons.append("body_quality_needs_review")
    elif parent_body_preview is not None:
        if parent_body_preview.wrapper_semantics_removed:
            quality_gates.append("wrapper_semantics_removed")
        else:
            reasons.append("wrapper_semantics_still_present")
        if parent_body_preview.standalone_body_quality_passed:
            quality_gates.append("standalone_body_quality_passed")
        else:
            reasons.append("body_quality_needs_review")
        if inventory_entry is not None and inventory_entry.attachment_document_count > 0:
            reasons.append("wrapper_notice_retained_in_internal_notice")
    elif inventory_entry is not None and inventory_entry.attachment_document_count > 0:
        reasons.append("wrapper_notice_retained_in_internal_notice")

    if _provenance_complete(
        notice_id=notice_id,
        source_parent_document_id=source_parent_document_id,
        source_kind=source_kind,
        source_attachment_ref_id=attachment_ref_id,
        source_attachment_sha256=source_attachment_sha256,
    ):
        quality_gates.append("provenance_complete")
    else:
        reasons.append("provenance_incomplete")

    missing_parent_owner_reason = _detect_missing_parent_owner_reason(
        source_kind=source_kind,
        source_title=source_title,
        original_body=body,
        inventory_entry=inventory_entry,
        regulation_title_normalized=regulation_title_normalized,
    )
    if source_kind == "parent_notice" and missing_parent_owner_reason is not None:
        reasons.append(missing_parent_owner_reason)
        promotion_class, action = ("manual_promotion_review", "manual_review_required")
    elif source_kind == "parent_notice" and missing_materialized_attachment_refs:
        reasons.append("input_incomplete_missing_attachment_docs")
        promotion_class, action = ("manual_promotion_review", "manual_review_required")
    else:
        promotion_class, action = _classify_document(
            source_kind=source_kind,
            input_lane=input_lane,
            source_title=source_title,
            body=promotion_body,
            inventory_entry=inventory_entry,
            routing=routing,
            record=record,
            reasons=reasons,
        )

    if action == "promote_candidate":
        allowed_revision_tracks = routing.promotion_classes[promotion_class].accepted_revision_tracks
        if allowed_revision_tracks and record.revision_track not in allowed_revision_tracks:
            reasons.append("revision_track_not_admitted")
            action = routing.default_action
        if not regulation_title_normalized:
            reasons.append("missing_regulation_title")
            action = "manual_review_required"
            promotion_class = "manual_promotion_review"

    semantic_owner_kind = _determine_semantic_owner_kind(
        source_kind=source_kind,
        missing_owner_reason=missing_parent_owner_reason,
    )
    metadata_fields = {
        "promotion_class": promotion_class,
        "promotion_source_collection": f"{routing.source_corpus}/{routing.source_collection}",
        "semantic_owner_kind": semantic_owner_kind,
        "source_notice_ids": [notice_id],
        "source_parent_document_id": source_parent_document_id,
        "source_attachment_ref_id": attachment_ref_id,
        "source_attachment_sha256": source_attachment_sha256,
        "source_notice_release_time": source_notice_release_time,
        "regulation_title_normalized": regulation_title_normalized,
        "regulation_work_title": regulation_work_title,
        "regulation_edition_label": regulation_edition_label,
        "regulation_display_title": regulation_display_title,
        "source_title_literal": source_title_literal,
        "issuing_org": issuing_org,
        "effective_date": effective_date,
        "revision_signal": revision_signal,
        "supersedes_candidate_keys": [],
    }
    missing_required_metadata = tuple(
        field_name
        for field_name in routing.required_promotion_metadata
        if _is_missing_metadata(
            field_name=field_name,
            value=metadata_fields.get(field_name),
            source_kind=source_kind,
        )
    )
    return InternalNoticeRegulationPromotionDocumentReport(
        document_id=record.document_id,
        notice_id=notice_id,
        site_id=site_id,
        source_kind=source_kind,
        source_title=source_title,
        input_lane=input_lane,
        revision_track=record.revision_track,
        version_id=record.version_id,
        action=action,
        promotion_class=promotion_class,
        document_nature=document_nature,
        semantic_owner_kind=semantic_owner_kind,
        target_corpus=routing.target_corpus,
        target_collection=target_collection,
        regulation_title_normalized=regulation_title_normalized,
        issuing_org=issuing_org,
        effective_date=effective_date,
        revision_signal=revision_signal,
        source_notice_release_time=source_notice_release_time,
        source_parent_document_id=source_parent_document_id,
        source_attachment_ref_id=attachment_ref_id,
        source_attachment_sha256=source_attachment_sha256,
        duplicate_group_key=duplicate_group_key,
        duplicate_primary_document_id=None,
        quality_gates_passed=tuple(sorted(set(quality_gates))),
        missing_required_metadata=missing_required_metadata,
        reasons=tuple(dict.fromkeys(reasons)),
        artifact_key=record.canonical_markdown_object_key,
        owner_source_missing_reason=missing_parent_owner_reason,
        regulation_work_title=regulation_work_title,
        regulation_edition_label=regulation_edition_label,
        regulation_display_title=regulation_display_title,
        source_title_literal=source_title_literal,
    )


def _apply_duplicate_resolution(
    reports: tuple[InternalNoticeRegulationPromotionDocumentReport, ...],
) -> tuple[InternalNoticeRegulationPromotionDocumentReport, ...]:
    candidate_groups: dict[str, list[InternalNoticeRegulationPromotionDocumentReport]] = {}
    for report in reports:
        if report.action != "promote_candidate" or not report.duplicate_group_key:
            continue
        candidate_groups.setdefault(report.duplicate_group_key, []).append(report)

    rewritten: dict[str, InternalNoticeRegulationPromotionDocumentReport] = {}
    for report in reports:
        rewritten[report.document_id] = report

    for group in candidate_groups.values():
        primary = min(group, key=_candidate_sort_key)
        rewritten[primary.document_id] = _replace_document_report(
            primary,
            quality_gates_passed=tuple(
                sorted(set((*primary.quality_gates_passed, "duplicate_check_passed")))
            ),
        )
        for duplicate in group:
            if duplicate.document_id == primary.document_id:
                continue
            rewritten[duplicate.document_id] = _replace_document_report(
                duplicate,
                action="hold_in_internal_notice",
                duplicate_primary_document_id=primary.document_id,
                reasons=tuple(dict.fromkeys((*duplicate.reasons, "duplicate_attachment_or_content"))),
            )

    return tuple(rewritten[report.document_id] for report in reports)


def _apply_required_quality_gate_enforcement(
    reports: tuple[InternalNoticeRegulationPromotionDocumentReport, ...],
    *,
    routing: InternalNoticePromotionRoutingConfig,
) -> tuple[InternalNoticeRegulationPromotionDocumentReport, ...]:
    rewritten: list[InternalNoticeRegulationPromotionDocumentReport] = []
    for report in reports:
        if report.action != "promote_candidate":
            rewritten.append(report)
            continue
        class_config = routing.promotion_classes.get(report.promotion_class)
        if class_config is None or not class_config.required_quality_gates:
            rewritten.append(report)
            continue
        missing_quality_gates = tuple(
            gate
            for gate in class_config.required_quality_gates
            if gate not in report.quality_gates_passed
        )
        if not missing_quality_gates:
            rewritten.append(report)
            continue
        rewritten.append(
            _replace_document_report(
                report,
                action="manual_review_required",
                promotion_class="manual_promotion_review",
                reasons=tuple(
                    dict.fromkeys(
                        (
                            *report.reasons,
                            *(f"missing_quality_gate:{gate}" for gate in missing_quality_gates),
                        )
                    )
                ),
            )
        )
    return tuple(rewritten)


def _replace_document_report(
    report: InternalNoticeRegulationPromotionDocumentReport,
    /,
    **updates: Any,
) -> InternalNoticeRegulationPromotionDocumentReport:
    payload = asdict(report)
    payload.update(updates)
    return InternalNoticeRegulationPromotionDocumentReport(**payload)


def _candidate_sort_key(report: InternalNoticeRegulationPromotionDocumentReport) -> tuple[object, ...]:
    lane_rank = {
        "attachment_text_extractable": 0,
        "attachment_ocr_required": 1,
        "notice_body": 2,
    }.get(report.input_lane, 3)
    revision_rank = {
        "current-effective": 0,
        "source-faithful": 1,
    }.get(report.revision_track, 2)
    return (lane_rank, revision_rank, report.document_id)


def _build_duplicate_group_key(
    *,
    source_attachment_sha256: str | None,
    regulation_title_normalized: str | None,
    promotion_body: str,
    fallback_content_hash: str,
) -> str | None:
    if source_attachment_sha256:
        return source_attachment_sha256
    substantive_body = promotion_body.strip()
    if not substantive_body:
        return fallback_content_hash
    title = (regulation_title_normalized or "").strip()
    digest = hashlib.sha256(
        "\n".join((title, substantive_body)).encode("utf-8")
    ).hexdigest()
    return f"semantic:{digest}"


def _select_latest_scope_records(
    records: Sequence[DocumentRegistryRecord],
) -> tuple[DocumentRegistryRecord, ...]:
    latest_by_key: dict[tuple[str, str], DocumentRegistryRecord] = {}
    for record in records:
        key = (record.document_id, record.revision_track)
        current = latest_by_key.get(key)
        if current is None or _record_sort_key(record) > _record_sort_key(current):
            latest_by_key[key] = record
    return tuple(
        sorted(
            latest_by_key.values(),
            key=lambda record: (record.document_id, record.revision_track),
        )
    )


def _record_sort_key(record: DocumentRegistryRecord) -> tuple[object, ...]:
    return (1 if record.is_current else 0, record.ingestion_timestamp, record.version_id)


def _filter_selected_records(
    records: Sequence[DocumentRegistryRecord],
    *,
    notice_ids: tuple[str, ...],
    document_ids: tuple[str, ...],
) -> tuple[DocumentRegistryRecord, ...]:
    notice_id_set = set(notice_ids)
    document_id_set = set(document_ids)
    if not notice_id_set and not document_id_set:
        return tuple(records)
    selected: list[DocumentRegistryRecord] = []
    for record in records:
        notice_id = _extract_notice_id(record.document_id)
        if (notice_id_set and notice_id in notice_id_set) or (
            document_id_set and record.document_id in document_id_set
        ):
            selected.append(record)
    return tuple(selected)


def _build_attachment_plan_index(
    entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
) -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in entries:
        for raw_plan in entry.parent_snapshot.get("attachment_projection_plans") or ():
            plan = dict(raw_plan)
            attachment_ref_id = _optional_text(plan.get("attachment_ref_id"))
            if attachment_ref_id is None:
                continue
            index[(entry.notice_id, attachment_ref_id)] = plan
    return index


def _resolve_source_attachment_sha256(
    *,
    notice_id: str,
    attachment_ref_id: str | None,
    attachment_plan: dict[str, Any] | None,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    object_store: InternalNoticePromotionObjectStore,
    bucket_source: str,
) -> str | None:
    if attachment_ref_id is None:
        return None
    for value in (
        None if attachment_plan is None else attachment_plan.get("attachment_content_sha256"),
        None if attachment_plan is None else attachment_plan.get("content_sha256"),
    ):
        normalized = _optional_text(value)
        if normalized is not None:
            return normalized
    if inventory_entry is None or not inventory_entry.attachment_refs_key:
        return None
    try:
        payload = object_store.get_bytes(
            bucket=bucket_source,
            key=inventory_entry.attachment_refs_key,
        ).decode("utf-8")
    except Exception:
        return None
    for line in payload.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            row = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if _optional_text(row.get("notice_id")) != notice_id:
            continue
        if _optional_text(row.get("attachment_ref_id")) != attachment_ref_id:
            continue
        normalized = _optional_text(row.get("content_sha256"))
        if normalized is not None:
            return normalized
    return None


def _build_materialized_attachment_ref_index(
    records: Sequence[DocumentRegistryRecord],
) -> dict[str, frozenset[str]]:
    index: dict[str, set[str]] = {}
    for record in records:
        _site_id, notice_id, source_kind, attachment_ref_id = _parse_document_lineage(record.document_id)
        if source_kind != "attachment_document" or attachment_ref_id is None:
            continue
        index.setdefault(notice_id, set()).add(attachment_ref_id)
    return {notice_id: frozenset(refs) for notice_id, refs in index.items()}


def _missing_materialized_attachment_refs(
    *,
    notice_id: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    materialized_attachment_refs_by_notice: dict[str, frozenset[str]],
) -> tuple[str, ...]:
    if inventory_entry is None:
        return ()
    expected_ref_ids = {
        attachment_ref_id
        for attachment_ref_id in (
            _optional_text(plan.get("attachment_ref_id"))
            for plan in inventory_entry.parent_snapshot.get("attachment_projection_plans") or ()
        )
        if attachment_ref_id is not None
        and _attachment_projection_requires_materialized_document(
            inventory_entry.parent_snapshot,
            attachment_ref_id,
        )
    }
    if not expected_ref_ids:
        return ()
    materialized_ref_ids = set(materialized_attachment_refs_by_notice.get(notice_id, frozenset()))
    return tuple(sorted(expected_ref_ids - materialized_ref_ids))


def _attachment_projection_requires_materialized_document(
    parent_snapshot: dict[str, Any],
    attachment_ref_id: str,
) -> bool:
    for raw_plan in parent_snapshot.get("attachment_projection_plans") or ():
        plan = dict(raw_plan)
        if _optional_text(plan.get("attachment_ref_id")) != attachment_ref_id:
            continue
        policy = _optional_text(plan.get("materialization_policy"))
        if policy in {"required_document", "conditional_on_extracted_text"}:
            return True
        classification = _optional_text(plan.get("classification"))
        return classification in {"text_extractable", "ocr_required"}
    return False


def _parse_document_lineage(document_id: str) -> tuple[str, str, str, str | None]:
    attachment_match = _ATTACHMENT_ID_PATTERN.fullmatch(document_id)
    if attachment_match is not None:
        return (
            attachment_match.group("site_id"),
            attachment_match.group("notice_id"),
            "attachment_document",
            attachment_match.group("attachment_ref_id"),
        )
    notice_match = _NOTICE_ID_PATTERN.fullmatch(document_id)
    if notice_match is None:
        raise ValueError(f"unsupported internal notice document id: {document_id}")
    return (
        notice_match.group("site_id"),
        notice_match.group("notice_id"),
        "parent_notice",
        None,
    )


def _extract_notice_id(document_id: str) -> str:
    return _parse_document_lineage(document_id)[1]


def _resolve_input_lane(
    *,
    source_kind: str,
    attachment_plan: dict[str, Any] | None,
) -> str:
    if source_kind == "parent_notice":
        return "notice_body"
    classification = _optional_text(None if attachment_plan is None else attachment_plan.get("classification"))
    if classification == "text_extractable":
        return "attachment_text_extractable"
    if classification == "ocr_required":
        return "attachment_ocr_required"
    return "attachment_unknown"


def _extract_source_notice_release_time(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    record: DocumentRegistryRecord,
) -> str | None:
    if inventory_entry is not None:
        value = _optional_text(inventory_entry.parent_snapshot.get("notice_release_time"))
        if value is not None:
            return value
        record_payload = dict(inventory_entry.parent_snapshot.get("record") or {})
        value = _optional_text(record_payload.get("published_date"))
        if value is not None:
            return value
    return _optional_text(record.published_date)


def _extract_source_title(
    *,
    body: str,
    record: DocumentRegistryRecord,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    source_kind: str,
) -> str:
    if source_kind == "parent_notice":
        title = _extract_notice_title(inventory_entry)
        if title:
            return title
    body_title = _extract_heading_title(body)
    if body_title:
        return body_title
    return record.document_id


def _extract_notice_title(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str | None:
    if inventory_entry is None:
        return None
    return _optional_text(inventory_entry.parent_snapshot.get("notice_title"))


def _normalize_regulation_title(
    *,
    source_title: str,
    body: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str | None:
    heading_title = _extract_heading_title(body)
    notice_title = _extract_notice_title(inventory_entry)
    for candidate in (
        _extract_quoted_title(source_title),
        _extract_standalone_title_candidate(source_title),
        _extract_standalone_title_candidate(heading_title),
        _extract_quoted_title(heading_title),
        _extract_quoted_title(body),
        _extract_quoted_title(notice_title),
        _extract_standalone_title_candidate(notice_title),
    ):
        normalized = _clean_title_label(candidate)
        if normalized:
            return normalized
    return None


def _extract_heading_title(body: str) -> str | None:
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        return _HEADING_RE.sub("", stripped).strip() or None
    return None


def _extract_standalone_title_candidate(value: str | None) -> str | None:
    normalized = _clean_title_label(value)
    if normalized is None:
        return None
    if _looks_like_wrapper_notice(source_title=normalized, body=""):
        return None
    if _looks_like_section_heading_title(normalized):
        return None
    return normalized


def _looks_like_section_heading_title(value: str) -> bool:
    return _SECTION_HEADING_TITLE_RE.match(value.strip()) is not None


def _split_regulation_title_fields(
    title: str | None,
) -> tuple[str | None, str | None, str | None, str | None]:
    source_title_literal = _optional_text(title)
    if source_title_literal is None:
        return (None, None, None, None)
    work_title = source_title_literal
    edition_label: str | None = None
    parenthetical_match = _TRAILING_PARENTHETICAL_RE.match(source_title_literal)
    if parenthetical_match is not None:
        candidate_label = parenthetical_match.group("label").strip()
        candidate_work_title = _optional_text(parenthetical_match.group("work"))
        if candidate_work_title is not None and _looks_like_edition_label(candidate_label):
            work_title = candidate_work_title
            edition_label = candidate_label
    if edition_label is None:
        bare_match = _TRAILING_BARE_EDITION_RE.match(source_title_literal)
        if bare_match is not None:
            candidate_label = bare_match.group("label").strip()
            candidate_work_title = _optional_text(bare_match.group("work"))
            if candidate_work_title is not None:
                work_title = candidate_work_title
                edition_label = candidate_label
    display_title = work_title if edition_label is None else f"{work_title} / {edition_label}"
    return (work_title, edition_label, display_title, source_title_literal)


def _looks_like_edition_label(value: str) -> bool:
    normalized = value.strip()
    if not normalized:
        return False
    return bool(
        re.fullmatch(r"20\d{2}\s*版", normalized)
        or re.fullmatch(r"20\d{2}年(?:修订|修正版|更新版)", normalized)
        or re.fullmatch(r"第?\d+版", normalized)
        or normalized in {"最新版", "修订版", "修正版", "更新版"}
    )


def _build_candidate_artifact_document(
    *,
    report: InternalNoticeRegulationPromotionDocumentReport,
    record: DocumentRegistryRecord,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    object_store: InternalNoticePromotionObjectStore,
    bucket_derived: str,
) -> InternalNoticeRegulationCandidateArtifactDocument:
    regulation_title = _optional_text(report.regulation_title_normalized)
    if regulation_title is None:
        raise ValueError(
            "candidate artifact export requires regulation_title_normalized for "
            f"{report.document_id}"
        )
    source_markdown = object_store.get_bytes(
        bucket=bucket_derived,
        key=record.canonical_markdown_object_key or "",
    ).decode("utf-8")
    promotion_body = _extract_candidate_promotion_body(
        source_markdown=source_markdown,
        report=report,
        inventory_entry=inventory_entry,
    )
    candidate_id = _build_candidate_artifact_id(
        source_document_id=report.document_id,
        version_id=report.version_id,
        regulation_title_normalized=regulation_title,
        source_notice_release_time=report.source_notice_release_time,
        source_attachment_sha256=report.source_attachment_sha256,
    )
    artifact_markdown_path = str(
        Path("candidates")
        / f"{_slugify_path_component(regulation_title)}--{candidate_id}"
        / "canonical.md"
    )
    return InternalNoticeRegulationCandidateArtifactDocument(
        candidate_id=candidate_id,
        source_document_id=report.document_id,
        notice_id=report.notice_id,
        site_id=report.site_id,
        source_kind=report.source_kind,
        input_lane=report.input_lane,
        revision_track=report.revision_track,
        version_id=report.version_id,
        promotion_class=report.promotion_class,
        document_nature=report.document_nature,
        semantic_owner_kind=report.semantic_owner_kind,
        target_corpus=report.target_corpus,
        target_collection=report.target_collection,
        regulation_title_normalized=regulation_title,
        issuing_org=report.issuing_org,
        effective_date=report.effective_date,
        revision_signal=report.revision_signal,
        source_notice_release_time=report.source_notice_release_time,
        source_parent_document_id=report.source_parent_document_id,
        source_attachment_ref_id=report.source_attachment_ref_id,
        source_attachment_sha256=report.source_attachment_sha256,
        source_uri=record.source_uri,
        entitlement_groups=record.entitlement_groups,
        visibility_scope=record.visibility_scope,
        visibility_level=record.visibility_level,
        embedding_model=record.embedding_model,
        is_current=record.is_current,
        quality_gates_passed=report.quality_gates_passed,
        reasons=report.reasons,
        promotion_body=promotion_body,
        artifact_markdown_path=artifact_markdown_path,
        artifact_body_sha256=hashlib.sha256(promotion_body.encode("utf-8")).hexdigest(),
        regulation_work_title=report.regulation_work_title,
        regulation_edition_label=report.regulation_edition_label,
        regulation_display_title=report.regulation_display_title,
        source_title_literal=report.source_title_literal,
        source_notice_document_id=_resolve_source_notice_document_id(report),
        source_attachment_document_id=_resolve_source_attachment_document_id(report),
        semantic_owner_document_id=_resolve_semantic_owner_document_id(report),
    )


def _resolve_source_notice_document_id(
    report: InternalNoticeRegulationPromotionDocumentReport,
) -> str | None:
    if report.source_parent_document_id:
        return report.source_parent_document_id
    if report.source_kind == "parent_notice":
        return report.document_id
    return None


def _resolve_source_attachment_document_id(
    report: InternalNoticeRegulationPromotionDocumentReport,
) -> str | None:
    if report.source_kind == "attachment_document":
        return report.document_id
    return None


def _resolve_semantic_owner_document_id(
    report: InternalNoticeRegulationPromotionDocumentReport,
) -> str | None:
    if report.semantic_owner_kind == "attachment_document":
        return _resolve_source_attachment_document_id(report)
    if report.semantic_owner_kind == "notice_body":
        return _resolve_source_notice_document_id(report)
    return None


def _extract_candidate_promotion_body(
    *,
    source_markdown: str,
    report: InternalNoticeRegulationPromotionDocumentReport,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str:
    _metadata, body = _split_front_matter(source_markdown)
    if report.source_kind == "parent_notice":
        preview = extract_internal_notice_parent_regulation_body_preview(
            source_markdown,
            source_title=report.source_title,
        )
        body = preview.cleaned_body or body
    del inventory_entry
    return _strip_duplicate_title_heading(
        body=body.strip(),
        title=report.regulation_title_normalized or report.source_title,
    )


def _strip_duplicate_title_heading(*, body: str, title: str | None) -> str:
    normalized_title = _clean_title_label(title)
    if normalized_title is None:
        return body
    lines = body.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return ""
    first_line = _clean_title_label(_HEADING_RE.sub("", lines[0].strip()))
    if first_line == normalized_title:
        lines.pop(0)
        while lines and not lines[0].strip():
            lines.pop(0)
    return "\n".join(lines).strip()


def _build_candidate_artifact_id(
    *,
    source_document_id: str,
    version_id: str,
    regulation_title_normalized: str,
    source_notice_release_time: str | None,
    source_attachment_sha256: str | None,
) -> str:
    digest = hashlib.sha256(
        "\n".join(
            (
                source_document_id,
                version_id,
                regulation_title_normalized,
                source_notice_release_time or "",
                source_attachment_sha256 or "",
            )
        ).encode("utf-8")
    ).hexdigest()
    return digest[:16]


def _slugify_path_component(value: str) -> str:
    normalized = re.sub(r"\s+", "-", value.strip())
    normalized = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "-", normalized)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-_.")
    return normalized or "candidate"


def _render_candidate_artifact_markdown(
    document: InternalNoticeRegulationCandidateArtifactDocument,
) -> str:
    source_notice_document_id = document.source_notice_document_id or document.source_parent_document_id
    source_attachment_document_id = document.source_attachment_document_id
    semantic_owner_document_id = (
        document.semantic_owner_document_id
        or source_attachment_document_id
        or source_notice_document_id
    )
    lines = [
        _FRONT_MATTER_DELIMITER,
        "schema_version: internal_notice_promotion_candidate_artifact_v1",
        f"candidate_id: {document.candidate_id}",
        f"source_document_id: {document.source_document_id}",
        f"source_kind: {document.source_kind}",
        f"input_lane: {document.input_lane}",
        f"promotion_class: {document.promotion_class}",
        f"semantic_owner_kind: {document.semantic_owner_kind}",
        f"target_corpus: {document.target_corpus}",
        f"target_collection: {document.target_collection}",
        f"source_notice_release_time: {document.source_notice_release_time or ''}",
        f"source_notice_document_id: {source_notice_document_id or ''}",
        f"source_parent_document_id: {document.source_parent_document_id or ''}",
        f"source_attachment_document_id: {source_attachment_document_id or ''}",
        f"source_attachment_ref_id: {document.source_attachment_ref_id or ''}",
        f"source_attachment_sha256: {document.source_attachment_sha256 or ''}",
        f"semantic_owner_document_id: {semantic_owner_document_id or ''}",
        f"regulation_work_title: {document.regulation_work_title or ''}",
        f"regulation_edition_label: {document.regulation_edition_label or ''}",
        f"regulation_display_title: {document.regulation_display_title or ''}",
        f"source_title_literal: {document.source_title_literal or ''}",
        f"issuing_org: {document.issuing_org or ''}",
        f"effective_date: {document.effective_date or ''}",
        f"revision_signal: {document.revision_signal or ''}",
        f"artifact_body_sha256: {document.artifact_body_sha256}",
        _FRONT_MATTER_DELIMITER,
        "",
        f"# {document.regulation_title_normalized}",
        "",
    ]
    body = document.promotion_body.strip()
    if body:
        lines.append(body)
        lines.append("")
    return "\n".join(lines)

def _extract_quoted_title(value: str | None) -> str | None:
    if value is None:
        return None
    match = _QUOTE_TITLE_RE.search(value)
    if match is None:
        return None
    return match.group(1).strip() or None


def _clean_title_label(value: str | None) -> str | None:
    normalized = _optional_text(value)
    if normalized is None:
        return None
    cleaned = re.sub(r"^附件\s*\d+\s*/\s*", "", normalized).strip()
    cleaned = re.sub(r"\.(docx?|pdf)$", "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned or None


def _extract_issuing_org(text: str) -> str | None:
    match = _ISSUING_ORG_RE.search(text)
    if match is None:
        return None
    return match.group(1)


def _extract_effective_date(text: str) -> str | None:
    match = _DATE_RE.search(text)
    if match is None:
        return None
    return match.group(1)


def _extract_revision_signal(text: str) -> str | None:
    match = _REVISION_SIGNAL_RE.search(text)
    if match is None:
        return None
    return match.group(1)


def extract_internal_notice_parent_regulation_body_preview(
    markdown: str,
    *,
    source_title: str | None = None,
) -> InternalNoticeParentRegulationBodyPreview:
    _metadata, body = _split_front_matter(markdown)
    source_title_resolved = _clean_title_label(source_title) or _extract_heading_title(body) or ""
    regulation_title_normalized = _normalize_regulation_title(
        source_title=source_title_resolved,
        body=body,
        inventory_entry=None,
    )
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    if lines and _clean_title_label(_HEADING_RE.sub("", lines[0])) == _clean_title_label(source_title_resolved):
        lines = lines[1:]

    removed_leading_lines: list[str] = []
    removed_trailing_lines: list[str] = []

    while lines and _is_wrapper_leading_line(lines[0], regulation_title_normalized=regulation_title_normalized):
        removed_leading_lines.append(lines.pop(0))

    while lines and _is_document_number_line(lines[0]):
        removed_leading_lines.append(lines.pop(0))

    while lines and _is_wrapper_leading_line(lines[0], regulation_title_normalized=regulation_title_normalized):
        removed_leading_lines.append(lines.pop(0))

    while lines and _is_wrapper_trailing_line(lines[-1]):
        removed_trailing_lines.insert(0, lines.pop())

    cleaned_body = "\n\n".join(lines).strip()
    wrapper_semantics_removed = not _looks_like_wrapper_body(cleaned_body)
    standalone_body_quality_passed = _has_standalone_body_quality(cleaned_body)
    regulation_structure_retained = _has_regulation_body_structure(cleaned_body)
    return InternalNoticeParentRegulationBodyPreview(
        source_title=source_title_resolved,
        regulation_title_normalized=regulation_title_normalized,
        cleaned_body=cleaned_body,
        removed_leading_lines=tuple(removed_leading_lines),
        removed_trailing_lines=tuple(removed_trailing_lines),
        wrapper_semantics_removed=wrapper_semantics_removed,
        standalone_body_quality_passed=standalone_body_quality_passed,
        regulation_structure_retained=regulation_structure_retained,
        promotable_standalone_body=(
            wrapper_semantics_removed
            and standalone_body_quality_passed
            and regulation_structure_retained
        ),
    )


def _is_wrapper_leading_line(
    line: str,
    *,
    regulation_title_normalized: str | None,
) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    if normalized.endswith(("：", ":")):
        return True
    if any(keyword in normalized for keyword in _WRAPPER_NOTICE_KEYWORDS):
        return True
    if "我校于" in normalized and any(keyword in normalized for keyword in ("印发", "发布", "修订")):
        return True
    if regulation_title_normalized and regulation_title_normalized in normalized and any(
        keyword in normalized for keyword in ("印发", "发布", "修订", "通知如下")
    ):
        return True
    return False


def _is_wrapper_trailing_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    if normalized.startswith("附件"):
        return True
    if normalized.startswith("特此通知"):
        return True
    if _DATE_RE.fullmatch(normalized) is not None:
        return True
    if len(normalized) <= 24 and any(
        keyword in normalized for keyword in ("中央民族大学", "处", "部", "学院", "中心", "办公室")
    ):
        return True
    return False


def _is_document_number_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    return _DOCUMENT_NUMBER_RE.fullmatch(normalized) is not None


def _classify_document(
    *,
    source_kind: str,
    input_lane: str,
    source_title: str,
    body: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    routing: InternalNoticePromotionRoutingConfig,
    record: DocumentRegistryRecord,
    reasons: list[str],
) -> tuple[str, str]:
    combined_text = "\n".join(item for item in (source_title, body) if item)
    if source_kind == "parent_notice":
        title_signal_text = "\n".join(
            item
            for item in (
                source_title,
                _extract_notice_title(inventory_entry),
            )
            if item
        )
        if _looks_like_draft_document(combined_text):
            reasons.append("draft_signal_detected")
            return ("manual_promotion_review", "manual_review_required")
        if _looks_like_annual_cycle_or_program_rule(combined_text):
            reasons.append("annual_cycle_or_program_rule_detected")
        if _looks_like_operational_scheme(combined_text):
            reasons.append("operational_scheme_signal_detected")
            return ("manual_promotion_review", "manual_review_required")
        if _looks_like_time_bound_operational_rule(combined_text):
            reasons.append("time_bound_operational_rule_detected")
        has_promotable_attachment = (
            inventory_entry is not None and inventory_entry.attachment_document_count > 0
        )
        body_is_standalone = _has_standalone_body_quality(body)
        body_has_regulation_structure = _has_regulation_body_structure(body)
        body_is_promotable_parent_regulation = body_has_regulation_structure and _has_substantive_text(
            body
        )
        if body_is_promotable_parent_regulation and _looks_like_formal_regulation(title_signal_text):
            if has_promotable_attachment:
                reasons.append("wrapper_notice_retained_in_internal_notice")
                return ("wrapper_notice_only", routing.default_action)
            return ("formal_regulation", "promote_candidate")
        if body_is_promotable_parent_regulation and _looks_like_normative_handbook(
            title_signal_text
        ):
            if has_promotable_attachment:
                reasons.append("wrapper_notice_retained_in_internal_notice")
                return ("wrapper_notice_only", routing.default_action)
            return ("normative_handbook", "promote_candidate")
        if _looks_like_wrapper_notice(source_title=source_title, body=body) or has_promotable_attachment:
            return ("wrapper_notice_only", routing.default_action)
        if _looks_like_formal_regulation(title_signal_text) or _looks_like_normative_handbook(
            title_signal_text
        ):
            reasons.append("regulation_like_parent_body_needs_review")
            return ("manual_promotion_review", "manual_review_required")
        return ("wrapper_notice_only", routing.default_action)

    if input_lane not in set(routing.accepted_input_lanes):
        reasons.append("input_lane_not_admitted")
        return ("manual_promotion_review", "manual_review_required")
    if _looks_like_draft_document(combined_text):
        reasons.append("draft_signal_detected")
        return ("manual_promotion_review", "manual_review_required")
    if _looks_like_annual_cycle_or_program_rule(combined_text):
        reasons.append("annual_cycle_or_program_rule_detected")
    if _looks_like_operational_scheme(combined_text):
        reasons.append("operational_scheme_signal_detected")
        return ("manual_promotion_review", "manual_review_required")
    if _looks_like_time_bound_operational_rule(combined_text):
        reasons.append("time_bound_operational_rule_detected")
    if _looks_like_formal_regulation(combined_text):
        return ("formal_regulation", "promote_candidate")
    if _looks_like_normative_handbook(combined_text):
        return ("normative_handbook", "promote_candidate")
    reasons.append("promotion_class_ambiguous")
    if record.revision_track not in {"source-faithful", "current-effective"}:
        reasons.append("unsupported_revision_track")
    return ("manual_promotion_review", "manual_review_required")


def _looks_like_formal_regulation(text: str) -> bool:
    return any(keyword in text for keyword in _FORMAL_REGULATION_KEYWORDS)


def _looks_like_normative_handbook(text: str) -> bool:
    return any(keyword in text for keyword in _NORMATIVE_HANDBOOK_KEYWORDS)


def _looks_like_wrapper_notice(*, source_title: str, body: str) -> bool:
    combined = "\n".join((source_title, body))
    if any(source_title.startswith(prefix) for prefix in _WRAPPER_NOTICE_PREFIXES):
        return True
    if "通知" in source_title and _QUOTE_TITLE_RE.search(source_title):
        return True
    return any(keyword in combined for keyword in _WRAPPER_NOTICE_KEYWORDS)


def _looks_like_wrapper_body(body: str) -> bool:
    return any(keyword in body for keyword in _WRAPPER_BODY_KEYWORDS)


def _determine_semantic_owner_kind(
    *,
    source_kind: str,
    missing_owner_reason: str | None,
) -> str:
    if missing_owner_reason == "attachment_backed_regulation_body_missing":
        return "attachment_document"
    if missing_owner_reason == "file_release_backed_regulation_body_missing":
        return "file_release_document"
    if source_kind == "attachment_document":
        return "attachment_document"
    return "notice_body"


def _detect_missing_parent_owner_reason(
    *,
    source_kind: str,
    source_title: str,
    original_body: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    regulation_title_normalized: str | None,
) -> str | None:
    if source_kind != "parent_notice":
        return None
    if inventory_entry is not None and (
        inventory_entry.attachment_ref_count > 0 or inventory_entry.attachment_document_count > 0
    ):
        return None
    expectation_reason = _detect_missing_parent_owner_reason_from_expectations(
        parent_snapshot=None if inventory_entry is None else inventory_entry.parent_snapshot,
        regulation_title_normalized=regulation_title_normalized,
    )
    if expectation_reason is not None:
        return expectation_reason
    if _body_references_regulation_attachment(
        body=original_body,
        regulation_title_normalized=regulation_title_normalized,
    ):
        return "attachment_backed_regulation_body_missing"
    if _looks_like_wrapper_notice(source_title=source_title, body=original_body) and (
        _looks_like_file_release_reference(original_body)
    ):
        return "file_release_backed_regulation_body_missing"
    return None


def _detect_missing_parent_owner_reason_from_expectations(
    *,
    parent_snapshot: dict[str, Any] | None,
    regulation_title_normalized: str | None,
) -> str | None:
    attachment_expected = False
    file_release_expected = False
    normalized_regulation_title = _normalize_text_match(regulation_title_normalized)
    for raw_expectation in (parent_snapshot or {}).get("owner_expectations") or ():
        if not isinstance(raw_expectation, dict):
            continue
        owner_kind = _optional_text(raw_expectation.get("owner_kind"))
        if owner_kind not in {"attachment_document", "file_release_document"}:
            continue
        owner_title_hint = _optional_text(raw_expectation.get("owner_title_hint"))
        normalized_owner_title_hint = _normalize_text_match(owner_title_hint)
        if (
            normalized_regulation_title
            and normalized_owner_title_hint
            and normalized_regulation_title not in normalized_owner_title_hint
            and normalized_owner_title_hint not in normalized_regulation_title
        ):
            continue
        if owner_kind == "attachment_document":
            attachment_expected = True
            continue
        if owner_kind == "file_release_document":
            file_release_expected = True
    if attachment_expected:
        return "attachment_backed_regulation_body_missing"
    if file_release_expected:
        return "file_release_backed_regulation_body_missing"
    return None


def _body_references_regulation_attachment(
    *,
    body: str,
    regulation_title_normalized: str | None,
) -> bool:
    normalized_title = _normalize_text_match(regulation_title_normalized)
    if not normalized_title:
        return False
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or "附件" not in stripped:
            continue
        if not any(keyword in stripped for keyword in _ATTACHMENT_REFERENCE_KEYWORDS):
            continue
        if normalized_title in _normalize_text_match(stripped):
            return True
    return False


def _looks_like_file_release_reference(body: str) -> bool:
    return any(keyword in body for keyword in _FILE_RELEASE_REFERENCE_KEYWORDS)


def _normalize_text_match(value: str | None) -> str:
    if value is None:
        return ""
    return _TEXT_MATCH_NORMALIZE_RE.sub("", value)


def _looks_like_draft_document(text: str) -> bool:
    return any(keyword in text for keyword in _DRAFT_KEYWORDS)


def _resolve_target_collection(
    *,
    routing: InternalNoticePromotionRoutingConfig,
    document_nature: str,
) -> str:
    return (
        routing.document_nature_target_collections.get(document_nature)
        or routing.target_collection
    )


def _detect_document_nature(
    *,
    source_kind: str,
    source_title: str,
    body: str,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str:
    combined_text = "\n".join(item for item in (source_title, body) if item)
    has_promotable_attachment = (
        source_kind == "parent_notice"
        and inventory_entry is not None
        and inventory_entry.attachment_document_count > 0
    )
    body_is_standalone_parent_regulation = _has_regulation_body_structure(body) and _has_substantive_text(
        body
    )
    if has_promotable_attachment:
        return "wrapper_notice"
    if _looks_like_wrapper_notice(source_title=source_title, body=body) and not body_is_standalone_parent_regulation:
        return "wrapper_notice"
    if _looks_like_annual_cycle_or_program_rule(combined_text):
        return "annual_cycle_rule"
    if _looks_like_time_bound_operational_rule(combined_text):
        return "time_bound_operational_rule"
    return "institutional_regulation"


def _looks_like_operational_scheme(text: str) -> bool:
    return any(keyword in text for keyword in _OPERATIONAL_SCHEME_KEYWORDS)


def _looks_like_annual_cycle_or_program_rule(text: str) -> bool:
    return any(keyword in text for keyword in _ANNUAL_CYCLE_OR_PROGRAM_RULE_KEYWORDS)


def _looks_like_time_bound_operational_rule(text: str) -> bool:
    return any(keyword in text for keyword in _TIME_BOUND_OPERATIONAL_KEYWORDS)


def _provenance_complete(
    *,
    notice_id: str,
    source_parent_document_id: str | None,
    source_kind: str,
    source_attachment_ref_id: str | None,
    source_attachment_sha256: str | None,
) -> bool:
    if not notice_id or not source_parent_document_id:
        return False
    if source_kind != "attachment_document":
        return True
    return bool(source_attachment_ref_id and source_attachment_sha256)


def _has_substantive_text(body: str) -> bool:
    return len(re.sub(r"\s+", "", body)) >= 20


def _has_standalone_body_quality(body: str) -> bool:
    return len(re.sub(r"\s+", "", body)) >= 48


def _has_regulation_body_structure(body: str) -> bool:
    return any(
        pattern.search(body) is not None
        for pattern in (
            _ARTICLE_MARKER_RE,
            _SECTION_MARKER_RE,
            _SUBSECTION_MARKER_RE,
            _NUMERIC_LIST_MARKER_RE,
            _CIRCLED_LIST_MARKER_RE,
        )
    )


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
    "InternalNoticeRegulationCandidateArtifactDocument",
    "InternalNoticeRegulationCandidateArtifactManifest",
    "InternalNoticeRegulationCandidateArtifactRef",
    "InternalNoticeParentRegulationBodyPreview",
    "InternalNoticePromotionRoutingClassConfig",
    "InternalNoticePromotionRoutingConfig",
    "InternalNoticeRegulationPromotionDocumentReport",
    "InternalNoticeRegulationPromotionManifestReport",
    "InternalNoticeRegulationPromotionRequest",
    "build_internal_notice_regulation_candidate_artifact_manifest",
    "build_internal_notice_regulation_promotion_manifest",
    "extract_internal_notice_parent_regulation_body_preview",
    "export_internal_notice_regulation_candidate_artifacts",
    "export_internal_notice_regulation_promotion_manifest",
    "load_internal_notice_promotion_routing_config",
    "read_internal_notice_promotion_routing_path",
]
