from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrArtifactKeys,
    ScheduleImageOcrEvidence,
    ScheduleImageOcrProviderResult,
)


def _dry_run_manifest(evidence: ScheduleImageOcrEvidence, *, run_id: str) -> dict[str, Any]:
    payload = asdict(evidence)
    payload["run_id"] = run_id
    payload["source_corpus"] = "campus_notices"
    payload["source_collection"] = "internal_notice"
    return payload


def _provider_result_payload(result: ScheduleImageOcrProviderResult) -> dict[str, Any]:
    return {
        "provider": result.provider,
        "model": result.model,
        "confidence": result.confidence,
        "extracted_text": result.extracted_text,
        "tables": _tables_payload(result.tables),
        "layout_elements": [dict(item) for item in result.layout_elements],
        "raw_response": result.raw_response,
    }


def _provider_response_record(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
) -> dict[str, Any]:
    return {
        "notice_id": evidence.notice_id,
        "attachment_ref_id": evidence.attachment_ref_id,
        "image_index": evidence.image_index,
        "source_object_key": evidence.object_key,
        "source_sha256": evidence.sha256,
        "provider": result.provider,
        "model": result.model,
        "confidence": result.confidence,
        "raw_response": result.raw_response,
        "extracted_text": result.extracted_text,
        "tables": _tables_payload(result.tables),
    }


def _source_ocr_manifest(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    keys: ScheduleImageOcrArtifactKeys,
    admission_batch_id: str,
    run_id: str,
) -> dict[str, Any]:
    return {
        "schema_version": "authenticated_notice_schedule_image_ocr_manifest.v1",
        "source_corpus": "campus_notices",
        "source_collection": "internal_notice",
        "source_notice_id": evidence.notice_id,
        "attachment_ref_id": evidence.attachment_ref_id,
        "image_index": evidence.image_index,
        "source_object_key": evidence.object_key,
        "source_sha256": evidence.sha256,
        "provider": result.provider,
        "model": result.model,
        "confidence": result.confidence,
        "provider_response_key": keys.provider_response_key,
        "layout_elements_key": keys.layout_elements_key,
        "ocr_manifest_key": keys.ocr_manifest_key,
        "admission_batch_id": admission_batch_id,
        "run_id": run_id,
    }


def _layout_elements_jsonl(result: ScheduleImageOcrProviderResult) -> str:
    rows = [dict(item) for item in result.layout_elements]
    if not rows:
        rows = [
            {
                "type": "text",
                "text": result.extracted_text,
                "confidence": result.confidence,
            }
        ]
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)


def _document_units_jsonl(rows: Sequence[Mapping[str, Any]]) -> str:
    return "".join(json.dumps(dict(row), ensure_ascii=False) + "\n" for row in rows)


def _tables_payload(
    tables: Sequence[Sequence[Sequence[str]]],
) -> list[list[list[str]]]:
    return [[[str(cell or "").strip() for cell in row] for row in table] for table in tables]


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _capture_base_prefix(object_key: str) -> str:
    marker = "/capture/"
    if marker not in object_key:
        raise ValueError(f"schedule image OCR object key is not a capture key: {object_key}")
    return object_key.split(marker, maxsplit=1)[0]


def _model_slug(*, provider: str, model: str) -> str:
    if not provider.strip():
        raise ValueError("schedule image OCR provider is required")
    if not model.strip():
        raise ValueError("schedule image OCR model is required")
    raw = f"{provider}__{model}"
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", raw.strip()).strip("-").lower()
    if not slug:
        raise ValueError("schedule image OCR provider/model slug is empty")
    return slug
