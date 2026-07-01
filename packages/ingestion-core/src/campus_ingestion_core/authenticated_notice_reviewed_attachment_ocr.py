from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal, Protocol

from campus_ingestion_core.artifacts import (
    CANONICAL_MARKDOWN_FILENAME,
    DOCUMENT_UNITS_FILENAME,
    LAYOUT_ELEMENTS_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.authenticated_notice_attachment_ocr import (
    build_authenticated_notice_ocr_attachment_artifacts,
)
from campus_ingestion_core.authenticated_notice_source_projections_shared import (
    _render_canonical_markdown,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_document_artifact_key

ReviewedAttachmentOcrConfidence = Literal["high", "medium", "low"]
ReviewedAttachmentOcrAdmissionStatus = Literal["admitted", "rejected"]

IMPORT_SOURCE = "authenticated_notice_reviewed_attachment_ocr"
PARSER_VERSION = "authenticated_notice_reviewed_attachment_ocr.v1"
REVISION_TRACK = "source-faithful"
SOURCE_CHANNEL = "authenticated_notice_portal"


class ReviewedAttachmentOcrObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class ReviewedAttachmentOcrEvidence:
    notice_id: str
    notice_title: str
    release_time: str
    organization: str
    attachment_ref_id: str
    filename: str
    mime_type: str
    byte_size: int
    sha256: str
    object_key: str
    source_url: str = ""


@dataclass(frozen=True, slots=True)
class ReviewedAttachmentOcrResult:
    provider: str
    model: str
    confidence: ReviewedAttachmentOcrConfidence
    provider_response_bytes: bytes
    review_notes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ReviewedAttachmentOcrDocument:
    document_id: str
    version_id: str
    content_hash: str
    canonical_markdown_bytes: bytes
    document_units_bytes: bytes
    layout_elements_bytes: bytes
    provider_response_bytes: bytes
    source_notice_id: str
    attachment_ref_id: str
    title: str
    year: str


@dataclass(frozen=True, slots=True)
class ReviewedAttachmentOcrArtifactReport:
    document_id: str
    provider_response_key: str
    layout_elements_key: str
    canonical_markdown_key: str
    document_units_key: str
    content_hash: str


@dataclass(frozen=True, slots=True)
class ReviewedAttachmentOcrAdmissionDecision:
    status: ReviewedAttachmentOcrAdmissionStatus
    reason: str
    document: ReviewedAttachmentOcrDocument | None = None


def admit_reviewed_attachment_ocr_document(
    *,
    evidence: ReviewedAttachmentOcrEvidence,
    result: ReviewedAttachmentOcrResult,
    generated_at: str,
) -> ReviewedAttachmentOcrAdmissionDecision:
    normalized_evidence = _normalize_evidence(evidence)
    if result.confidence == "low":
        return ReviewedAttachmentOcrAdmissionDecision(status="rejected", reason="low_confidence")
    if not result.provider_response_bytes.strip():
        return ReviewedAttachmentOcrAdmissionDecision(
            status="rejected",
            reason="empty_provider_response",
        )
    document_id = _attachment_document_id(normalized_evidence)
    version_id = _version_id(evidence=normalized_evidence, result=result)
    metadata = _document_metadata(
        evidence=normalized_evidence,
        result=result,
        document_id=document_id,
        version_id=version_id,
        generated_at=generated_at,
    )
    title = _document_title(normalized_evidence)
    artifacts = build_authenticated_notice_ocr_attachment_artifacts(
        document_id=document_id,
        version_id=version_id,
        source_uri=_source_uri(normalized_evidence),
        title=title,
        attachment_ref_id=normalized_evidence.attachment_ref_id,
        provider_response_bytes=result.provider_response_bytes,
        metadata=metadata,
    )
    if artifacts is None:
        return ReviewedAttachmentOcrAdmissionDecision(
            status="rejected",
            reason="no_extractable_text",
        )
    canonical = _render_canonical_markdown(
        metadata=metadata,
        body=_canonical_body(title=title, body_markdown=artifacts.body_markdown),
    ).encode("utf-8")
    content_hash = _content_hash(
        canonical_markdown_bytes=canonical,
        document_units_bytes=artifacts.document_units_bytes,
        layout_elements_bytes=artifacts.layout_elements_bytes,
        provider_response_bytes=result.provider_response_bytes,
    )
    return ReviewedAttachmentOcrAdmissionDecision(
        status="admitted",
        reason="reviewed_attachment_ocr_admitted",
        document=ReviewedAttachmentOcrDocument(
            document_id=document_id,
            version_id=version_id,
            content_hash=content_hash,
            canonical_markdown_bytes=canonical,
            document_units_bytes=artifacts.document_units_bytes,
            layout_elements_bytes=artifacts.layout_elements_bytes,
            provider_response_bytes=result.provider_response_bytes,
            source_notice_id=normalized_evidence.notice_id,
            attachment_ref_id=normalized_evidence.attachment_ref_id,
            title=title,
            year=_release_year(normalized_evidence.release_time, generated_at),
        ),
    )


def write_reviewed_attachment_ocr_artifacts(
    *,
    document: ReviewedAttachmentOcrDocument,
    object_store: ReviewedAttachmentOcrObjectStore,
    derived_bucket: str,
) -> ReviewedAttachmentOcrArtifactReport:
    provider_response_key = _document_key(document, PROVIDER_RESPONSE_FILENAME)
    layout_elements_key = _document_key(document, LAYOUT_ELEMENTS_FILENAME)
    canonical_markdown_key = _document_key(document, CANONICAL_MARKDOWN_FILENAME)
    document_units_key = _document_key(document, DOCUMENT_UNITS_FILENAME)
    object_store.put_bytes(
        bucket=derived_bucket,
        key=provider_response_key,
        data=document.provider_response_bytes,
        content_type="application/x-ndjson; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=derived_bucket,
        key=layout_elements_key,
        data=document.layout_elements_bytes,
        content_type="application/x-ndjson; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=derived_bucket,
        key=canonical_markdown_key,
        data=document.canonical_markdown_bytes,
        content_type="text/markdown; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=derived_bucket,
        key=document_units_key,
        data=document.document_units_bytes,
        content_type="application/x-ndjson; charset=utf-8",
    )
    return ReviewedAttachmentOcrArtifactReport(
        document_id=document.document_id,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        canonical_markdown_key=canonical_markdown_key,
        document_units_key=document_units_key,
        content_hash=document.content_hash,
    )


def build_reviewed_attachment_ocr_registry_record(
    *,
    evidence: ReviewedAttachmentOcrEvidence,
    document: ReviewedAttachmentOcrDocument,
    artifact_report: ReviewedAttachmentOcrArtifactReport,
    generated_at: str,
) -> DocumentRegistryRecord:
    normalized_evidence = _normalize_evidence(evidence)
    return DocumentRegistryRecord(
        document_id=document.document_id,
        revision_track=REVISION_TRACK,
        version_id=document.version_id,
        source_uri=_source_uri(normalized_evidence),
        content_hash=artifact_report.content_hash,
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version=PARSER_VERSION,
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp=generated_at,
        parser_version=PARSER_VERSION,
        source_channel=SOURCE_CHANNEL,
        is_current=True,
        published_date=_published_date(normalized_evidence.release_time),
        provenance_status="source_ocr_reviewed",
        document_units_object_key=artifact_report.document_units_key,
        provider_response_object_key=artifact_report.provider_response_key,
        layout_elements_object_key=artifact_report.layout_elements_key,
        canonical_markdown_object_key=artifact_report.canonical_markdown_key,
        processed_object_keys=(
            artifact_report.provider_response_key,
            artifact_report.layout_elements_key,
            artifact_report.canonical_markdown_key,
            artifact_report.document_units_key,
        ),
        import_source=IMPORT_SOURCE,
    )


def _normalize_evidence(evidence: ReviewedAttachmentOcrEvidence) -> ReviewedAttachmentOcrEvidence:
    return ReviewedAttachmentOcrEvidence(
        notice_id=_required_text(evidence.notice_id, "notice_id"),
        notice_title=_text(evidence.notice_title),
        release_time=_text(evidence.release_time),
        organization=_text(evidence.organization),
        attachment_ref_id=_normalize_attachment_ref_id(evidence.attachment_ref_id),
        filename=_text(evidence.filename),
        mime_type=_text(evidence.mime_type) or "application/octet-stream",
        byte_size=int(evidence.byte_size or 0),
        sha256=_required_text(evidence.sha256, "sha256"),
        object_key=_required_text(evidence.object_key, "object_key"),
        source_url=_text(evidence.source_url),
    )


def _attachment_document_id(evidence: ReviewedAttachmentOcrEvidence) -> str:
    return f"notice_attachment:example_internal_portal:{evidence.notice_id}:{evidence.attachment_ref_id}"


def _version_id(
    *,
    evidence: ReviewedAttachmentOcrEvidence,
    result: ReviewedAttachmentOcrResult,
) -> str:
    provider_digest = hashlib.sha256(result.provider_response_bytes).hexdigest()[:16]
    return f"sha256:{evidence.sha256}:reviewed-ocr:{provider_digest}"


def _document_metadata(
    *,
    evidence: ReviewedAttachmentOcrEvidence,
    result: ReviewedAttachmentOcrResult,
    document_id: str,
    version_id: str,
    generated_at: str,
) -> dict[str, object]:
    return {
        "document_id": document_id,
        "version_id": version_id,
        "source_url": _source_uri(evidence),
        "source_id": document_id,
        "projection_name": "authenticated_notice_reviewed_attachment_ocr",
        "derived_from": "authenticated_notice_portal_attachment",
        "parent_document_id": f"notice:example_internal_portal:{evidence.notice_id}",
        "attachment_ref_id": evidence.attachment_ref_id,
        "attachment_kind": "pdf",
        "attachment_role": "attachment",
        "attachment_content_sha256": evidence.sha256,
        "attachment_mime_type": evidence.mime_type,
        "attachment_object_key": evidence.object_key,
        "attachment_filename": evidence.filename,
        "extraction_class": "ocr_required",
        "extraction_policy_version": PARSER_VERSION,
        "ocr_provider": result.provider,
        "ocr_model": result.model,
        "ocr_confidence": result.confidence,
        "review_notes": list(result.review_notes),
        "generated_at": generated_at,
        "visibility_scope": "campus",
        "visibility_level": "restricted",
        "entitlement_groups": ["campus_members"],
        "policy_projection_version": "default",
        "status": "active",
        "published_date": _published_date(evidence.release_time),
    }


def _document_title(evidence: ReviewedAttachmentOcrEvidence) -> str:
    return evidence.filename or evidence.notice_title or evidence.notice_id


def _canonical_body(*, title: str, body_markdown: str) -> str:
    body = body_markdown.strip()
    if body.startswith("# "):
        return body + "\n"
    return f"# {title}\n\n{body}".strip() + "\n"


def _document_key(document: ReviewedAttachmentOcrDocument, filename: str) -> str:
    return build_document_artifact_key(
        corpus="campus_notices",
        collection="internal_notice",
        document_id=document.document_id,
        revision_track=REVISION_TRACK,
        version_id=document.version_id,
        filename=filename,
        title=document.title,
        year=document.year,
    )


def _content_hash(
    *,
    canonical_markdown_bytes: bytes,
    document_units_bytes: bytes,
    layout_elements_bytes: bytes,
    provider_response_bytes: bytes,
) -> str:
    digest = hashlib.sha256()
    for payload in (
        provider_response_bytes,
        layout_elements_bytes,
        canonical_markdown_bytes,
        document_units_bytes,
    ):
        digest.update(payload)
        digest.update(b"\n")
    return "sha256:" + digest.hexdigest()


def _source_uri(evidence: ReviewedAttachmentOcrEvidence) -> str:
    return evidence.source_url or (
        "authenticated_notice_portal://example_internal_portal/notices/"
        f"{evidence.notice_id}/attachments/{evidence.attachment_ref_id}"
    )


def _published_date(release_time: str) -> str | None:
    value = str(release_time or "").strip()
    if not value:
        return None
    return value.split(maxsplit=1)[0]


def _release_year(release_time: str, generated_at: str) -> str:
    for value in (release_time, generated_at):
        year = str(value or "").strip()[:4]
        if year.isdigit():
            return year
    return "unknown"


def _normalize_attachment_ref_id(value: object) -> str:
    text = _text(value)
    match = re.fullmatch(r"attachment-(\d+)", text)
    if match is not None:
        return f"attachment-{int(match.group(1)):04d}"
    return _required_text(text, "attachment_ref_id")


def _required_text(value: object, field_name: str) -> str:
    text = _text(value)
    if not text:
        raise ValueError(f"reviewed attachment OCR evidence missing {field_name}")
    return text


def _text(value: object) -> str:
    return str(value or "").strip()


__all__ = [
    "ReviewedAttachmentOcrAdmissionDecision",
    "ReviewedAttachmentOcrArtifactReport",
    "ReviewedAttachmentOcrDocument",
    "ReviewedAttachmentOcrEvidence",
    "ReviewedAttachmentOcrResult",
    "admit_reviewed_attachment_ocr_document",
    "build_reviewed_attachment_ocr_registry_record",
    "write_reviewed_attachment_ocr_artifacts",
]
