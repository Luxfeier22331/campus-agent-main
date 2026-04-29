from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Literal

from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    load_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    ScheduleImageOcrAdmissionDecision,
    ScheduleImageOcrAttemptStore,
    ScheduleImageOcrEvidence,
    ScheduleImageOcrProviderResult,
    ScheduleImageOcrWritableObjectStore,
    admit_schedule_image_ocr_child_document,
    build_schedule_image_ocr_attempt_store_from_env,
    build_schedule_image_ocr_child_document_registry_record,
    normalize_schedule_image_ocr_attachment_ref_id,
    write_schedule_image_ocr_child_document_artifacts,
    write_schedule_image_ocr_source_artifacts,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
)
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

ScheduleImageOcrAdmitMode = Literal["plan", "admit_and_materialize"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Admit selected schedule image OCR dry-run results as attachment child documents.",
    )
    parser.add_argument("--ocr-output-dir", required=True)
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--consumer-admission-manifest-path", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--generated-at", required=True)
    parser.add_argument("--source-bucket")
    parser.add_argument("--derived-bucket")
    parser.add_argument(
        "--mode",
        default="plan",
        choices=("plan", "admit-and-materialize", "admit_and_materialize"),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    mode = _normalize_mode(args.mode)
    result = admit_schedule_image_ocr_results(
        ocr_output_dir=Path(args.ocr_output_dir),
        notice_ids=tuple(args.notice_ids),
        consumer_admission_manifest_path=Path(args.consumer_admission_manifest_path),
        run_id=args.run_id,
        generated_at=args.generated_at,
        source_bucket=args.source_bucket or settings.bucket_source,
        derived_bucket=args.derived_bucket or settings.bucket_derived,
        mode=mode,
        object_store=S3ObjectStoreAdmin(settings) if mode == "admit_and_materialize" else None,
        registry=build_document_registry_from_env() if mode == "admit_and_materialize" else None,
        attempt_store=(
            build_schedule_image_ocr_attempt_store_from_env(prefer_operator=True)
            if mode == "admit_and_materialize"
            else None
        ),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


def admit_schedule_image_ocr_results(
    *,
    ocr_output_dir: Path,
    notice_ids: Sequence[str],
    consumer_admission_manifest_path: Path | None,
    run_id: str,
    generated_at: str,
    source_bucket: str,
    derived_bucket: str,
    mode: ScheduleImageOcrAdmitMode = "plan",
    object_store: ScheduleImageOcrWritableObjectStore | None = None,
    registry: DocumentRegistry | None = None,
    attempt_store: ScheduleImageOcrAttemptStore | None = None,
) -> dict[str, Any]:
    selected_notice_ids = _normalize_notice_ids(notice_ids)
    if not selected_notice_ids:
        raise ValueError("selected --notice-id is required")
    if consumer_admission_manifest_path is None:
        raise ValueError("consumer admission manifest path is required")
    _assert_consumer_gate_allows(
        manifest_path=consumer_admission_manifest_path,
        selected_notice_ids=selected_notice_ids,
    )
    normalized_mode = _normalize_mode(mode)
    items = _load_ocr_items(
        ocr_output_dir=ocr_output_dir,
        notice_ids=selected_notice_ids,
        generated_at=generated_at,
    )
    if not items:
        raise ValueError("no schedule OCR result items matched selected notice ids")
    materialize = normalized_mode == "admit_and_materialize"
    if materialize and (object_store is None or registry is None or attempt_store is None):
        raise ValueError("object_store, registry, and attempt_store are required for writes")

    item_reports: list[dict[str, Any]] = []
    admitted_records = []
    admitted_document_ids: list[str] = []
    source_artifact_write_count = 0
    child_artifact_write_count = 0
    for evidence, result, decision in items:
        source_write_status = "not_written"
        child_write_status = "not_written"
        registry_write_status = "not_written"
        if decision.document is not None:
            admitted_document_ids.append(decision.document.document_id)
        if materialize:
            assert object_store is not None
            assert attempt_store is not None
            source_report = write_schedule_image_ocr_source_artifacts(
                evidence=evidence,
                result=result,
                object_store=object_store,
                source_bucket=source_bucket,
                attempt_store=attempt_store,
                admission_batch_id=run_id,
                run_id=run_id,
            )
            source_write_status = source_report.status
            source_artifact_write_count += 3
            if decision.document is not None:
                child_report = write_schedule_image_ocr_child_document_artifacts(
                    document=decision.document,
                    object_store=object_store,
                    derived_bucket=derived_bucket,
                    year=_release_year(evidence.release_time, generated_at),
                )
                record = build_schedule_image_ocr_child_document_registry_record(
                    evidence=evidence,
                    document=decision.document,
                    artifact_report=child_report,
                    generated_at=generated_at,
                )
                assert registry is not None
                registry.upsert(record)
                admitted_records.append(record)
                child_artifact_write_count += 2
                child_write_status = "stored"
                registry_write_status = "upserted"
        item_reports.append(
            {
                "notice_id": evidence.notice_id,
                "attachment_ref_id": evidence.attachment_ref_id,
                "image_index": evidence.image_index,
                "confidence": result.confidence,
                "admission_status": decision.status,
                "admission_reason": decision.reason,
                "document_id": decision.document.document_id if decision.document else "",
                "table_count": len(result.tables),
                "source_write_status": source_write_status,
                "child_write_status": child_write_status,
                "registry_write_status": registry_write_status,
            }
        )
    return {
        "schema_version": "schedule_image_ocr_admission_run.v1",
        "mode": normalized_mode,
        "write_enabled": materialize,
        "selected_notice_ids": list(selected_notice_ids),
        "run_id": run_id,
        "generated_at": generated_at,
        "ocr_item_count": len(items),
        "admitted_document_count": len(
            [item for item in item_reports if item["admission_status"] == "admitted"]
        ),
        "source_artifact_write_count": source_artifact_write_count,
        "child_artifact_write_count": child_artifact_write_count,
        "registry_upsert_count": len(admitted_records),
        "admitted_document_ids": admitted_document_ids,
        "materialized_document_ids": [record.document_id for record in admitted_records],
        "items": item_reports,
    }


def _assert_consumer_gate_allows(
    *,
    manifest_path: Path,
    selected_notice_ids: Sequence[str],
) -> None:
    manifest = load_internal_notice_consumer_admission_manifest(manifest_path)
    report = check_internal_notice_consumer_admission_gate(
        manifest=manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=tuple(selected_notice_ids),
            scope_write_mode="upsert_selected",
            target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
            max_empty_body_count=0,
            max_unsupported_binary_count=0,
        ),
    )
    if not report.allowed:
        raise ValueError(
            "consumer admission manifest gate blocked schedule OCR admission: "
            + ", ".join(report.reason_codes)
        )


def _load_ocr_items(
    *,
    ocr_output_dir: Path,
    notice_ids: Sequence[str],
    generated_at: str,
) -> tuple[
    tuple[
        ScheduleImageOcrEvidence,
        ScheduleImageOcrProviderResult,
        ScheduleImageOcrAdmissionDecision,
    ],
    ...,
]:
    selected = set(_normalize_notice_ids(notice_ids))
    items = []
    for manifest_path in sorted(Path(ocr_output_dir).glob("**/manifest.json")):
        evidence = _evidence_from_payload(_read_json(manifest_path))
        if evidence.notice_id not in selected:
            continue
        result = _provider_result_from_payload(_read_json(manifest_path.parent / "ocr-result.json"))
        decision = admit_schedule_image_ocr_child_document(
            evidence=evidence,
            result=result,
            generated_at=generated_at,
        )
        items.append((evidence, result, decision))
    return tuple(items)


def _evidence_from_payload(payload: Mapping[str, Any]) -> ScheduleImageOcrEvidence:
    return ScheduleImageOcrEvidence(
        notice_id=_required_text(payload, "notice_id"),
        notice_title=_text(payload.get("notice_title")),
        release_time=_text(payload.get("release_time")),
        organization=_text(payload.get("organization")),
        image_index=int(payload.get("image_index") or 0),
        attachment_ref_id=normalize_schedule_image_ocr_attachment_ref_id(
            _text(payload.get("attachment_ref_id"))
        ),
        filename=_text(payload.get("filename")),
        mime_type=_text(payload.get("mime_type")) or "application/octet-stream",
        byte_size=int(payload.get("byte_size") or 0),
        sha256=_required_text(payload, "sha256"),
        object_key=_required_text(payload, "object_key"),
        image_use=_text(payload.get("image_use")) or "schedule_image_candidate",
        reason_codes=tuple(str(item) for item in payload.get("reason_codes") or () if str(item)),
        context_before=_text(payload.get("context_before")),
        context_after=_text(payload.get("context_after")),
    )


def _provider_result_from_payload(payload: Mapping[str, Any]) -> ScheduleImageOcrProviderResult:
    return ScheduleImageOcrProviderResult(
        provider=_text(payload.get("provider")) or "unknown",
        model=_text(payload.get("model")) or "unknown",
        confidence=_confidence(_text(payload.get("confidence"))),
        extracted_text=_text(payload.get("extracted_text")),
        tables=_tables(payload.get("tables")),
        layout_elements=tuple(
            dict(item) for item in payload.get("layout_elements") or () if isinstance(item, dict)
        ),
        raw_response=payload.get("raw_response") if "raw_response" in payload else dict(payload),
    )


def _normalize_mode(mode: str) -> ScheduleImageOcrAdmitMode:
    normalized = str(mode or "").strip().lower().replace("-", "_")
    if normalized == "admit_and_materialize":
        return "admit_and_materialize"
    if normalized == "plan":
        return "plan"
    raise ValueError(f"unsupported schedule image OCR admit mode: {mode!r}")


def _normalize_notice_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _required_text(payload: Mapping[str, Any], key: str) -> str:
    value = _text(payload.get(key))
    if not value:
        raise ValueError(f"schedule OCR manifest missing {key}")
    return value


def _text(value: object) -> str:
    return str(value or "").strip()


def _confidence(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"high", "medium", "low"}:
        return normalized
    return "low"


def _tables(value: object) -> tuple[tuple[tuple[str, ...], ...], ...]:
    if not isinstance(value, list | tuple):
        return ()
    tables = []
    for raw_table in value:
        if not isinstance(raw_table, list | tuple):
            continue
        rows = []
        for raw_row in raw_table:
            if isinstance(raw_row, list | tuple):
                rows.append(tuple(str(cell or "").strip() for cell in raw_row))
        if rows:
            tables.append(tuple(rows))
    return tuple(tables)


def _release_year(release_time: str, generated_at: str) -> str:
    for value in (release_time, generated_at):
        candidate = str(value or "").strip()[:4]
        if candidate.isdigit():
            return candidate
    return "unknown"


__all__ = [
    "admit_schedule_image_ocr_results",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
