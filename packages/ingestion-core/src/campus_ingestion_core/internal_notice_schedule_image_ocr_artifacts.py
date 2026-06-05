from __future__ import annotations

import json
from datetime import UTC, datetime

from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrArtifactKeys,
    ScheduleImageOcrAttempt,
    ScheduleImageOcrAttemptStore,
    ScheduleImageOcrEvidence,
    ScheduleImageOcrProviderResult,
    ScheduleImageOcrSourceArtifactWriteReport,
    ScheduleImageOcrWritableObjectStore,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_payloads import (
    _capture_base_prefix,
    _layout_elements_jsonl,
    _model_slug,
    _provider_response_record,
    _source_ocr_manifest,
)


def build_schedule_image_ocr_artifact_keys(
    *,
    evidence: ScheduleImageOcrEvidence,
    provider: str,
    model: str,
) -> ScheduleImageOcrArtifactKeys:
    base = _capture_base_prefix(evidence.object_key)
    model_slug = _model_slug(provider=provider, model=model)
    return ScheduleImageOcrArtifactKeys(
        provider_response_key=f"{base}/provider/{model_slug}/provider-response.jsonl",
        layout_elements_key=f"{base}/source-truth/layout-elements.jsonl",
        ocr_manifest_key=f"{base}/source-truth/ocr-manifest.json",
    )


def write_schedule_image_ocr_source_artifacts(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    object_store: ScheduleImageOcrWritableObjectStore,
    source_bucket: str,
    attempt_store: ScheduleImageOcrAttemptStore,
    admission_batch_id: str,
    run_id: str,
) -> ScheduleImageOcrSourceArtifactWriteReport:
    keys = build_schedule_image_ocr_artifact_keys(
        evidence=evidence,
        provider=result.provider,
        model=result.model,
    )
    object_store.put_bytes(
        bucket=source_bucket,
        key=keys.provider_response_key,
        data=(
            json.dumps(
                _provider_response_record(evidence=evidence, result=result), ensure_ascii=False
            )
            + "\n"
        ).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=source_bucket,
        key=keys.layout_elements_key,
        data=_layout_elements_jsonl(result).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=source_bucket,
        key=keys.ocr_manifest_key,
        data=json.dumps(
            _source_ocr_manifest(
                evidence=evidence,
                result=result,
                keys=keys,
                admission_batch_id=admission_batch_id,
                run_id=run_id,
            ),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )
    attempt_store.record(
        ScheduleImageOcrAttempt(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            source_notice_id=evidence.notice_id,
            attachment_ref_id=evidence.attachment_ref_id,
            image_index=evidence.image_index,
            source_object_key=evidence.object_key,
            source_sha256=evidence.sha256,
            provider=result.provider,
            model=result.model,
            status="stored",
            confidence=result.confidence,
            provider_response_key=keys.provider_response_key,
            layout_elements_key=keys.layout_elements_key,
            ocr_manifest_key=keys.ocr_manifest_key,
            admission_batch_id=admission_batch_id,
            run_id=run_id,
            created_at=datetime.now(UTC).isoformat(),
        )
    )
    return ScheduleImageOcrSourceArtifactWriteReport(status="stored", keys=keys)
