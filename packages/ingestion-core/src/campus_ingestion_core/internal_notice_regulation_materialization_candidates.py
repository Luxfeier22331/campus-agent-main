from __future__ import annotations

import hashlib
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.internal_notice_regulation_projection import _HEADING_RE
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationCandidateArtifactDocument,
)
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    InternalNoticeRegulationPromotionDocumentReport,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import NoticeConsumptionProjectionEntry

_DATE_YEAR_RE = re.compile(r"(19|20)\d{2}")


class InstitutionalRegulationMaterializationObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class CandidateAggregation:
    primary_report: InternalNoticeRegulationPromotionDocumentReport
    primary_candidate: InternalNoticeRegulationCandidateArtifactDocument
    source_record: DocumentRegistryRecord
    duplicate_reports: tuple[InternalNoticeRegulationPromotionDocumentReport, ...]


def build_projection_ready_aggregations(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    source_record_by_lineage: dict[tuple[str, str], DocumentRegistryRecord],
    object_store: InstitutionalRegulationMaterializationObjectStore,
    bucket_derived: str,
) -> list[CandidateAggregation]:
    candidates: list[
        tuple[
            NoticeConsumptionProjectionEntry,
            InternalNoticeRegulationCandidateArtifactDocument,
            DocumentRegistryRecord,
        ]
    ] = []
    for entry in projection_entries:
        source_document_id = entry.source_document_id or entry.source_notice_document_id
        source_record = source_record_by_lineage.get((source_document_id, "source-faithful"))
        if source_record is None:
            continue
        candidate = _build_projection_candidate_document(
            entry=entry,
            source_record=source_record,
            object_store=object_store,
            bucket_derived=bucket_derived,
        )
        candidates.append((entry, candidate, source_record))
    grouped: dict[
        str,
        list[
            tuple[
                NoticeConsumptionProjectionEntry,
                InternalNoticeRegulationCandidateArtifactDocument,
                DocumentRegistryRecord,
            ]
        ],
    ] = {}
    for item in candidates:
        grouped.setdefault(_projection_candidate_group_key(item[1]), []).append(item)
    aggregations: list[CandidateAggregation] = []
    for items in grouped.values():
        ordered = sorted(items, key=lambda item: (item[1].source_document_id, item[1].notice_id))
        primary_entry, primary_candidate, primary_record = ordered[0]
        duplicate_reports = tuple(
            _build_projection_duplicate_report(entry=entry, candidate=candidate)
            for entry, candidate, _record in ordered[1:]
        )
        aggregations.append(
            CandidateAggregation(
                primary_report=_build_projection_duplicate_report(
                    entry=primary_entry,
                    candidate=primary_candidate,
                ),
                primary_candidate=primary_candidate,
                source_record=primary_record,
                duplicate_reports=duplicate_reports,
            )
        )
    return sorted(aggregations, key=lambda item: item.primary_candidate.source_document_id)


def _build_projection_candidate_document(
    *,
    entry: NoticeConsumptionProjectionEntry,
    source_record: DocumentRegistryRecord,
    object_store: InstitutionalRegulationMaterializationObjectStore,
    bucket_derived: str,
) -> InternalNoticeRegulationCandidateArtifactDocument:
    canonical_markdown = object_store.get_bytes(
        bucket=bucket_derived,
        key=source_record.canonical_markdown_object_key or "",
    ).decode("utf-8")
    source_title, body = _split_projection_markdown(canonical_markdown)
    metadata = dict(entry.role_metadata or {})
    title = str(
        metadata.get("regulation_title_normalized") or ""
    ).strip() or _normalize_projection_regulation_title(source_title)
    promotion_body = _extract_projection_promotion_body(body)
    effective_date = (
        str(metadata.get("effective_date") or "").strip()
        or _extract_effective_date(body)
        or _extract_effective_date(promotion_body)
        or None
    )
    revision_signal = str(metadata.get("revision_signal") or "").strip() or (
        "修订" if "修订" in source_title else None
    )
    edition_label = str(metadata.get("regulation_edition_label") or "").strip() or None
    if edition_label is None:
        edition_label = _extract_parenthesized_edition_label(title)
    if edition_label is None and revision_signal == "修订":
        year = _extract_year(effective_date or entry.source_notice_release_time or "")
        if year is not None:
            edition_label = f"{year}年修订"
    work_title = str(
        metadata.get("regulation_work_title") or ""
    ).strip() or _strip_parenthesized_edition_label(title)
    display_title = str(metadata.get("regulation_display_title") or "").strip() or (
        f"{work_title} / {edition_label}" if edition_label else title
    )
    source_kind = (
        "attachment_document"
        if (entry.source_document_id or "") != entry.source_notice_document_id
        else "parent_notice"
    )
    source_attachment_ref_id = (
        entry.source_attachment_ref_ids[0]
        if entry.source_attachment_ref_ids
        else _extract_attachment_ref_id(source_record.document_id)
        if source_kind == "attachment_document"
        else None
    )
    semantic_owner_kind = str(metadata.get("semantic_owner_kind") or "").strip() or (
        "attachment_document" if source_kind == "attachment_document" else "notice_body"
    )
    candidate_id = hashlib.sha256(
        "|".join((entry.unit_id, source_record.version_id, title, promotion_body)).encode("utf-8")
    ).hexdigest()[:16]
    artifact_markdown_path = f"candidates/{_slugify_identifier(title)}--{candidate_id}/canonical.md"
    return InternalNoticeRegulationCandidateArtifactDocument(
        candidate_id=candidate_id,
        source_document_id=source_record.document_id,
        notice_id=entry.source_notice_id,
        site_id=_extract_site_id(entry.source_notice_document_id),
        source_kind=source_kind,
        input_lane=semantic_owner_kind,
        revision_track=source_record.revision_track,
        version_id=source_record.version_id,
        promotion_class=str(metadata.get("promotion_class") or "formal_regulation"),
        document_nature=str(metadata.get("document_nature") or "institutional_regulation"),
        semantic_owner_kind=semantic_owner_kind,
        target_corpus="regulations",
        target_collection="institutional_rules",
        regulation_title_normalized=title,
        issuing_org=str(metadata.get("issuing_org") or "中央民族大学"),
        effective_date=effective_date,
        revision_signal=revision_signal,
        source_notice_release_time=entry.source_notice_release_time,
        source_parent_document_id=entry.source_notice_document_id,
        source_attachment_ref_id=source_attachment_ref_id,
        source_attachment_sha256=(
            str(metadata.get("source_attachment_sha256") or "").strip() or None
        ),
        source_uri=source_record.source_uri,
        entitlement_groups=source_record.entitlement_groups,
        visibility_scope=source_record.visibility_scope,
        visibility_level=source_record.visibility_level,
        embedding_model=source_record.embedding_model,
        is_current=source_record.is_current,
        quality_gates_passed=tuple(
            str(item) for item in metadata.get("quality_gates_passed") or ()
        ),
        reasons=tuple(str(item) for item in metadata.get("reasons") or ()),
        promotion_body=promotion_body,
        artifact_markdown_path=artifact_markdown_path,
        artifact_body_sha256=hashlib.sha256(promotion_body.encode("utf-8")).hexdigest(),
        regulation_work_title=work_title,
        regulation_edition_label=edition_label,
        regulation_display_title=display_title,
        source_title_literal=title,
        source_notice_document_id=entry.source_notice_document_id,
        source_attachment_document_id=source_record.document_id
        if source_kind == "attachment_document"
        else None,
        semantic_owner_document_id=source_record.document_id,
    )


def _build_projection_duplicate_report(
    *,
    entry: NoticeConsumptionProjectionEntry,
    candidate: InternalNoticeRegulationCandidateArtifactDocument,
) -> InternalNoticeRegulationPromotionDocumentReport:
    return InternalNoticeRegulationPromotionDocumentReport(
        document_id=candidate.source_document_id,
        notice_id=entry.source_notice_id,
        site_id=candidate.site_id,
        source_kind=candidate.source_kind,
        source_title=candidate.regulation_title_normalized,
        input_lane=candidate.input_lane,
        revision_track=candidate.revision_track,
        version_id=candidate.version_id,
        action="candidate",
        promotion_class=candidate.promotion_class,
        document_nature=candidate.document_nature,
        semantic_owner_kind=candidate.semantic_owner_kind,
        target_corpus=candidate.target_corpus,
        target_collection=candidate.target_collection,
        regulation_title_normalized=candidate.regulation_title_normalized,
        issuing_org=candidate.issuing_org,
        effective_date=candidate.effective_date,
        revision_signal=candidate.revision_signal,
        source_notice_release_time=candidate.source_notice_release_time,
        source_parent_document_id=candidate.source_parent_document_id,
        source_attachment_ref_id=candidate.source_attachment_ref_id,
        source_attachment_sha256=candidate.source_attachment_sha256,
        duplicate_group_key=None,
        duplicate_primary_document_id=None,
        quality_gates_passed=candidate.quality_gates_passed,
        missing_required_metadata=(),
        reasons=candidate.reasons,
        artifact_key=candidate.artifact_markdown_path,
        regulation_work_title=candidate.regulation_work_title,
        regulation_edition_label=candidate.regulation_edition_label,
        regulation_display_title=candidate.regulation_display_title,
        source_title_literal=candidate.source_title_literal,
    )


def _projection_candidate_group_key(
    candidate: InternalNoticeRegulationCandidateArtifactDocument,
) -> str:
    return hashlib.sha256(
        "|".join((candidate.regulation_title_normalized, candidate.promotion_body)).encode("utf-8")
    ).hexdigest()


def _split_projection_markdown(markdown: str) -> tuple[str, str]:
    lines = [line.strip() for line in markdown.splitlines()]
    title = ""
    body_lines: list[str] = []
    for line in lines:
        if not title and line.startswith("#"):
            title = _HEADING_RE.sub("", line.strip())
            continue
        body_lines.append(line)
    return title, "\n".join(body_lines).strip()


def _normalize_projection_regulation_title(title: str) -> str:
    stripped = _HEADING_RE.sub("", title.strip()).strip()
    match = re.search(r"《(?P<title>[^》]+)》", stripped)
    if match is not None:
        return match.group("title").strip()
    return stripped


def _extract_projection_promotion_body(body: str) -> str:
    lines = [line.strip() for line in body.splitlines()]
    first_article = next(
        (index for index, line in enumerate(lines) if line.startswith("第一条")), 0
    )
    kept = [
        line for line in lines[first_article:] if line and line not in {"特此通知。", "特此通知"}
    ]
    return "\n".join(kept).strip()


def _extract_effective_date(body: str) -> str | None:
    match = re.search(r"(?P<date>20\d{2}年\d{1,2}月\d{1,2}日)", body)
    if match is None:
        return None
    return match.group("date")


def _extract_year(value: str) -> str | None:
    match = _DATE_YEAR_RE.search(value)
    if match is None:
        return None
    return match.group(0)


def _extract_parenthesized_edition_label(title: str) -> str | None:
    match = re.search(r"[（(](?P<label>[^）)]+)[）)]$", title.strip())
    if match is None:
        return None
    label = match.group("label").strip()
    return label or None


def _strip_parenthesized_edition_label(title: str) -> str:
    return re.sub(r"[（(][^）)]+[）)]$", "", title.strip()).strip() or title


def _extract_site_id(source_notice_document_id: str) -> str:
    parts = source_notice_document_id.split(":")
    return parts[1] if len(parts) >= 3 else "muc_internal_portal"


def _extract_attachment_ref_id(source_document_id: str) -> str | None:
    parts = source_document_id.split(":")
    if len(parts) < 4 or parts[0] != "notice_attachment":
        return None
    return parts[-1] or None


def _slugify_identifier(value: str) -> str:
    normalized = value.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "document"


__all__ = [
    "CandidateAggregation",
    "InstitutionalRegulationMaterializationObjectStore",
    "build_projection_ready_aggregations",
]
