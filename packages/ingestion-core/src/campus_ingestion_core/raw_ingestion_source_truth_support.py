from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result
from campus_ingestion_core.file_asset_routing import (
    MINERU_ADAPTED_PARSER_VERSION,
    PADDLE_PARSER_VERSION,
    RAW_PROVIDER_RESPONSE_ARCHIVE_FILENAME,
    RawAssetTypedMetadata,
    adapt_mineru_archive_to_canonical_provider_payload,
    infer_raw_asset_typed_metadata,
)
from campus_ingestion_core.handbook_provider_normalize import (
    normalize_handbook_provider_result,
    serialize_handbook_layout_elements,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.raw_ingestion_online_ocr import (
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrClient,
    OnlineOcrProviderResult,
    OnlineOcrRawArtifact,
    OnlineOcrSettings,
    build_online_ocr_client,
    parse_online_ocr_bytes,
)
from campus_ingestion_core.settings import ObjectStoreSettings

DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION = PADDLE_PARSER_VERSION


class ObjectStoreReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class _RawAssetRegistryProtocol(Protocol):
    def get(self, raw_asset_id: str, raw_version_id: str) -> RawAssetRecord | None: ...


class _SourceTruthSettingsProtocol(Protocol):
    raw_asset_id: str
    raw_version_id: str
    corpus: str
    collection: str
    source_ocr_provider: str
    source_ocr_fallback_enabled: bool
    source_ocr_image_routing_strategy: str | None
    online_ocr: OnlineOcrSettings
    mineru_online_ocr: OnlineOcrSettings | None


@dataclass(frozen=True, slots=True)
class SourceTruthOnlyOcrExecutionResult:
    provider_response_bytes: bytes
    layout_elements_bytes: bytes
    ocr_provider: str
    ocr_model: str
    raw_provider_artifacts: tuple[OnlineOcrRawArtifact, ...] = ()
    routing_decision_bytes: bytes | None = None
    refined_raw_asset_record: RawAssetRecord | None = None


class SourceTruthOnlyOcrDeferredError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        routing_decision_bytes: bytes | None,
        refined_raw_asset_record: RawAssetRecord | None,
    ) -> None:
        super().__init__(message)
        self.routing_decision_bytes = routing_decision_bytes
        self.refined_raw_asset_record = refined_raw_asset_record


def _resolve_online_ocr_clients(
    *,
    settings: _SourceTruthSettingsProtocol,
    online_ocr: OnlineOcrClient | None,
    online_ocr_clients: dict[str, OnlineOcrClient] | None,
) -> dict[str, OnlineOcrClient]:
    resolved = dict(online_ocr_clients or {})
    if settings.online_ocr.provider not in resolved:
        resolved[settings.online_ocr.provider] = online_ocr or build_online_ocr_client(
            settings.online_ocr
        )
    if (
        settings.mineru_online_ocr is not None
        and settings.mineru_online_ocr.provider not in resolved
    ):
        resolved[settings.mineru_online_ocr.provider] = build_online_ocr_client(
            settings.mineru_online_ocr
        )
    return resolved


def _resolve_source_truth_only_ocr_settings_for_provider(
    *,
    settings: _SourceTruthSettingsProtocol,
    provider: str,
) -> OnlineOcrSettings | None:
    if provider == settings.online_ocr.provider:
        return settings.online_ocr
    if settings.mineru_online_ocr is not None and provider == settings.mineru_online_ocr.provider:
        return settings.mineru_online_ocr
    return None


def _resolve_route_provider(
    *,
    settings: _SourceTruthSettingsProtocol,
    provider: str,
) -> str | None:
    if provider == ONLINE_OCR_PROVIDER_MINERU_API:
        if settings.online_ocr.provider == ONLINE_OCR_PROVIDER_MINERU_API:
            return settings.online_ocr.provider
        if settings.mineru_online_ocr is not None:
            return settings.mineru_online_ocr.provider
        return None
    if provider == ONLINE_OCR_PROVIDER_ASYNC_JOBS:
        if settings.online_ocr.provider != ONLINE_OCR_PROVIDER_MINERU_API:
            return settings.online_ocr.provider
        return None
    if (
        _resolve_source_truth_only_ocr_settings_for_provider(settings=settings, provider=provider)
        is not None
    ):
        return provider
    return None


def _has_route_provider(
    *,
    settings: _SourceTruthSettingsProtocol,
    provider: str,
) -> bool:
    return _resolve_route_provider(settings=settings, provider=provider) is not None


def _default_raw_ingestion_parser_version(provider: str) -> str:
    if provider == ONLINE_OCR_PROVIDER_MINERU_API:
        return MINERU_ADAPTED_PARSER_VERSION
    return DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION


def _normalize_online_ocr_provider_result(
    *,
    provider: str,
    provider_result: OnlineOcrProviderResult,
) -> OnlineOcrProviderResult:
    if provider != ONLINE_OCR_PROVIDER_MINERU_API:
        return provider_result
    if _looks_like_zip_archive(provider_result.provider_result_bytes):
        return OnlineOcrProviderResult(
            provider_result_bytes=adapt_mineru_archive_to_canonical_provider_payload(
                provider_result.provider_result_bytes
            ),
            metadata=provider_result.metadata,
            raw_provider_artifacts=provider_result.raw_provider_artifacts
            or (
                OnlineOcrRawArtifact(
                    filename=RAW_PROVIDER_RESPONSE_ARCHIVE_FILENAME,
                    content_type="application/zip",
                    data=provider_result.provider_result_bytes,
                ),
            ),
        )
    return OnlineOcrProviderResult(
        provider_result_bytes=provider_result.provider_result_bytes,
        metadata=provider_result.metadata,
        raw_provider_artifacts=provider_result.raw_provider_artifacts,
    )


def _build_source_truth_layout_elements_bytes(
    *,
    collection: str,
    source_pdf: str,
    raw_asset_id: str,
    provider_response_bytes: bytes,
    ocr_provider: str,
    ocr_model: str,
) -> bytes:
    if collection == "curriculum_plan":
        return normalize_curriculum_provider_result(
            provider_jsonl_bytes=provider_response_bytes,
            source_pdf=source_pdf,
            ocr_provider=ocr_provider,
            ocr_model=ocr_model,
        )
    if collection == "student_rules":
        return serialize_handbook_layout_elements(
            normalize_handbook_provider_result(
                source_pdf=source_pdf,
                provider_jsonl_bytes=provider_response_bytes,
                ocr_provider=ocr_provider,
                ocr_model=ocr_model,
                source_artifact_id=raw_asset_id,
            )
        )
    raise ValueError(
        f"source_truth_only OCR normalization does not support collection={collection}"
    )


def _needs_dual_run_image_adjudication(
    *,
    settings: _SourceTruthSettingsProtocol,
    raw_asset_record: RawAssetRecord,
) -> bool:
    return (
        (settings.source_ocr_image_routing_strategy or "default").strip().lower() == "default"
        and _has_route_provider(settings=settings, provider=ONLINE_OCR_PROVIDER_MINERU_API)
        and _has_route_provider(settings=settings, provider=ONLINE_OCR_PROVIDER_ASYNC_JOBS)
        and raw_asset_record.asset_kind.strip().lower() == "image"
        and raw_asset_record.asset_subkind.strip().lower() == "generic_image"
    )


def _raw_asset_typed_metadata_from_record(
    raw_asset_record: RawAssetRecord,
) -> RawAssetTypedMetadata:
    return RawAssetTypedMetadata(
        content_type=raw_asset_record.content_type,
        file_extension=raw_asset_record.file_extension,
        byte_size=raw_asset_record.byte_size or 0,
        page_count=raw_asset_record.page_count,
        image_width=raw_asset_record.image_width,
        image_height=raw_asset_record.image_height,
        asset_kind=raw_asset_record.asset_kind,
        asset_subkind=raw_asset_record.asset_subkind,
        classification_confidence=raw_asset_record.classification_confidence,
    )


def _ensure_routable_raw_asset_record_typing(
    *,
    raw_asset_record: RawAssetRecord,
    reader: ObjectStoreReader,
    bucket: str,
) -> RawAssetRecord:
    if raw_asset_record.asset_kind.strip() and raw_asset_record.asset_subkind.strip():
        return raw_asset_record
    source_name = (
        raw_asset_record.source_filename.strip()
        or Path(raw_asset_record.object_key).name
        or raw_asset_record.raw_asset_id
    )
    file_bytes = reader.get_bytes(bucket=bucket, key=raw_asset_record.object_key)
    typed_metadata = infer_raw_asset_typed_metadata(
        source_path=Path(source_name),
        file_bytes=file_bytes,
    )
    return replace(
        raw_asset_record,
        content_type=raw_asset_record.content_type or typed_metadata.content_type,
        file_extension=raw_asset_record.file_extension or typed_metadata.file_extension,
        byte_size=raw_asset_record.byte_size or typed_metadata.byte_size,
        page_count=(
            raw_asset_record.page_count
            if raw_asset_record.page_count is not None
            else typed_metadata.page_count
        ),
        image_width=(
            raw_asset_record.image_width
            if raw_asset_record.image_width is not None
            else typed_metadata.image_width
        ),
        image_height=(
            raw_asset_record.image_height
            if raw_asset_record.image_height is not None
            else typed_metadata.image_height
        ),
        asset_kind=raw_asset_record.asset_kind or typed_metadata.asset_kind,
        asset_subkind=raw_asset_record.asset_subkind or typed_metadata.asset_subkind,
        classification_confidence=(
            raw_asset_record.classification_confidence
            if raw_asset_record.classification_confidence is not None
            else typed_metadata.classification_confidence
        ),
    )


def _resolve_registered_raw_asset(
    *,
    settings: _SourceTruthSettingsProtocol,
    raw_asset_registry: _RawAssetRegistryProtocol,
) -> RawAssetRecord:
    record = raw_asset_registry.get(settings.raw_asset_id, settings.raw_version_id)
    if record is None:
        raise ValueError("registered raw asset not found")
    if record.corpus != settings.corpus:
        raise ValueError(
            f"registered raw asset corpus mismatch: expected {settings.corpus}, got {record.corpus}"
        )
    if record.collection != settings.collection:
        raise ValueError(
            "registered raw asset collection mismatch: "
            f"expected {settings.collection}, got {record.collection}"
        )
    return record


def _parse_registered_raw_asset(
    *,
    raw_asset_record: RawAssetRecord,
    reader: ObjectStoreReader,
    bucket: str,
    ocr_client: OnlineOcrClient,
) -> OnlineOcrProviderResult:
    file_bytes = reader.get_bytes(bucket=bucket, key=raw_asset_record.object_key)
    return parse_online_ocr_bytes(
        ocr_client=ocr_client,
        file_bytes=file_bytes,
        filename=raw_asset_record.source_filename,
        media_type=raw_asset_record.content_type,
        asset_subkind=raw_asset_record.asset_subkind,
    )


class S3ObjectStoreClient(S3ObjectStoreWriter):
    def __init__(self, settings: ObjectStoreSettings) -> None:
        super().__init__(settings)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()


def _looks_like_zip_archive(payload: bytes) -> bool:
    return len(payload) >= 4 and payload[:4] == b"PK\x03\x04"
