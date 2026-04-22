from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ImportReport,
    ObjectStoreWriter,
    persist_import_documents,
)
from campus_ingestion_core.collection_source_ocr import resolve_collection_source_ocr_runtime
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.raw_ingestion_online_ocr import (
    DEFAULT_ONLINE_OCR_MODEL,
    DEFAULT_ONLINE_OCR_PROVIDER,
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrClient,
    OnlineOcrProviderResult,
    OnlineOcrSettings,
    build_online_ocr_client,
    normalize_online_ocr_provider_label,
    parse_online_ocr_bytes,
)
from campus_ingestion_core.raw_ingestion_source_truth_execution import (
    _execute_source_truth_only_routed_online_ocr,
    _persist_source_truth_execution_sidecars,
    _persist_source_truth_only_ocr_results,
)
from campus_ingestion_core.raw_ingestion_source_truth_support import (
    DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
    ObjectStoreReader,
    S3ObjectStoreClient,
    _default_raw_ingestion_parser_version,
    _resolve_online_ocr_clients,
    _resolve_registered_raw_asset,
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
from campus_ingestion_core.split_manifest import load_split_manifest

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
    ) -> RawIngestionProcessSettings:
        source = env if env is not None else os.environ
        profile = load_runtime_profile(request.corpus, request.collection)
        source_ocr_runtime = resolve_collection_source_ocr_runtime(profile=profile)
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
        if (
            source_ocr_runtime.provider == ONLINE_OCR_PROVIDER_MINERU_API
            and online_ocr.provider != ONLINE_OCR_PROVIDER_MINERU_API
            and mineru_online_ocr is None
        ):
            raise ValueError(
                f"{request.corpus}/{request.collection} requires MinerU OCR configuration"
            )
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
            parser_version=source_ocr_runtime.parser_version,
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
    raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    writer = object_store or S3ObjectStoreClient(settings.object_store)
    if not hasattr(writer, "get_bytes"):
        raise TypeError("object_store must support get_bytes for process_raw_ingestion_job")
    resolved_online_ocr_clients = _resolve_online_ocr_clients(
        settings=settings,
        online_ocr=online_ocr,
        online_ocr_clients=online_ocr_clients,
    )
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
    parser_version = settings.parser_version
    try:
        execution = _execute_source_truth_only_routed_online_ocr(
            settings=settings,
            raw_asset_record=raw_asset_record,
            reader=writer,  # type: ignore[arg-type]
            bucket=settings.object_store.bucket_source,
            online_ocr_clients=resolved_online_ocr_clients,
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
        provider_result = OnlineOcrProviderResult(
            provider_result_bytes=execution.provider_response_bytes,
            raw_provider_artifacts=execution.raw_provider_artifacts,
        )
        execution_ocr_provider = normalize_online_ocr_provider_label(execution.ocr_provider)
        parser_version = _default_raw_ingestion_parser_version(execution.ocr_provider)

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
                ocr_provider=execution_ocr_provider,
                ocr_model=execution.ocr_model,
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
                    ocr_provider=execution_ocr_provider,
                    ocr_model=execution.ocr_model,
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
        parser_version=parser_version,
        embedding_model=settings.embedding_model,
        cleaning_policy_version=settings.cleaning_policy_version,
        default_visibility_scope=settings.default_visibility_scope,
        import_mode="raw_ingestion",
        report_dir=settings.report_dir,
        report_prefix="process-raw-ingestion-job",
        initial_errors=errors,
    )
