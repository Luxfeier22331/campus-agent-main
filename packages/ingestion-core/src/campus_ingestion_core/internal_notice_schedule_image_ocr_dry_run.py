from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.internal_notice_schedule_image_ocr_classification import (
    classify_schedule_image_ocr_result,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrDryRunItemReport,
    ScheduleImageOcrDryRunReport,
    ScheduleImageOcrEvidence,
    ScheduleImageOcrProvider,
    ScheduleImageOcrProviderRequest,
    ScheduleImageOcrSourceObjectStore,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_payloads import (
    _dry_run_manifest,
    _provider_result_payload,
    _tables_payload,
    _write_json,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_scalars import _verify_sha256


def run_schedule_image_ocr_dry_run(
    *,
    evidence_entries: Sequence[ScheduleImageOcrEvidence],
    object_store: ScheduleImageOcrSourceObjectStore,
    source_bucket: str,
    provider: ScheduleImageOcrProvider,
    output_dir: Path,
    run_id: str,
) -> ScheduleImageOcrDryRunReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    item_reports: list[ScheduleImageOcrDryRunItemReport] = []
    notices = {entry.notice_id for entry in evidence_entries}
    for evidence in evidence_entries:
        try:
            image_bytes = object_store.get_bytes(bucket=source_bucket, key=evidence.object_key)
            _verify_sha256(evidence=evidence, image_bytes=image_bytes)
            result = provider.process(
                ScheduleImageOcrProviderRequest(
                    evidence=evidence,
                    image_bytes=image_bytes,
                )
            )
            image_dir = output_dir / evidence.notice_id / f"image-{evidence.image_index}"
            image_dir.mkdir(parents=True, exist_ok=True)
            _write_json(image_dir / "manifest.json", _dry_run_manifest(evidence, run_id=run_id))
            _write_json(image_dir / "ocr-result.json", _provider_result_payload(result))
            (image_dir / "text.txt").write_text(result.extracted_text, encoding="utf-8")
            _write_json(image_dir / "tables.json", {"tables": _tables_payload(result.tables)})
            classification = classify_schedule_image_ocr_result(evidence=evidence, result=result)
            item_reports.append(
                ScheduleImageOcrDryRunItemReport(
                    notice_id=evidence.notice_id,
                    attachment_ref_id=evidence.attachment_ref_id,
                    image_index=evidence.image_index,
                    status="processed",
                    classification=classification,
                )
            )
        except Exception as exc:
            item_reports.append(
                ScheduleImageOcrDryRunItemReport(
                    notice_id=evidence.notice_id,
                    attachment_ref_id=evidence.attachment_ref_id,
                    image_index=evidence.image_index,
                    status="failed",
                    classification="failed",
                    reason=str(exc),
                )
            )
    failed_count = sum(1 for item in item_reports if item.status == "failed")
    return ScheduleImageOcrDryRunReport(
        run_id=run_id,
        notice_count=len(notices),
        image_count=len(evidence_entries),
        processed_count=len(item_reports) - failed_count,
        failed_count=failed_count,
        item_reports=tuple(item_reports),
    )
