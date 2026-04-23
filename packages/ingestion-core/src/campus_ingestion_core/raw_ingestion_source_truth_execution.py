from __future__ import annotations

import json
from dataclasses import replace
from typing import TYPE_CHECKING

from campus_ingestion_core.artifacts import (
    LAYOUT_ELEMENTS_FILENAME,
    OCR_ROUTING_DECISION_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    ImportReport,
    ObjectStoreWriter,
    utc_now,
    write_import_report,
)
from campus_ingestion_core.file_asset_routing import (
    RAW_PROVIDER_RESPONSE_ARCHIVE_FILENAME,
    RawAssetTypedMetadata,
    refine_raw_asset_typed_metadata_with_ocr_evidence,
    select_adjudicated_image_routing,
    select_online_ocr_routing,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_source_model_slug,
    build_source_ocr_artifact_key,
    build_source_truth_artifact_key,
    infer_year_label,
)
from campus_ingestion_core.online_ocr_evidence import (
    build_adjudication,
    build_provider_summary,
    extract_provider_plain_text,
)
from campus_ingestion_core.raw_ingestion_online_ocr import (
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrClient,
    OnlineOcrProviderResult,
    OnlineOcrRawArtifact,
    normalize_online_ocr_provider_label,
)
from campus_ingestion_core.raw_ingestion_source_truth_support import (
    ObjectStoreReader,
    SourceTruthOnlyOcrDeferredError,
    SourceTruthOnlyOcrExecutionResult,
    _build_source_truth_layout_elements_bytes,
    _ensure_routable_raw_asset_record_typing,
    _has_route_provider,
    _needs_dual_run_image_adjudication,
    _normalize_online_ocr_provider_result,
    _parse_registered_raw_asset,
    _raw_asset_typed_metadata_from_record,
    _resolve_route_provider,
    _resolve_source_truth_only_ocr_settings_for_provider,
)
from campus_ingestion_core.registry import RawAssetRegistry

if TYPE_CHECKING:
    from campus_ingestion_core.raw_ingestion import RawIngestionProcessSettings


def _execute_source_truth_only_provider(
    *,
    settings: RawIngestionProcessSettings,
    raw_asset_record: RawAssetRecord,
    reader: ObjectStoreReader,
    bucket: str,
    provider: str,
    online_ocr_clients: dict[str, OnlineOcrClient],
) -> tuple[bytes | None, dict[str, object]]:
    provider_settings = _resolve_source_truth_only_ocr_settings_for_provider(
        settings=settings,
        provider=provider,
    )
    if provider_settings is None:
        return None, build_provider_summary(
            provider=provider,
            model="",
            text="",
            provider_response_available=False,
            error="provider not configured",
            error_type="ValueError",
        )
    ocr_client = online_ocr_clients.get(provider)
    if ocr_client is None:
        return None, build_provider_summary(
            provider=provider,
            model=provider_settings.model,
            text="",
            provider_response_available=False,
            error="client not configured",
            error_type="ValueError",
        )
    try:
        provider_result = _parse_registered_raw_asset(
            raw_asset_record=raw_asset_record,
            reader=reader,
            bucket=bucket,
            ocr_client=ocr_client,
        )
        plain_text = extract_provider_plain_text(
            provider=provider,
            provider_response_bytes=provider_result.provider_result_bytes,
        )
        return provider_result.provider_result_bytes, build_provider_summary(
            provider=provider,
            model=provider_settings.model,
            text=plain_text,
            provider_response_available=True,
            error=None,
            error_type=None,
            provider_metadata=provider_result.metadata,
        )
    except Exception as exc:
        return None, build_provider_summary(
            provider=provider,
            model=provider_settings.model,
            text="",
            provider_response_available=False,
            error=str(exc),
            error_type=type(exc).__name__,
        )


def _build_source_truth_only_routing_decision_payload(
    *,
    raw_asset_record: RawAssetRecord,
    initial_typed_metadata: RawAssetTypedMetadata,
    refined_asset_subkind: str,
    refined_confidence: float | None,
    refinement_reason_codes: tuple[str, ...],
    candidate_summary: dict[str, object],
    baseline_summary: dict[str, object],
    adjudication: dict[str, object],
    route_decision,
) -> bytes:
    payload = {
        "mode": "generic_image_dual_run_adjudication",
        "raw_asset_id": raw_asset_record.raw_asset_id,
        "raw_version_id": raw_asset_record.raw_version_id,
        "source_filename": raw_asset_record.source_filename,
        "initial_asset_typing": {
            "asset_kind": initial_typed_metadata.asset_kind,
            "asset_subkind": initial_typed_metadata.asset_subkind,
            "classification_confidence": initial_typed_metadata.classification_confidence,
        },
        "refined_asset_typing": {
            "asset_kind": "image",
            "asset_subkind": refined_asset_subkind,
            "classification_confidence": refined_confidence,
            "reason_codes": list(refinement_reason_codes),
        },
        "candidate": candidate_summary,
        "baseline": baseline_summary,
        "adjudication": adjudication,
        "routing_recommendation": {
            "route_id": route_decision.route_id,
            "canonical_allowed": route_decision.canonical_allowed,
            "canonical_provider": route_decision.canonical_provider,
            "fallback_provider": route_decision.fallback_provider,
            "parser_version": route_decision.parser_version,
            "reason_codes": list(route_decision.reason_codes),
            "persist_raw_provider_artifact": route_decision.persist_raw_provider_artifact,
        },
    }
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _execute_source_truth_only_generic_image_dual_run(
    *,
    settings: RawIngestionProcessSettings,
    raw_asset_record: RawAssetRecord,
    reader: ObjectStoreReader,
    bucket: str,
    online_ocr_clients: dict[str, OnlineOcrClient],
) -> SourceTruthOnlyOcrExecutionResult:
    paddle_provider = _resolve_route_provider(
        settings=settings,
        provider=ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    )
    mineru_provider = _resolve_route_provider(
        settings=settings,
        provider=ONLINE_OCR_PROVIDER_MINERU_API,
    )
    if paddle_provider is None or mineru_provider is None:
        raise RuntimeError(
            "both paddle and mineru providers are required for generic-image dual-run adjudication"
        )

    paddle_bytes, baseline_summary = _execute_source_truth_only_provider(
        settings=settings,
        raw_asset_record=raw_asset_record,
        reader=reader,
        bucket=bucket,
        provider=paddle_provider,
        online_ocr_clients=online_ocr_clients,
    )
    mineru_bytes, candidate_summary = _execute_source_truth_only_provider(
        settings=settings,
        raw_asset_record=raw_asset_record,
        reader=reader,
        bucket=bucket,
        provider=mineru_provider,
        online_ocr_clients=online_ocr_clients,
    )
    adjudication = build_adjudication(
        candidate_summary=candidate_summary,
        baseline_summary=baseline_summary,
    )
    initial_typed_metadata = _raw_asset_typed_metadata_from_record(raw_asset_record)
    refined_typing = refine_raw_asset_typed_metadata_with_ocr_evidence(
        typed_metadata=initial_typed_metadata,
        source_name=raw_asset_record.source_filename,
        candidate_summary=candidate_summary,
        baseline_summary=baseline_summary,
        adjudication=adjudication,
    )
    route_decision = select_adjudicated_image_routing(
        refined_asset_subkind=refined_typing.asset_subkind,
        candidate_summary=candidate_summary,
        baseline_summary=baseline_summary,
    )
    refined_raw_asset_record = replace(
        raw_asset_record,
        asset_kind=refined_typing.asset_kind,
        asset_subkind=refined_typing.asset_subkind,
        classification_confidence=refined_typing.classification_confidence,
    )
    routing_decision_bytes = _build_source_truth_only_routing_decision_payload(
        raw_asset_record=raw_asset_record,
        initial_typed_metadata=initial_typed_metadata,
        refined_asset_subkind=refined_typing.asset_subkind,
        refined_confidence=refined_typing.classification_confidence,
        refinement_reason_codes=refined_typing.reason_codes,
        candidate_summary=candidate_summary,
        baseline_summary=baseline_summary,
        adjudication=adjudication,
        route_decision=route_decision,
    )
    if not route_decision.canonical_allowed or route_decision.canonical_provider is None:
        raise SourceTruthOnlyOcrDeferredError(
            "raw asset is deferred for canonical OCR routing after dual-run adjudication: "
            f"route_id={route_decision.route_id}",
            routing_decision_bytes=routing_decision_bytes,
            refined_raw_asset_record=refined_raw_asset_record,
        )

    if route_decision.canonical_provider == ONLINE_OCR_PROVIDER_MINERU_API:
        if mineru_bytes is None:
            raise RuntimeError("mineru canonical provider was selected without provider bytes")
        provider_settings = _resolve_source_truth_only_ocr_settings_for_provider(
            settings=settings,
            provider=mineru_provider,
        )
        if provider_settings is None:  # pragma: no cover
            raise RuntimeError("mineru provider settings are required")
        normalized_mineru_result = _normalize_online_ocr_provider_result(
            provider=ONLINE_OCR_PROVIDER_MINERU_API,
            provider_result=OnlineOcrProviderResult(
                provider_result_bytes=mineru_bytes,
                raw_provider_artifacts=(
                    (
                        OnlineOcrRawArtifact(
                            filename=RAW_PROVIDER_RESPONSE_ARCHIVE_FILENAME,
                            content_type="application/zip",
                            data=mineru_bytes,
                        ),
                    )
                    if route_decision.persist_raw_provider_artifact
                    else ()
                ),
            ),
        )
        provider_response_bytes = normalized_mineru_result.provider_result_bytes
        raw_provider_artifacts = normalized_mineru_result.raw_provider_artifacts
        resolved_provider = mineru_provider
    else:
        if paddle_bytes is None:
            raise RuntimeError("paddle canonical provider was selected without provider bytes")
        provider_settings = _resolve_source_truth_only_ocr_settings_for_provider(
            settings=settings,
            provider=paddle_provider,
        )
        if provider_settings is None:  # pragma: no cover
            raise RuntimeError("paddle provider settings are required")
        provider_response_bytes = paddle_bytes
        raw_provider_artifacts = ()
        resolved_provider = paddle_provider

    layout_elements_bytes = _build_source_truth_layout_elements_bytes(
        collection=settings.collection,
        source_pdf=raw_asset_record.source_filename,
        raw_asset_id=raw_asset_record.raw_asset_id,
        provider_response_bytes=provider_response_bytes,
        ocr_provider=normalize_online_ocr_provider_label(resolved_provider),
        ocr_model=provider_settings.model,
    )
    return SourceTruthOnlyOcrExecutionResult(
        provider_response_bytes=provider_response_bytes,
        layout_elements_bytes=layout_elements_bytes,
        ocr_provider=normalize_online_ocr_provider_label(resolved_provider),
        ocr_model=provider_settings.model,
        raw_provider_artifacts=raw_provider_artifacts,
        routing_decision_bytes=routing_decision_bytes,
        refined_raw_asset_record=refined_raw_asset_record,
    )


def _execute_source_truth_only_routed_online_ocr(
    *,
    settings: RawIngestionProcessSettings,
    raw_asset_record: RawAssetRecord,
    reader: ObjectStoreReader,
    bucket: str,
    online_ocr_clients: dict[str, OnlineOcrClient],
) -> SourceTruthOnlyOcrExecutionResult:
    raw_asset_record = _ensure_routable_raw_asset_record_typing(
        raw_asset_record=raw_asset_record,
        reader=reader,
        bucket=bucket,
    )
    if _needs_dual_run_image_adjudication(settings=settings, raw_asset_record=raw_asset_record):
        return _execute_source_truth_only_generic_image_dual_run(
            settings=settings,
            raw_asset_record=raw_asset_record,
            reader=reader,
            bucket=bucket,
            online_ocr_clients=online_ocr_clients,
        )

    route_decision = select_online_ocr_routing(
        asset_kind=raw_asset_record.asset_kind,
        asset_subkind=raw_asset_record.asset_subkind,
        mineru_available=_has_route_provider(
            settings=settings, provider=ONLINE_OCR_PROVIDER_MINERU_API
        ),
    )
    if not route_decision.canonical_allowed or route_decision.canonical_provider is None:
        raise ValueError(
            f"raw asset is deferred for canonical OCR routing: route_id={route_decision.route_id}"
        )

    providers_to_try = [route_decision.canonical_provider]
    if (
        route_decision.fallback_provider
        and route_decision.fallback_provider not in providers_to_try
    ):
        providers_to_try.append(route_decision.fallback_provider)

    errors: list[str] = []
    for route_provider in providers_to_try:
        provider = _resolve_route_provider(settings=settings, provider=route_provider)
        if provider is None:
            errors.append(f"{route_provider}: provider not configured")
            continue
        provider_settings = _resolve_source_truth_only_ocr_settings_for_provider(
            settings=settings,
            provider=provider,
        )
        if provider_settings is None:
            errors.append(f"{provider}: provider not configured")
            continue
        ocr_client = online_ocr_clients.get(provider)
        if ocr_client is None:
            errors.append(f"{provider}: client not configured")
            continue
        try:
            provider_result = _parse_registered_raw_asset(
                raw_asset_record=raw_asset_record,
                reader=reader,
                bucket=bucket,
                ocr_client=ocr_client,
            )
            provider_response_bytes = provider_result.provider_result_bytes
            if provider == ONLINE_OCR_PROVIDER_MINERU_API:
                provider_result = OnlineOcrProviderResult(
                    provider_result_bytes=provider_result.provider_result_bytes,
                    metadata=provider_result.metadata,
                    raw_provider_artifacts=(
                        provider_result.raw_provider_artifacts
                        if route_decision.persist_raw_provider_artifact
                        else ()
                    ),
                )
                provider_result = _normalize_online_ocr_provider_result(
                    provider=provider,
                    provider_result=provider_result,
                )
                provider_response_bytes = provider_result.provider_result_bytes
                raw_provider_artifacts = provider_result.raw_provider_artifacts
            else:
                raw_provider_artifacts = ()
            layout_elements_bytes = _build_source_truth_layout_elements_bytes(
                collection=settings.collection,
                source_pdf=raw_asset_record.source_filename,
                raw_asset_id=raw_asset_record.raw_asset_id,
                provider_response_bytes=provider_response_bytes,
                ocr_provider=normalize_online_ocr_provider_label(provider),
                ocr_model=provider_settings.model,
            )
            return SourceTruthOnlyOcrExecutionResult(
                provider_response_bytes=provider_response_bytes,
                layout_elements_bytes=layout_elements_bytes,
                ocr_provider=normalize_online_ocr_provider_label(provider),
                ocr_model=provider_settings.model,
                raw_provider_artifacts=raw_provider_artifacts,
                refined_raw_asset_record=raw_asset_record,
            )
        except Exception as exc:
            errors.append(f"{provider}: {exc}")

    raise RuntimeError(
        f"source-truth-only OCR routing failed for {raw_asset_record.source_filename}: "
        + " | ".join(errors)
    )


def _persist_source_truth_only_ocr_results(
    *,
    settings: RawIngestionProcessSettings,
    writer: ObjectStoreWriter,
    reader: ObjectStoreReader,
    online_ocr_clients: dict[str, OnlineOcrClient],
    raw_asset_registry: RawAssetRegistry,
    raw_asset_record: RawAssetRecord,
) -> ImportReport:
    success_count = 0
    failed_count = 0
    raw_uploaded_count = 0
    raw_reused_count = (
        1
        if raw_asset_registry.get(raw_asset_record.raw_asset_id, raw_asset_record.raw_version_id)
        else 0
    )
    errors: list[str] = []
    timestamp = utc_now()
    try:
        execution = _execute_source_truth_only_routed_online_ocr(
            settings=settings,
            raw_asset_record=raw_asset_record,
            reader=reader,
            bucket=settings.object_store.bucket_source,
            online_ocr_clients=online_ocr_clients,
        )
        if execution.refined_raw_asset_record is not None:
            raw_asset_record = execution.refined_raw_asset_record
            raw_asset_registry.upsert(raw_asset_record)
        _persist_source_truth_execution_sidecars(
            settings=settings,
            writer=writer,
            raw_asset_record=raw_asset_record,
            execution=execution,
        )
        provider_response_key = build_source_ocr_artifact_key(
            raw_asset_id=raw_asset_record.raw_asset_id,
            raw_version_id=raw_asset_record.raw_version_id,
            filename=PROVIDER_RESPONSE_FILENAME,
            model_slug=build_source_model_slug(execution.ocr_model),
            year=infer_year_label(raw_asset_record.source_filename),
        )
        writer.put_bytes(
            bucket=settings.object_store.bucket_source,
            key=provider_response_key,
            data=execution.provider_response_bytes,
            content_type="application/x-ndjson",
        )
        layout_elements_key = build_source_truth_artifact_key(
            raw_asset_id=raw_asset_record.raw_asset_id,
            raw_version_id=raw_asset_record.raw_version_id,
            filename=LAYOUT_ELEMENTS_FILENAME,
            year=infer_year_label(raw_asset_record.source_filename),
        )
        writer.put_bytes(
            bucket=settings.object_store.bucket_source,
            key=layout_elements_key,
            data=execution.layout_elements_bytes,
            content_type="application/x-ndjson",
        )
        success_count = 1
    except SourceTruthOnlyOcrDeferredError as exc:
        if exc.refined_raw_asset_record is not None:
            raw_asset_registry.upsert(exc.refined_raw_asset_record)
        if exc.routing_decision_bytes is not None:
            routing_decision_key = build_source_truth_artifact_key(
                raw_asset_id=raw_asset_record.raw_asset_id,
                raw_version_id=raw_asset_record.raw_version_id,
                filename=OCR_ROUTING_DECISION_FILENAME,
                year=infer_year_label(raw_asset_record.source_filename),
            )
            writer.put_bytes(
                bucket=settings.object_store.bucket_source,
                key=routing_decision_key,
                data=exc.routing_decision_bytes,
                content_type="application/json",
            )
        failed_count = 1
        errors.append(f"{raw_asset_record.object_key}: {exc}")
    except Exception as exc:
        failed_count = 1
        errors.append(f"{raw_asset_record.object_key}: {exc}")

    return write_import_report(
        import_mode="raw_ingestion",
        report_dir=settings.report_dir,
        report_prefix="process-raw-ingestion-job",
        success_count=success_count,
        skipped_count=0,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=(),
        unresolved_source_pdfs=(),
        errors=tuple(errors),
        timestamp=timestamp,
    )


def _persist_source_truth_execution_sidecars(
    *,
    settings: RawIngestionProcessSettings,
    writer: ObjectStoreWriter,
    raw_asset_record: RawAssetRecord,
    execution: SourceTruthOnlyOcrExecutionResult,
) -> None:
    if execution.routing_decision_bytes is not None:
        routing_decision_key = build_source_truth_artifact_key(
            raw_asset_id=raw_asset_record.raw_asset_id,
            raw_version_id=raw_asset_record.raw_version_id,
            filename=OCR_ROUTING_DECISION_FILENAME,
            year=infer_year_label(raw_asset_record.source_filename),
        )
        writer.put_bytes(
            bucket=settings.object_store.bucket_source,
            key=routing_decision_key,
            data=execution.routing_decision_bytes,
            content_type="application/json",
        )
    for raw_provider_artifact in execution.raw_provider_artifacts:
        raw_provider_response_key = build_source_ocr_artifact_key(
            raw_asset_id=raw_asset_record.raw_asset_id,
            raw_version_id=raw_asset_record.raw_version_id,
            filename=raw_provider_artifact.filename,
            model_slug=build_source_model_slug(execution.ocr_model),
            year=infer_year_label(raw_asset_record.source_filename),
        )
        writer.put_bytes(
            bucket=settings.object_store.bucket_source,
            key=raw_provider_response_key,
            data=raw_provider_artifact.data,
            content_type=raw_provider_artifact.content_type,
        )


__all__ = (
    "_execute_source_truth_only_routed_online_ocr",
    "_persist_source_truth_execution_sidecars",
    "_persist_source_truth_only_ocr_results",
)
