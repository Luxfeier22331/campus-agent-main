from __future__ import annotations

import hashlib
from pathlib import Path

import campus_ingestion_core.internal_notice_regulation_promotion_shared as shared
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.internal_notice_regulation_promotion_heuristics import (
    _clean_title_label,
    extract_internal_notice_parent_regulation_body_preview,
)
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    InternalNoticePromotionObjectStore,
    InternalNoticeRegulationCandidateArtifactDocument,
    InternalNoticeRegulationPromotionDocumentReport,
)
from campus_ingestion_core.models import DocumentRegistryRecord


def _build_candidate_artifact_document(
    *,
    report: InternalNoticeRegulationPromotionDocumentReport,
    record: DocumentRegistryRecord,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    object_store: InternalNoticePromotionObjectStore,
    bucket_derived: str,
) -> InternalNoticeRegulationCandidateArtifactDocument:
    regulation_title = shared._optional_text(report.regulation_title_normalized)
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
    _metadata, body = shared._split_front_matter(source_markdown)
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
    first_line = _clean_title_label(shared._HEADING_RE.sub("", lines[0].strip()))
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
    normalized = shared.re.sub(r"\s+", "-", value.strip())
    normalized = shared.re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "-", normalized)
    normalized = shared.re.sub(r"-{2,}", "-", normalized).strip("-_.")
    return normalized or "candidate"


def _render_candidate_artifact_markdown(
    document: InternalNoticeRegulationCandidateArtifactDocument,
) -> str:
    source_notice_document_id = (
        document.source_notice_document_id or document.source_parent_document_id
    )
    source_attachment_document_id = document.source_attachment_document_id
    semantic_owner_document_id = (
        document.semantic_owner_document_id
        or source_attachment_document_id
        or source_notice_document_id
    )
    lines = [
        shared._FRONT_MATTER_DELIMITER,
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
        shared._FRONT_MATTER_DELIMITER,
        "",
        f"# {document.regulation_title_normalized}",
        "",
    ]
    body = document.promotion_body.strip()
    if body:
        lines.append(body)
        lines.append("")
    return "\n".join(lines)
