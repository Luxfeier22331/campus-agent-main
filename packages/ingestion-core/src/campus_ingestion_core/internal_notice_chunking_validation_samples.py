from __future__ import annotations

import json
import random
from collections.abc import Sequence
from dataclasses import dataclass

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    NOTICE_RISK_LABEL_BODY_ONLY,
    NOTICE_RISK_LABEL_MIXED_HIGH_RISK,
    NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS,
)
from campus_ingestion_core.internal_notice_chunking_validation_shared import (
    _ATTACHMENT_OCR_LANE,
    _ATTACHMENT_OCR_NOISE_UNIT_TYPES,
    _ATTACHMENT_TEXT_LANE,
    _NOTICE_BODY_LANE,
    _TEXTUAL_CHUNK_UNIT_TYPES,
    InternalNoticeScannedDocument,
    _chunk_unit_type,
    _contains_markup_leak,
    _is_fragmented_notice_body_chunk,
    _is_header_dominant_ocr_chunk,
    _looks_like_noisy_ocr_chunk,
    _resolve_display_text,
)


@dataclass(frozen=True, slots=True)
class _InternalNoticeChunkSampleCandidate:
    bucket_name: str
    bucket_reason: str
    document: InternalNoticeScannedDocument


def _pick_sample_documents(
    *,
    documents: Sequence[InternalNoticeScannedDocument],
    sample_seed: int,
) -> tuple[InternalNoticeScannedDocument, ...]:
    return tuple(
        candidate.document
        for candidate in _pick_sample_candidates(documents=documents, sample_seed=sample_seed)
    )


def _pick_sample_candidates(
    *,
    documents: Sequence[InternalNoticeScannedDocument],
    sample_seed: int,
) -> list[_InternalNoticeChunkSampleCandidate]:
    rng = random.Random(sample_seed)
    chosen_ids: set[str] = set()
    picked: list[_InternalNoticeChunkSampleCandidate] = []

    def pick(*, bucket_name: str, bucket_reason: str, predicate) -> None:
        eligible = [
            document
            for document in documents
            if predicate(document) and document.record.document_id not in chosen_ids
        ]
        if not eligible:
            return
        document = rng.choice(eligible)
        chosen_ids.add(document.record.document_id)
        picked.append(
            _InternalNoticeChunkSampleCandidate(
                bucket_name=bucket_name,
                bucket_reason=bucket_reason,
                document=document,
            )
        )

    pick(
        bucket_name="notice-risk-spatial",
        bucket_reason="notice carrying spatial/manual-review attachments",
        predicate=lambda document: (
            document.read_failure is None
            and document.chunk_failure is None
            and _notice_risk_label(document) == NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS
        ),
    )
    pick(
        bucket_name="notice-risk-mixed-high-risk",
        bucket_reason="notice mixing spatial and text/reference attachment lanes",
        predicate=lambda document: (
            document.read_failure is None
            and document.chunk_failure is None
            and _notice_risk_label(document) == NOTICE_RISK_LABEL_MIXED_HIGH_RISK
        ),
    )
    pick(
        bucket_name="notice-body",
        bucket_reason="normal parent notice body sample",
        predicate=lambda document: (
            document.read_failure is None
            and document.chunk_failure is None
            and document.lane == _NOTICE_BODY_LANE
        ),
    )
    pick(
        bucket_name="attachment-text",
        bucket_reason="normal text-extractable attachment sample",
        predicate=lambda document: (
            document.read_failure is None
            and document.chunk_failure is None
            and document.lane == _ATTACHMENT_TEXT_LANE
        ),
    )
    pick(
        bucket_name="attachment-ocr",
        bucket_reason="normal OCR attachment sample",
        predicate=lambda document: (
            document.read_failure is None
            and document.chunk_failure is None
            and document.lane == _ATTACHMENT_OCR_LANE
        ),
    )
    pick(
        bucket_name="notice-body-fragmentation",
        bucket_reason="notice body fragmentation suspect sample",
        predicate=lambda document: any(
            _is_fragmented_notice_body_chunk(chunk=chunk, document_chunk_count=len(document.chunks))
            for chunk in document.chunks
            if _chunk_unit_type(chunk) == "article_body"
        ),
    )
    pick(
        bucket_name="ocr-noise-suspect",
        bucket_reason="OCR noise suspect sample",
        predicate=lambda document: (
            document.lane == _ATTACHMENT_OCR_LANE
            and any(
                _is_header_dominant_ocr_chunk(chunk)
                or _looks_like_noisy_ocr_chunk(_resolve_display_text(chunk))
                for chunk in document.chunks
                if _chunk_unit_type(chunk) in _ATTACHMENT_OCR_NOISE_UNIT_TYPES
            )
        ),
    )
    pick(
        bucket_name="html-leak-or-markup-leak",
        bucket_reason="cleanup failure sample",
        predicate=lambda document: any(
            _contains_markup_leak(chunk.text) or _contains_markup_leak(_resolve_display_text(chunk))
            for chunk in document.chunks
            if _chunk_unit_type(chunk) in _TEXTUAL_CHUNK_UNIT_TYPES
        ),
    )
    return picked


def _render_sample(
    *,
    candidate: _InternalNoticeChunkSampleCandidate,
) -> str:
    document = candidate.document
    notice_risk_profile = document.notice_risk_profile
    row_summary = [
        {
            "chunk_id": row.get("chunk_id"),
            "unit_type": row.get("unit_type"),
            "anchor": row.get("anchor"),
            "metadata": row.get("metadata"),
            "clean_text": row.get("clean_text"),
        }
        for row in document.rows
    ]
    chunk_sections: list[str] = []
    for chunk in document.chunks:
        chunk_sections.append(
            "\n".join(
                [
                    f"### {chunk.chunk_id}",
                    f"- Unit Type: {_chunk_unit_type(chunk)}",
                    f"- Lane: {chunk.metadata.get('internal_notice_lane')}",
                    f"- Header Mode: {chunk.metadata.get('header_mode')}",
                    f"- Split Reason: {chunk.metadata.get('split_reason')}",
                    f"- Final Tokens: {chunk.metadata.get('final_token_count')}",
                    "",
                    "```text",
                    chunk.text,
                    "```",
                ]
            )
        )
    return "\n".join(
        [
            f"# {document.title}",
            "",
            f"- Bucket: {candidate.bucket_name}",
            f"- Bucket Reason: {candidate.bucket_reason}",
            f"- Lane: {document.lane}",
            f"- Notice ID: {document.notice_id}",
            f"- Notice Risk Label: {notice_risk_profile.notice_risk_label if notice_risk_profile is not None else 'unavailable'}",
            f"- Attachment Mix Score: {notice_risk_profile.attachment_mix_score if notice_risk_profile is not None else 'n/a'}",
            f"- Attachment Ref Count: {notice_risk_profile.attachment_ref_count if notice_risk_profile is not None else 'n/a'}",
            f"- Has Text/Table Attachment: {notice_risk_profile.has_text_table_attachment if notice_risk_profile is not None else 'n/a'}",
            f"- Has Spatial Attachment: {notice_risk_profile.has_spatial_attachment if notice_risk_profile is not None else 'n/a'}",
            f"- Has Reference-only Attachment: {notice_risk_profile.has_reference_only_attachment if notice_risk_profile is not None else 'n/a'}",
            f"- Document ID: {document.record.document_id}",
            f"- Source URI: {document.record.source_uri}",
            "",
            "## Source Rows",
            "```json",
            json.dumps(row_summary, ensure_ascii=False, indent=2),
            "```",
            "",
            "## Chunk Text",
            *chunk_sections,
            "",
        ]
    )


def _notice_risk_label(document: InternalNoticeScannedDocument) -> str:
    if document.notice_risk_profile is None:
        return NOTICE_RISK_LABEL_BODY_ONLY
    return document.notice_risk_profile.notice_risk_label
