from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Literal

from campus_ingestion_core.authenticated_notice_reviewed_attachment_ocr import (
    ReviewedAttachmentOcrEvidence,
    ReviewedAttachmentOcrObjectStore,
    ReviewedAttachmentOcrResult,
    admit_reviewed_attachment_ocr_document,
    build_reviewed_attachment_ocr_registry_record,
    write_reviewed_attachment_ocr_artifacts,
)
from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    load_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
)
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

ReviewedAttachmentOcrAdmitMode = Literal["plan", "admit_and_materialize"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Admit operator-reviewed authenticated notice attachment OCR as child documents.",
    )
    parser.add_argument("--review-input-path", required=True)
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--consumer-admission-manifest-path", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--generated-at", required=True)
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
    result = admit_reviewed_attachment_ocr_results(
        review_input_path=Path(args.review_input_path),
        notice_ids=tuple(args.notice_ids),
        consumer_admission_manifest_path=Path(args.consumer_admission_manifest_path),
        run_id=args.run_id,
        generated_at=args.generated_at,
        derived_bucket=args.derived_bucket or settings.bucket_derived,
        mode=mode,
        object_store=S3ObjectStoreAdmin(settings) if mode == "admit_and_materialize" else None,
        registry=build_document_registry_from_env() if mode == "admit_and_materialize" else None,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


def admit_reviewed_attachment_ocr_results(
    *,
    review_input_path: Path,
    notice_ids: Sequence[str],
    consumer_admission_manifest_path: Path | None,
    run_id: str,
    generated_at: str,
    derived_bucket: str,
    mode: ReviewedAttachmentOcrAdmitMode = "plan",
    object_store: ReviewedAttachmentOcrObjectStore | None = None,
    registry: DocumentRegistry | None = None,
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
    items = _load_review_items(
        review_input_path=review_input_path,
        notice_ids=selected_notice_ids,
    )
    if not items:
        raise ValueError("no reviewed attachment OCR items matched selected notice ids")
    materialize = normalized_mode == "admit_and_materialize"
    if materialize and (object_store is None or registry is None):
        raise ValueError("object_store and registry are required for writes")

    item_reports: list[dict[str, Any]] = []
    admitted_document_ids: list[str] = []
    materialized_document_ids: list[str] = []
    artifact_write_count = 0
    registry_upsert_count = 0
    for evidence, result in items:
        decision = admit_reviewed_attachment_ocr_document(
            evidence=evidence,
            result=result,
            generated_at=generated_at,
        )
        artifact_write_status = "not_written"
        registry_write_status = "not_written"
        if decision.document is not None:
            admitted_document_ids.append(decision.document.document_id)
        if materialize and decision.document is not None:
            assert object_store is not None
            assert registry is not None
            artifact_report = write_reviewed_attachment_ocr_artifacts(
                document=decision.document,
                object_store=object_store,
                derived_bucket=derived_bucket,
            )
            record = build_reviewed_attachment_ocr_registry_record(
                evidence=evidence,
                document=decision.document,
                artifact_report=artifact_report,
                generated_at=generated_at,
            )
            registry.upsert(record)
            materialized_document_ids.append(record.document_id)
            artifact_write_count += 4
            registry_upsert_count += 1
            artifact_write_status = "stored"
            registry_write_status = "upserted"
        item_reports.append(
            {
                "notice_id": evidence.notice_id,
                "attachment_ref_id": evidence.attachment_ref_id,
                "confidence": result.confidence,
                "admission_status": decision.status,
                "admission_reason": decision.reason,
                "document_id": decision.document.document_id if decision.document else "",
                "artifact_write_status": artifact_write_status,
                "registry_write_status": registry_write_status,
            }
        )

    return {
        "schema_version": "authenticated_notice_reviewed_attachment_ocr_admission_run.v1",
        "mode": normalized_mode,
        "write_enabled": materialize,
        "selected_notice_ids": list(selected_notice_ids),
        "run_id": run_id,
        "generated_at": generated_at,
        "review_item_count": len(items),
        "admitted_document_count": len(
            [item for item in item_reports if item["admission_status"] == "admitted"]
        ),
        "artifact_write_count": artifact_write_count,
        "registry_upsert_count": registry_upsert_count,
        "admitted_document_ids": admitted_document_ids,
        "materialized_document_ids": materialized_document_ids,
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
            "consumer admission manifest gate blocked reviewed attachment OCR admission: "
            + ", ".join(report.reason_codes)
        )


def _load_review_items(
    *,
    review_input_path: Path,
    notice_ids: Sequence[str],
) -> tuple[tuple[ReviewedAttachmentOcrEvidence, ReviewedAttachmentOcrResult], ...]:
    selected = set(_normalize_notice_ids(notice_ids))
    payload = _read_json(review_input_path)
    if (
        str(payload.get("schema_version") or "")
        != "authenticated_notice_reviewed_attachment_ocr.v1"
    ):
        raise ValueError("review input has unsupported schema_version")
    items = []
    for raw_item in payload.get("items") or ():
        if not isinstance(raw_item, Mapping):
            continue
        notice_id = _required_text(raw_item, "notice_id")
        if notice_id not in selected:
            continue
        evidence = ReviewedAttachmentOcrEvidence(
            notice_id=notice_id,
            notice_title=_text(raw_item.get("notice_title")),
            release_time=_text(raw_item.get("release_time")),
            organization=_text(raw_item.get("organization")),
            attachment_ref_id=_attachment_ref_id(raw_item),
            filename=_text(raw_item.get("filename")),
            mime_type=_text(raw_item.get("mime_type")) or "application/octet-stream",
            byte_size=int(raw_item.get("byte_size") or 0),
            sha256=_required_text(raw_item, "sha256"),
            object_key=_required_text(raw_item, "object_key"),
            source_url=_text(raw_item.get("source_url")),
        )
        result = ReviewedAttachmentOcrResult(
            provider=_text(raw_item.get("provider")) or "operator-reviewed",
            model=_text(raw_item.get("model")) or "manual-layout-v1",
            confidence=_confidence(_text(raw_item.get("confidence"))),
            provider_response_bytes=_provider_response_bytes(raw_item),
            review_notes=tuple(
                str(item).strip()
                for item in raw_item.get("review_notes") or ()
                if str(item).strip()
            ),
        )
        items.append((evidence, result))
    return tuple(items)


def _provider_response_bytes(raw_item: Mapping[str, Any]) -> bytes:
    before_blocks, after_blocks = _review_context_blocks(raw_item)
    jsonl = raw_item.get("provider_response_jsonl")
    if isinstance(jsonl, str) and jsonl.strip() and not before_blocks and not after_blocks:
        return (jsonl.rstrip() + "\n").encode("utf-8")
    if isinstance(jsonl, str) and jsonl.strip():
        payloads = []
        for line in jsonl.splitlines():
            if not line.strip():
                continue
            payload = json.loads(line)
            if isinstance(payload, Mapping):
                payloads.append(dict(payload))
        return _provider_response_payloads_bytes(
            payloads=payloads,
            before_blocks=before_blocks,
            after_blocks=after_blocks,
        )
    lines = raw_item.get("provider_response_lines")
    if isinstance(lines, list):
        return _provider_response_payloads_bytes(
            payloads=[dict(item) for item in lines if isinstance(item, Mapping)],
            before_blocks=before_blocks,
            after_blocks=after_blocks,
        )
    response = raw_item.get("provider_response")
    if isinstance(response, Mapping):
        return _provider_response_payloads_bytes(
            payloads=(dict(response),),
            before_blocks=before_blocks,
            after_blocks=after_blocks,
        )
    raise ValueError("review item requires provider_response_lines or provider_response_jsonl")


def _provider_response_payloads_bytes(
    *,
    payloads: Sequence[Mapping[str, Any]],
    before_blocks: Sequence[Mapping[str, Any]],
    after_blocks: Sequence[Mapping[str, Any]],
) -> bytes:
    rendered_payloads: list[Mapping[str, Any]] = []
    for index, payload in enumerate(payloads):
        rendered_payloads.append(
            _inject_review_context_blocks(
                payload,
                before_blocks=before_blocks if index == 0 else (),
                after_blocks=after_blocks if index == len(payloads) - 1 else (),
            )
        )
    return (
        "\n".join(json.dumps(dict(item), ensure_ascii=False) for item in rendered_payloads) + "\n"
    ).encode("utf-8")


def _inject_review_context_blocks(
    payload: Mapping[str, Any],
    *,
    before_blocks: Sequence[Mapping[str, Any]],
    after_blocks: Sequence[Mapping[str, Any]],
) -> Mapping[str, Any]:
    if not before_blocks and not after_blocks:
        return dict(payload)
    updated = dict(payload)
    blocks = updated.get("blocks")
    if isinstance(blocks, list):
        updated["blocks"] = [*before_blocks, *blocks, *after_blocks]
        return updated
    result = updated.get("result")
    if isinstance(result, Mapping) and isinstance(result.get("blocks"), list):
        updated_result = dict(result)
        updated_result["blocks"] = [*before_blocks, *list(result["blocks"]), *after_blocks]
        updated["result"] = updated_result
        return updated
    layout_results = updated.get("layoutParsingResults")
    if isinstance(layout_results, list):
        updated["layoutParsingResults"] = [*before_blocks, *layout_results, *after_blocks]
        return updated
    return updated


def _review_context_blocks(
    raw_item: Mapping[str, Any],
) -> tuple[tuple[Mapping[str, Any], ...], tuple[Mapping[str, Any], ...]]:
    before: list[Mapping[str, Any]] = []
    after: list[Mapping[str, Any]] = []
    if context_before := _text(raw_item.get("context_before")):
        before.append(_context_block(context_before, block_type="paragraph"))
    for key in ("ocr_text", "table_caption", "caption_text", "context_text"):
        if text := _text(raw_item.get(key)):
            before.append(_context_block(text, block_type="heading"))
    if context_after := _text(raw_item.get("context_after")):
        after.append(_context_block(context_after, block_type="paragraph"))
    return tuple(_dedupe_blocks(before)), tuple(_dedupe_blocks(after))


def _context_block(text: str, *, block_type: str) -> Mapping[str, Any]:
    return {
        "blockType": block_type,
        "markdown": {"text": text},
    }


def _dedupe_blocks(blocks: Sequence[Mapping[str, Any]]) -> tuple[Mapping[str, Any], ...]:
    seen: set[str] = set()
    deduped: list[Mapping[str, Any]] = []
    for block in blocks:
        text = _text(dict(block.get("markdown") or {}).get("text"))
        if not text or text in seen:
            continue
        deduped.append(block)
        seen.add(text)
    return tuple(deduped)


def _normalize_mode(mode: str) -> ReviewedAttachmentOcrAdmitMode:
    normalized = str(mode or "").strip().lower().replace("-", "_")
    if normalized == "admit_and_materialize":
        return "admit_and_materialize"
    if normalized == "plan":
        return "plan"
    raise ValueError(f"unsupported reviewed attachment OCR admit mode: {mode!r}")


def _normalize_notice_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _attachment_ref_id(payload: Mapping[str, Any]) -> str:
    value = _text(payload.get("attachment_ref_id"))
    if value:
        return value
    attachment_id = _text(payload.get("attachment_id"))
    if attachment_id:
        return f"attachment-{attachment_id}"
    raise ValueError("review item missing attachment_ref_id")


def _required_text(payload: Mapping[str, Any], key: str) -> str:
    value = _text(payload.get(key))
    if not value:
        raise ValueError(f"review item missing {key}")
    return value


def _text(value: object) -> str:
    return str(value or "").strip()


def _confidence(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"high", "medium", "low"}:
        return normalized
    return "medium"


__all__ = [
    "admit_reviewed_attachment_ocr_results",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
