from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_attachment_ocr import _normalize_layout_rows
from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_media_extraction_closeout import (
    build_owner_text_media_extraction_closeout_result_manifest,
)
from campus_ingestion_core.collected_notice_regulation_owner_text_recovery_constants import (
    PHASE_06_R1A_ID,
    PHASE_06_R1B_ID,
    REGULATION_OWNER_TEXT_EXECUTION_REPORT_SCHEMA_VERSION,
    REGULATION_OWNER_TEXT_RECOVERY_TARGET,
)
from campus_ingestion_core.file_asset_contract import (
    FileAssetExtractionRecord,
    serialize_file_asset_extraction_record,
)
from campus_ingestion_core.file_asset_text_extractable import (
    build_text_extractable_layout_elements_bytes,
    extract_text_extractable_file_asset,
)
from campus_ingestion_core.online_ocr_evidence import extract_provider_plain_text
from campus_ingestion_core.raw_ingestion_online_ocr import (
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrClient,
    parse_online_ocr_bytes,
)
from campus_ingestion_core.raw_ingestion_source_truth_support import (
    _normalize_online_ocr_provider_result,
)
from campus_ingestion_core.source_truth_common import serialize_layout_rows


class RegulationOwnerTextObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


def execute_collected_notice_regulation_owner_text_attempts(
    *,
    attempt_plan: Mapping[str, Any],
    object_store: RegulationOwnerTextObjectStore,
    online_ocr_clients: Mapping[str, OnlineOcrClient] | None = None,
    execute: bool = False,
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.execute_collected_notice_regulation_owner_text",
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    attempts = [dict(item) for item in _mapping_rows(attempt_plan.get("attempts"))]
    if not execute:
        return _execution_report(
            generated_at=timestamp,
            generated_by=generated_by,
            execute=False,
            attempt_results=[_planned_result(attempt) for attempt in attempts],
        )

    clients = dict(online_ocr_clients or {})
    results = [
        _execute_attempt(
            attempt=attempt,
            object_store=object_store,
            online_ocr_clients=clients,
            generated_at=timestamp,
        )
        for attempt in attempts
    ]
    return _execution_report(
        generated_at=timestamp,
        generated_by=generated_by,
        execute=True,
        attempt_results=results,
    )


def _execute_attempt(
    *,
    attempt: Mapping[str, Any],
    object_store: RegulationOwnerTextObjectStore,
    online_ocr_clients: Mapping[str, OnlineOcrClient],
    generated_at: str,
) -> dict[str, Any]:
    try:
        source_ref = _required_ref(attempt, "source_object_ref")
        source_bucket = _required_text(source_ref.get("bucket"), "source_object_ref.bucket")
        source_key = _required_text(source_ref.get("key"), "source_object_ref.key")
        source_bytes = object_store.get_bytes(bucket=source_bucket, key=source_key)
        media_kind = _required_text(attempt.get("media_kind"), "media_kind")
        filename = Path(source_key).name or f"{attempt.get('candidate_id')}.{media_kind}"
        if media_kind == "office":
            execution = _execute_office_attempt(
                attempt=attempt,
                source_bytes=source_bytes,
                filename=filename,
                source_key=source_key,
                generated_at=generated_at,
            )
        else:
            execution = _execute_ocr_attempt(
                attempt=attempt,
                source_bytes=source_bytes,
                filename=filename,
                source_ref=source_ref,
                online_ocr_clients=online_ocr_clients,
                media_kind=media_kind,
                generated_at=generated_at,
            )
        _write_success_outputs(
            attempt=attempt,
            object_store=object_store,
            provider_response_bytes=execution["provider_response_bytes"],
            owner_text_bytes=execution["owner_text_bytes"],
            layout_elements_bytes=execution["layout_elements_bytes"],
            searchable_merge_input_bytes=execution["searchable_merge_input_bytes"],
        )
        return _success_result(
            attempt=attempt,
            source_ref=source_ref,
            provider=str(execution["provider"]),
            model=str(execution["model"]),
            owner_text=str(execution["owner_text"]),
            written_refs=execution["written_refs"],
            provider_metadata=execution["provider_metadata"],
        )
    except Exception as exc:
        return _failed_result(attempt=attempt, exc=exc)


def _execute_ocr_attempt(
    *,
    attempt: Mapping[str, Any],
    source_bytes: bytes,
    filename: str,
    source_ref: Mapping[str, Any],
    online_ocr_clients: Mapping[str, OnlineOcrClient],
    media_kind: str,
    generated_at: str,
) -> dict[str, Any]:
    provider, client = _select_ocr_client(online_ocr_clients)
    media_type = str(source_ref.get("mime_type") or "").strip() or None
    provider_result = parse_online_ocr_bytes(
        ocr_client=client,
        file_bytes=source_bytes,
        filename=filename,
        media_type=media_type,
        asset_subkind="pdf" if media_kind == "pdf" else media_kind,
    )
    normalized_result = (
        _normalize_online_ocr_provider_result(
            provider=provider,
            provider_result=provider_result,
        )
        if provider == ONLINE_OCR_PROVIDER_MINERU_API
        else provider_result
    )
    provider_response_bytes = normalized_result.provider_result_bytes
    owner_text = extract_provider_plain_text(
        provider=provider,
        provider_response_bytes=provider_response_bytes,
    ).strip()
    if not owner_text:
        raise ValueError("owner text recovery produced empty text")
    layout_rows = _normalize_layout_rows(
        provider_response_bytes=provider_response_bytes,
        source_artifact_id=_source_artifact_id(attempt),
    )
    if not layout_rows:
        raise ValueError("owner text recovery produced no layout elements")
    layout_elements_bytes = serialize_layout_rows(layout_rows)
    return _execution_payload(
        attempt=attempt,
        provider=provider,
        model=_client_model_label(client),
        owner_text=owner_text,
        provider_response_bytes=provider_response_bytes,
        layout_elements_bytes=layout_elements_bytes,
        generated_at=generated_at,
        provider_metadata=normalized_result.metadata or provider_result.metadata or {},
    )


def _execute_office_attempt(
    *,
    attempt: Mapping[str, Any],
    source_bytes: bytes,
    filename: str,
    source_key: str,
    generated_at: str,
) -> dict[str, Any]:
    extraction = extract_text_extractable_file_asset(
        source_bytes,
        filename=filename,
        source_object_key=source_key,
    )
    owner_text = "\n\n".join(block.strip() for block in extraction.text_blocks if block.strip())
    if not owner_text:
        raise ValueError("office owner text extraction produced empty text")
    provider_response_bytes = (
        json.dumps(
            serialize_file_asset_extraction_record(
                FileAssetExtractionRecord(
                    outcome=extraction,
                    metadata={
                        "source": "regulation_owner_text_recovery",
                        "phase": PHASE_06_R1B_ID,
                    },
                )
            ),
            ensure_ascii=False,
        )
        + "\n"
    ).encode("utf-8")
    layout_elements_bytes = build_text_extractable_layout_elements_bytes(
        source_bytes,
        filename=filename,
        source_object_key=source_key,
    ) or _minimal_layout_elements_bytes(attempt=attempt, owner_text=owner_text)
    return _execution_payload(
        attempt=attempt,
        provider="text_extractable_file_asset",
        model=extraction.provenance.engine_version,
        owner_text=owner_text,
        provider_response_bytes=provider_response_bytes,
        layout_elements_bytes=layout_elements_bytes,
        generated_at=generated_at,
        provider_metadata={
            "engine_name": extraction.provenance.engine_name,
            "engine_version": extraction.provenance.engine_version,
            "extraction_strategy": extraction.extraction_strategy,
        },
    )


def _execution_payload(
    *,
    attempt: Mapping[str, Any],
    provider: str,
    model: str,
    owner_text: str,
    provider_response_bytes: bytes,
    layout_elements_bytes: bytes,
    generated_at: str,
    provider_metadata: Mapping[str, Any],
) -> dict[str, Any]:
    owner_text_bytes = _owner_text_bytes(
        attempt=attempt,
        owner_text=owner_text,
        provider=provider,
        model=model,
        generated_at=generated_at,
    )
    searchable_merge_input_bytes = _searchable_merge_input_bytes(
        attempt=attempt,
        owner_text=owner_text,
        provider=provider,
        model=model,
        generated_at=generated_at,
    )
    return {
        "provider": provider,
        "model": model,
        "owner_text": owner_text,
        "provider_response_bytes": provider_response_bytes,
        "owner_text_bytes": owner_text_bytes,
        "layout_elements_bytes": layout_elements_bytes,
        "searchable_merge_input_bytes": searchable_merge_input_bytes,
        "provider_metadata": dict(provider_metadata),
        "written_refs": _normalized_output_refs(attempt),
    }


def _owner_text_bytes(
    *,
    attempt: Mapping[str, Any],
    owner_text: str,
    provider: str,
    model: str,
    generated_at: str,
) -> bytes:
    row = {
        "schema_version": "regulation_owner_text_v1",
        "generated_at": generated_at,
        "phase": PHASE_06_R1B_ID,
        "source_notice_id": attempt.get("source_notice_id"),
        "searchable_unit_id": attempt.get("searchable_unit_id"),
        "candidate_id": attempt.get("candidate_id"),
        "candidate_key": attempt.get("candidate_key"),
        "target_collection": attempt.get("target_collection"),
        "title": attempt.get("title"),
        "regulation_title_normalized": attempt.get("regulation_title_normalized"),
        "provider": provider,
        "model": model,
        "text": owner_text,
        "text_sha256": hashlib.sha256(owner_text.encode("utf-8")).hexdigest(),
    }
    return (json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def _searchable_merge_input_bytes(
    *,
    attempt: Mapping[str, Any],
    owner_text: str,
    provider: str,
    model: str,
    generated_at: str,
) -> bytes:
    refs = _normalized_output_refs(attempt)
    payload = {
        "schema_version": "regulation_owner_text_searchable_merge_input_v1",
        "generated_at": generated_at,
        "phase": PHASE_06_R1B_ID,
        "source_phase": PHASE_06_R1A_ID,
        "owner_text_ready": True,
        "source_notice_id": attempt.get("source_notice_id"),
        "source_surface": attempt.get("source_surface"),
        "searchable_unit_id": attempt.get("searchable_unit_id"),
        "source_document_id": attempt.get("source_document_id"),
        "candidate_id": attempt.get("candidate_id"),
        "candidate_key": attempt.get("candidate_key"),
        "target_collection": attempt.get("target_collection"),
        "title": attempt.get("title"),
        "regulation_title_normalized": attempt.get("regulation_title_normalized"),
        "provider": provider,
        "model": model,
        "owner_text": owner_text,
        "owner_text_sha256": hashlib.sha256(owner_text.encode("utf-8")).hexdigest(),
        "normalized_output_refs": refs,
    }
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _write_success_outputs(
    *,
    attempt: Mapping[str, Any],
    object_store: RegulationOwnerTextObjectStore,
    provider_response_bytes: bytes,
    owner_text_bytes: bytes,
    layout_elements_bytes: bytes,
    searchable_merge_input_bytes: bytes,
) -> None:
    refs = _normalized_output_refs(attempt)
    _put_ref(
        object_store=object_store,
        ref=refs["provider_response"],
        data=provider_response_bytes,
        content_type="application/x-ndjson; charset=utf-8",
    )
    _put_ref(
        object_store=object_store,
        ref=refs["plain_text"],
        data=owner_text_bytes,
        content_type="application/x-ndjson; charset=utf-8",
    )
    _put_ref(
        object_store=object_store,
        ref=refs["layout_elements"],
        data=layout_elements_bytes,
        content_type="application/x-ndjson; charset=utf-8",
    )
    _put_ref(
        object_store=object_store,
        ref=refs["searchable_merge_input"],
        data=searchable_merge_input_bytes,
        content_type="application/json; charset=utf-8",
    )


def _put_ref(
    *,
    object_store: RegulationOwnerTextObjectStore,
    ref: Mapping[str, Any],
    data: bytes,
    content_type: str,
) -> None:
    object_store.put_bytes(
        bucket=_required_text(ref.get("bucket"), "output_ref.bucket"),
        key=_required_text(ref.get("key"), "output_ref.key"),
        data=data,
        content_type=content_type,
    )


def _execution_report(
    *,
    generated_at: str,
    generated_by: str,
    execute: bool,
    attempt_results: list[dict[str, Any]],
) -> dict[str, Any]:
    status_counts = _status_counts(attempt_results)
    report = {
        "schema_version": REGULATION_OWNER_TEXT_EXECUTION_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "execute" if execute else "dry_run",
        "write_enabled": execute,
        "provider_calls_enabled": execute,
        "object_store_writes_enabled": execute,
        "db_writes_enabled": False,
        "phase": PHASE_06_R1B_ID,
        "target": REGULATION_OWNER_TEXT_RECOVERY_TARGET,
        "counts": {
            "selected_count": len(attempt_results),
            "planned_count": status_counts.get("planned", 0),
            "succeeded_count": status_counts.get("succeeded", 0),
            "failed_count": status_counts.get("failed", 0),
            "owner_text_ready_count": sum(
                1 for item in attempt_results if item.get("owner_text_status") == "ready"
            ),
        },
        "attempt_results": attempt_results,
    }
    report["media_extraction_closeout_result_manifest"] = (
        build_owner_text_media_extraction_closeout_result_manifest(
            execution_report=report,
            generated_at=generated_at,
        )
    )
    return report


def _success_result(
    *,
    attempt: Mapping[str, Any],
    source_ref: Mapping[str, Any],
    provider: str,
    model: str,
    owner_text: str,
    written_refs: Mapping[str, Mapping[str, Any]],
    provider_metadata: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        **_base_result(attempt),
        "status": "succeeded",
        "owner_text_status": "ready",
        "provider": provider,
        "model": model,
        "source_object_ref": dict(source_ref),
        "owner_text_length": len(owner_text),
        "owner_text_sha256": hashlib.sha256(owner_text.encode("utf-8")).hexdigest(),
        "written_refs": {key: dict(value) for key, value in written_refs.items()},
        "provider_metadata": dict(provider_metadata),
    }


def _planned_result(attempt: Mapping[str, Any]) -> dict[str, Any]:
    return {
        **_base_result(attempt),
        "status": "planned",
        "owner_text_status": "not_run",
        "reason_codes": ["execute_not_enabled"],
    }


def _failed_result(*, attempt: Mapping[str, Any], exc: Exception) -> dict[str, Any]:
    return {
        **_base_result(attempt),
        "status": "failed",
        "owner_text_status": "not_ready",
        "error_type": type(exc).__name__,
        "error": str(exc),
    }


def _base_result(attempt: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "attempt_id": attempt.get("attempt_id"),
        "candidate_id": attempt.get("candidate_id"),
        "source_notice_id": attempt.get("source_notice_id"),
        "source_surface": attempt.get("source_surface"),
        "searchable_unit_id": attempt.get("searchable_unit_id"),
        "title": attempt.get("title"),
        "candidate_key": attempt.get("candidate_key"),
        "target_collection": attempt.get("target_collection"),
        "media_kind": attempt.get("media_kind"),
    }


def _status_counts(results: list[Mapping[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in results:
        status = str(item.get("status") or "")
        counts[status] = counts.get(status, 0) + 1
    return counts


def _select_ocr_client(
    clients: Mapping[str, OnlineOcrClient],
) -> tuple[str, OnlineOcrClient]:
    for provider in (ONLINE_OCR_PROVIDER_MINERU_API, ONLINE_OCR_PROVIDER_ASYNC_JOBS):
        client = clients.get(provider)
        if client is not None:
            return provider, client
    if clients:
        provider, client = next(iter(clients.items()))
        return str(provider), client
    raise ValueError("no OCR client configured for owner text recovery")


def _client_model_label(client: OnlineOcrClient) -> str:
    settings = getattr(client, "_settings", None)
    model = getattr(settings, "model", "")
    return str(model or client.__class__.__name__)


def _normalized_output_refs(attempt: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    refs = attempt.get("normalized_output_refs")
    if not isinstance(refs, Mapping):
        raise ValueError("attempt normalized_output_refs must be a mapping")
    required = ("provider_response", "plain_text", "layout_elements", "searchable_merge_input")
    output: dict[str, Mapping[str, Any]] = {}
    for role in required:
        ref = refs.get(role)
        if not isinstance(ref, Mapping):
            raise ValueError(f"attempt missing normalized output ref: {role}")
        _required_text(ref.get("bucket"), f"{role}.bucket")
        _required_text(ref.get("key"), f"{role}.key")
        output[role] = ref
    return output


def _required_ref(attempt: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    value = attempt.get(key)
    if not isinstance(value, Mapping):
        raise ValueError(f"attempt {key} must be a mapping")
    return value


def _required_text(value: object, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


def _source_artifact_id(attempt: Mapping[str, Any]) -> str:
    return (
        str(attempt.get("source_document_id") or "").strip()
        or str(attempt.get("candidate_id") or "").strip()
        or "regulation-owner-text"
    )


def _minimal_layout_elements_bytes(*, attempt: Mapping[str, Any], owner_text: str) -> bytes:
    row = {
        "schema_version": "regulation_owner_text_layout_v1",
        "source_artifact_id": _source_artifact_id(attempt),
        "page_start": 1,
        "page_end": 1,
        "row_id": "page-0001-row-0001",
        "row_index": 1,
        "row_type": "paragraph",
        "text_raw": owner_text,
        "text_normalized": owner_text,
    }
    return (json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


__all__ = [
    "PHASE_06_R1B_ID",
    "RegulationOwnerTextObjectStore",
    "execute_collected_notice_regulation_owner_text_attempts",
]
