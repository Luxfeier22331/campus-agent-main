from __future__ import annotations

import json
import os
from dataclasses import dataclass, replace
from pathlib import Path

from campus_ingestion_core.artifacts import (
    LAYOUT_ELEMENTS_FILENAME,
    OCR_ROUTING_DECISION_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ImportReport,
    ObjectStoreWriter,
    persist_import_documents,
    utc_now,
    write_import_report,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.file_asset_routing import (
    RAW_PROVIDER_RESPONSE_ARCHIVE_FILENAME,
    RawAssetTypedMetadata,
    adapt_mineru_archive_to_canonical_provider_payload,
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
    DEFAULT_ONLINE_OCR_MODEL,
    DEFAULT_ONLINE_OCR_PROVIDER,
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrClient,
    OnlineOcrRawArtifact,
    OnlineOcrProviderResult,
    OnlineOcrSettings,
    build_online_ocr_client,
    normalize_online_ocr_provider_label,
    parse_online_ocr_bytes,
)
from campus_ingestion_core.raw_ingestion_source_truth_support import (
    DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
    ObjectStoreReader,
    S3ObjectStoreClient,
    SourceTruthOnlyOcrDeferredError,
    SourceTruthOnlyOcrExecutionResult,
    _build_source_truth_layout_elements_bytes,
    _default_raw_ingestion_parser_version,
    _has_route_provider,
    _needs_dual_run_image_adjudication,
    _normalize_online_ocr_provider_result,
    _parse_registered_raw_asset,
    _raw_asset_typed_metadata_from_record,
    _resolve_online_ocr_clients,
    _resolve_registered_raw_asset,
    _resolve_route_provider,
    _resolve_source_truth_only_ocr_settings_for_provider,
)
from campus_ingestion_core.raw_ingestion_split_manifest import (
    _build_handbook_split_manifest_documents,
    _build_split_manifest_document_input,
    _build_split_manifest_documents,
    _load_layout_elements_rows,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.scope_catalog import assert_known_scope
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import (
    load_split_manifest,
)

DEFAULT_RAW_INGESTION_ARTIFACT_MODE = "normalized"
ALLOWED_RAW_INGESTION_ARTIFACT_MODES = ("normalized", "source_truth_only")

__all__ = (
    "DEFAULT_ONLINE_OCR_MODEL",
    "DEFAULT_ONLINE_OCR_PROVIDER",
    "DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION",
    "ONLINE_OCR_PROVIDER_ASYNC_JOBS",
    "ONLINE_OCR_PROVIDER_MINERU_API",
    "OnlineOcrClient",
    "OnlineOcrProviderResult",
    "OnlineOcrSettings",
    "RawIngestionProcessSettings",
    "RawIngestionRequest",
    "S3ObjectStoreClient",
    "_build_split_manifest_document_input",
    "_load_layout_elements_rows",
    "build_online_ocr_client",
    "normalize_online_ocr_provider_label",
    "parse_online_ocr_bytes",
    "process_raw_ingestion_job",
)


@dataclass(frozen=True, slots=True)
class RawIngestionRequest:
    raw_asset_id: str
    raw_version_id: str
    corpus: str
    collection: str
    artifact_mode: str = DEFAULT_RAW_INGESTION_ARTIFACT_MODE
    split_manifest_path: Path | None = None
    report_dir: Path = Path("./var/import-reports")
    default_visibility_scope: str | None = None

    def __post_init__(self) -> None:
        if not self.raw_asset_id:
            raise ValueError("raw_asset_id is required")
        if not self.raw_version_id:
            raise ValueError("raw_version_id is required")
        assert_known_scope(self.corpus, self.collection)
        if self.artifact_mode not in ALLOWED_RAW_INGESTION_ARTIFACT_MODES:
            raise ValueError(f"unsupported artifact_mode: {self.artifact_mode}")


@dataclass(frozen=True, slots=True)
class RawIngestionProcessSettings:
    raw_asset_id: str
    raw_version_id: str
    report_dir: Path
    corpus: str
    collection: str
    artifact_mode: str
    split_manifest_path: Path | None
    parser_version: str
    embedding_model: str
    cleaning_policy_version: str
    default_visibility_scope: str | None
    online_ocr: OnlineOcrSettings
    mineru_online_ocr: OnlineOcrSettings | None
    object_store: ObjectStoreSettings

    @classmethod
    def from_request(
        cls,
        request: RawIngestionRequest,
        env: dict[str, str] | None = None,
    ) -> "RawIngestionProcessSettings":
        source = env if env is not None else os.environ
        profile = load_runtime_profile(request.corpus, request.collection)
        online_ocr = OnlineOcrSettings.from_env(source, required=True)
        if online_ocr is None:
            raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
        mineru_online_ocr = OnlineOcrSettings.from_env(
            source,
            prefix="OCR_MINERU_",
            default_provider=ONLINE_OCR_PROVIDER_MINERU_API,
        )
        if (
            mineru_online_ocr is not None
            and mineru_online_ocr.provider != ONLINE_OCR_PROVIDER_MINERU_API
        ):
            raise ValueError("OCR_MINERU_PROVIDER_MODE must resolve to mineru_api")
        if request.artifact_mode not in profile.allowed_artifact_modes:
            raise ValueError(
                f"{request.corpus}/{request.collection} does not support artifact_mode={request.artifact_mode}"
            )
        if request.artifact_mode == "source_truth_only" and request.split_manifest_path is not None:
            raise ValueError("source_truth_only does not support split manifest ingestion")
        if (
            request.artifact_mode != "source_truth_only"
            and profile.split_manifest_required
            and request.split_manifest_path is None
        ):
            raise ValueError(
                f"split_manifest_path is required for {request.corpus}/{request.collection} raw ingestion"
            )
        return cls(
            raw_asset_id=request.raw_asset_id,
            raw_version_id=request.raw_version_id,
            report_dir=request.report_dir,
            corpus=request.corpus,
            collection=request.collection,
            artifact_mode=request.artifact_mode,
            split_manifest_path=request.split_manifest_path,
            parser_version=_default_raw_ingestion_parser_version(online_ocr.provider),
            embedding_model=(
                source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or ""
            ).strip(),
            cleaning_policy_version=profile.cleaning_policy_version,
            default_visibility_scope=request.default_visibility_scope,
            online_ocr=online_ocr,
            mineru_online_ocr=mineru_online_ocr,
            object_store=ObjectStoreSettings.from_env(source),
        )


def process_raw_ingestion_job(
    *,
    request: RawIngestionRequest,
    env: dict[str, str] | None = None,
    object_store: ObjectStoreWriter | ObjectStoreReader | None = None,
    online_ocr: OnlineOcrClient | None = None,
    online_ocr_clients: dict[str, OnlineOcrClient] | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> ImportReport:
    source = dict(env if env is not None else os.environ)
    settings = RawIngestionProcessSettings.from_request(request, source)
    ocr_provider = normalize_online_ocr_provider_label(settings.online_ocr.provider)
    raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    writer = object_store or S3ObjectStoreClient(settings.object_store)
    if not hasattr(writer, "get_bytes"):
        raise TypeError("object_store must support get_bytes for process_raw_ingestion_job")
    resolved_online_ocr_clients = _resolve_online_ocr_clients(
        settings=settings,
        online_ocr=online_ocr,
        online_ocr_clients=online_ocr_clients,
    )
    ocr_client = resolved_online_ocr_clients[settings.online_ocr.provider]
    raw_asset_record = _resolve_registered_raw_asset(
        settings=settings, raw_asset_registry=raw_asset_registry
    )
    if settings.artifact_mode == "source_truth_only":
        return _persist_source_truth_only_ocr_results(
            settings=settings,
            writer=writer,
            reader=writer,  # type: ignore[arg-type]
            online_ocr_clients=resolved_online_ocr_clients,
            raw_asset_registry=raw_asset_registry,
            raw_asset_record=raw_asset_record,
        )

    registry = registry or build_document_registry_from_env(source)
    split_manifest = (
        load_split_manifest(
            settings.split_manifest_path,
            expected_corpus=settings.corpus,
            expected_collection=settings.collection,
        )
        if settings.split_manifest_path is not None
        else None
    )
    if split_manifest is None:
        raise ValueError(
            "INGESTION_SPLIT_MANIFEST_PATH is required for "
            f"{settings.corpus}/{settings.collection} raw ingestion"
        )
    if split_manifest.raw_asset_id != raw_asset_record.raw_asset_id:
        raise ValueError(
            "split manifest raw_asset_id mismatch: "
            f"expected {raw_asset_record.raw_asset_id}, got {split_manifest.raw_asset_id}"
        )

    documents: list[DocumentImportInput] = []
    errors: list[str] = []
    try:
        provider_result = _parse_registered_raw_asset(
            raw_asset_record=raw_asset_record,
            reader=writer,  # type: ignore[arg-type]
            bucket=settings.object_store.bucket_source,
            ocr_client=ocr_client,
        )
        provider_result = _normalize_online_ocr_provider_result(
            provider=settings.online_ocr.provider,
            provider_result=provider_result,
        )

        if settings.collection == "student_rules":
            handbook_documents, handbook_errors = _build_handbook_split_manifest_documents(
                raw_asset_record=raw_asset_record,
                provider_result=provider_result,
                split_manifest=split_manifest,
                writer=writer,
                reader=writer,  # type: ignore[arg-type]
                object_store=settings.object_store,
                default_visibility_scope=settings.default_visibility_scope,
                corpus=settings.corpus,
                collection=settings.collection,
                ocr_provider=ocr_provider,
                ocr_model=settings.online_ocr.model,
                source=source,
            )
            documents.extend(handbook_documents)
            errors.extend(handbook_errors)
        else:
            documents.extend(
                _build_split_manifest_documents(
                    raw_asset_record=raw_asset_record,
                    provider_result=provider_result,
                    split_manifest=split_manifest,
                    writer=writer,
                    object_store=settings.object_store,
                    default_visibility_scope=settings.default_visibility_scope,
                    corpus=settings.corpus,
                    collection=settings.collection,
                    ocr_provider=ocr_provider,
                    ocr_model=settings.online_ocr.model,
                )
            )
    except Exception as exc:
        errors.append(f"{raw_asset_record.object_key}: {exc}")

    return persist_import_documents(
        documents=documents,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        writer=writer,
        object_store=settings.object_store,
        parser_version=settings.parser_version,
        embedding_model=settings.embedding_model,
        cleaning_policy_version=settings.cleaning_policy_version,
        default_visibility_scope=settings.default_visibility_scope,
        import_mode="raw_ingestion",
        report_dir=settings.report_dir,
        report_prefix="process-raw-ingestion-job",
        initial_errors=errors,
    )


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
            raw_asset_registry.upsert(execution.refined_raw_asset_record)
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
