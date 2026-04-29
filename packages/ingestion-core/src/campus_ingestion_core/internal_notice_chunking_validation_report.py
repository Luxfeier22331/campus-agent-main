from __future__ import annotations

from collections import Counter

from campus_ingestion_core.internal_notice_chunking_validation_shared import (
    _ATTACHMENT_OCR_LANE,
    _ATTACHMENT_SUBSTANTIVE_CHUNK_UNIT_TYPES,
    _ATTACHMENT_TEXT_LANE,
    _NOTICE_BODY_LANE,
    _TEXTUAL_CHUNK_UNIT_TYPES,
    InternalNoticeChunkingScanResult,
    InternalNoticeChunkingValidationReport,
    InternalNoticeChunkValidationFailure,
    _chunk_unit_type,
    _contains_markup_leak,
    _document_has_stable_title_source,
    _has_attachment_lineage,
    _is_fragmented_notice_body_chunk,
    _is_header_dominant_ocr_chunk,
    _looks_like_noisy_ocr_chunk,
    _resolve_chunk_title,
    _resolve_display_text,
)


def build_internal_notice_chunking_validation_report(
    *,
    scan_result: InternalNoticeChunkingScanResult,
) -> InternalNoticeChunkingValidationReport:
    if scan_result.mode != "full":
        raise ValueError("validation report requires a full internal_notice chunk scan")
    inputs = scan_result.inputs
    read_failures: list[InternalNoticeChunkValidationFailure] = []
    chunk_failures: list[InternalNoticeChunkValidationFailure] = []
    empty_document_ids: list[str] = []
    lane_document_counts: Counter[str] = Counter()
    lane_chunk_counts: Counter[str] = Counter()
    unit_type_counts: Counter[str] = Counter()
    split_reason_counts: Counter[str] = Counter()
    header_mode_counts: Counter[str] = Counter()
    total_units = 0
    total_chunks = 0
    missing_title_chunk_count = 0
    missing_contextualization_count = 0
    missing_lane_metadata_count = 0
    missing_attachment_lineage_count = 0
    attachment_without_body_count = 0
    notice_body_fragmentation_count = 0
    notice_body_token_guardrail_chunk_count = 0
    markup_leak_chunk_count = 0
    replacement_character_chunk_count = 0
    header_dominant_ocr_chunk_count = 0
    noisy_ocr_chunk_count = 0

    for document in scan_result.documents:
        if document.read_failure is not None:
            read_failures.append(document.read_failure)
            continue
        if document.chunk_failure is not None:
            chunk_failures.append(document.chunk_failure)
            continue
        has_stable_title_source = _document_has_stable_title_source(document.rows)
        lane_document_counts[document.lane] += 1
        total_units += len(document.rows)
        total_chunks += len(document.chunks)
        if not document.chunks:
            empty_document_ids.append(document.record.document_id)
        body_chunk_count = sum(
            1
            for chunk in document.chunks
            if _chunk_unit_type(chunk) in _ATTACHMENT_SUBSTANTIVE_CHUNK_UNIT_TYPES
        )
        if document.lane in {_ATTACHMENT_TEXT_LANE, _ATTACHMENT_OCR_LANE} and body_chunk_count == 0:
            attachment_without_body_count += 1
        for chunk in document.chunks:
            lane_chunk_counts[document.lane] += 1
            unit_type = _chunk_unit_type(chunk)
            unit_type_counts[unit_type] += 1
            split_reason_counts[str(chunk.metadata.get("split_reason") or "none")] += 1
            header_mode_counts[str(chunk.metadata.get("header_mode") or "none")] += 1
            if unit_type not in _TEXTUAL_CHUNK_UNIT_TYPES:
                continue
            if not _resolve_chunk_title(chunk) or not has_stable_title_source:
                missing_title_chunk_count += 1
            if not bool(chunk.metadata.get("contextualized_text")):
                missing_contextualization_count += 1
            chunk_lane = str(chunk.metadata.get("internal_notice_lane") or "").strip()
            if not chunk_lane or chunk_lane != document.lane:
                missing_lane_metadata_count += 1
            if document.lane in {
                _ATTACHMENT_TEXT_LANE,
                _ATTACHMENT_OCR_LANE,
            } and not _has_attachment_lineage(chunk):
                missing_attachment_lineage_count += 1
            if _contains_markup_leak(chunk.text) or _contains_markup_leak(
                _resolve_display_text(chunk)
            ):
                markup_leak_chunk_count += 1
            if "\ufffd" in chunk.text or "\ufffd" in _resolve_display_text(chunk):
                replacement_character_chunk_count += 1
            if document.lane == _NOTICE_BODY_LANE and _is_fragmented_notice_body_chunk(
                chunk=chunk,
                document_chunk_count=len(document.chunks),
            ):
                notice_body_fragmentation_count += 1
            if (
                document.lane == _NOTICE_BODY_LANE
                and str(chunk.metadata.get("split_reason") or "") == "token_guardrail"
            ):
                notice_body_token_guardrail_chunk_count += 1
            if document.lane == _ATTACHMENT_OCR_LANE and _is_header_dominant_ocr_chunk(chunk):
                header_dominant_ocr_chunk_count += 1
            if document.lane == _ATTACHMENT_OCR_LANE and _looks_like_noisy_ocr_chunk(
                _resolve_display_text(chunk)
            ):
                noisy_ocr_chunk_count += 1

    passed = not (
        read_failures
        or chunk_failures
        or inputs.missing_manifest_records
        or empty_document_ids
        or missing_title_chunk_count
        or missing_contextualization_count
        or missing_lane_metadata_count
        or missing_attachment_lineage_count
        or attachment_without_body_count
        or notice_body_fragmentation_count
        or markup_leak_chunk_count
        or replacement_character_chunk_count
        or header_dominant_ocr_chunk_count
        or noisy_ocr_chunk_count
    )
    return InternalNoticeChunkingValidationReport(
        passed=passed,
        corpus=inputs.corpus,
        collection=inputs.collection,
        selection_mode=inputs.selection_mode,
        preparation_run_id=inputs.preparation_run_id,
        closeout_run_id=inputs.closeout_run_id,
        registry_record_count=len(inputs.records),
        selected_record_count=len(inputs.selected_records),
        validated_document_count=sum(
            1
            for doc in scan_result.documents
            if doc.read_failure is None and doc.chunk_failure is None
        ),
        total_units=total_units,
        total_chunks=total_chunks,
        lane_document_counts=dict(lane_document_counts),
        lane_chunk_counts=dict(lane_chunk_counts),
        unit_type_counts=dict(unit_type_counts),
        split_reason_counts=dict(split_reason_counts),
        header_mode_counts=dict(header_mode_counts),
        notice_risk_counts=dict(inputs.notice_risk_counts),
        high_risk_notice_count=inputs.high_risk_notice_count,
        read_failures=tuple(read_failures),
        chunk_failures=tuple(chunk_failures),
        missing_manifest_records=inputs.missing_manifest_records,
        empty_document_ids=tuple(sorted(empty_document_ids)),
        missing_title_chunk_count=missing_title_chunk_count,
        missing_contextualization_count=missing_contextualization_count,
        missing_lane_metadata_count=missing_lane_metadata_count,
        missing_attachment_lineage_count=missing_attachment_lineage_count,
        attachment_without_body_count=attachment_without_body_count,
        notice_body_fragmentation_count=notice_body_fragmentation_count,
        notice_body_token_guardrail_chunk_count=notice_body_token_guardrail_chunk_count,
        markup_leak_chunk_count=markup_leak_chunk_count,
        replacement_character_chunk_count=replacement_character_chunk_count,
        header_dominant_ocr_chunk_count=header_dominant_ocr_chunk_count,
        noisy_ocr_chunk_count=noisy_ocr_chunk_count,
    )
