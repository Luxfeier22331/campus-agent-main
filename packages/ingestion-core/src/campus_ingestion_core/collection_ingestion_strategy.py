from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.campus_agent_ingestion_support import DocumentImportInput
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.raw_ingestion_online_ocr import OnlineOcrProviderResult
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import SplitManifest


class CollectionIngestionReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class CollectionIngestionWriter(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


RawSplitManifestBuilder = Callable[
    ["RawSplitManifestBuildContext"],
    tuple[list[DocumentImportInput], list[str]],
]


@dataclass(frozen=True, slots=True)
class RawSplitManifestBuildContext:
    raw_asset_record: RawAssetRecord
    provider_result: OnlineOcrProviderResult
    split_manifest: SplitManifest
    writer: CollectionIngestionWriter
    reader: CollectionIngestionReader
    object_store: ObjectStoreSettings
    default_visibility_scope: str | None
    corpus: str
    collection: str
    ocr_provider: str
    ocr_model: str
    source: dict[str, str]


@dataclass(frozen=True, slots=True)
class CollectionIngestionStrategy:
    strategy_name: str
    supports_raw_split_manifest: bool
    build_raw_split_manifest_documents: RawSplitManifestBuilder | None = None

    def require_raw_split_manifest(self) -> RawSplitManifestBuilder:
        if not self.supports_raw_split_manifest or self.build_raw_split_manifest_documents is None:
            raise ValueError(
                f"raw split-manifest ingestion is not registered for strategy {self.strategy_name}"
            )
        return self.build_raw_split_manifest_documents


def resolve_collection_ingestion_strategy(
    corpus: str,
    collection: str,
) -> CollectionIngestionStrategy:
    return _COLLECTION_INGESTION_STRATEGIES.get(
        (corpus, collection),
        _DEFAULT_COLLECTION_INGESTION_STRATEGY,
    )


def _build_default_raw_split_manifest_documents(
    context: RawSplitManifestBuildContext,
) -> tuple[list[DocumentImportInput], list[str]]:
    from campus_ingestion_core.raw_ingestion_split_manifest import (
        _build_split_manifest_documents,
    )

    return (
        _build_split_manifest_documents(
            raw_asset_record=context.raw_asset_record,
            provider_result=context.provider_result,
            split_manifest=context.split_manifest,
            writer=context.writer,
            object_store=context.object_store,
            default_visibility_scope=context.default_visibility_scope,
            corpus=context.corpus,
            collection=context.collection,
            ocr_provider=context.ocr_provider,
            ocr_model=context.ocr_model,
        ),
        [],
    )


def _build_student_rules_raw_split_manifest_documents(
    context: RawSplitManifestBuildContext,
) -> tuple[list[DocumentImportInput], list[str]]:
    from campus_ingestion_core.raw_ingestion_split_manifest_handbook import (
        build_handbook_split_manifest_documents,
    )

    return build_handbook_split_manifest_documents(
        raw_asset_record=context.raw_asset_record,
        provider_result=context.provider_result,
        split_manifest=context.split_manifest,
        writer=context.writer,
        reader=context.reader,
        object_store=context.object_store,
        default_visibility_scope=context.default_visibility_scope,
        corpus=context.corpus,
        collection=context.collection,
        ocr_provider=context.ocr_provider,
        ocr_model=context.ocr_model,
        source=context.source,
    )


def _build_curriculum_raw_split_manifest_documents(
    context: RawSplitManifestBuildContext,
) -> tuple[list[DocumentImportInput], list[str]]:
    from campus_ingestion_core.raw_ingestion_split_manifest import (
        _build_split_manifest_documents,
        _write_processed_asset_artifacts,
    )
    from campus_ingestion_core.raw_ingestion_split_manifest_curriculum import (
        CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
        build_curriculum_projection_documents,
    )

    structured_rows, layout_elements_bytes = _normalize_curriculum_provider_response(
        context.raw_asset_record.source_filename,
        context.provider_result.provider_result_bytes,
        context.ocr_provider,
        context.ocr_model,
        context.raw_asset_record.raw_asset_id,
    )
    provider_response_key, layout_elements_key = _write_processed_asset_artifacts(
        writer=context.writer,
        object_store=context.object_store,
        corpus=context.corpus,
        raw_asset_id=context.raw_asset_record.raw_asset_id,
        raw_version_id=context.raw_asset_record.raw_version_id,
        source_filename=context.raw_asset_record.source_filename,
        ocr_model=context.ocr_model,
        provider_response_bytes=context.provider_result.provider_result_bytes,
        layout_elements_bytes=layout_elements_bytes,
    )
    documents = _build_split_manifest_documents(
        raw_asset_record=context.raw_asset_record,
        provider_result=context.provider_result,
        split_manifest=context.split_manifest,
        writer=context.writer,
        object_store=context.object_store,
        default_visibility_scope=context.default_visibility_scope,
        corpus=context.corpus,
        collection=context.collection,
        ocr_provider=context.ocr_provider,
        ocr_model=context.ocr_model,
        structured_rows=structured_rows,
        artifact_keys=(provider_response_key, layout_elements_key),
        row_policy=CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
    )
    errors: list[str] = []
    try:
        documents.extend(
            build_curriculum_projection_documents(
                raw_asset_record=context.raw_asset_record,
                source_pdf=context.raw_asset_record.source_filename,
                split_manifest_documents=context.split_manifest.documents,
                structured_rows=structured_rows,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
                import_source="raw_online_ocr",
            )
        )
    except Exception as exc:
        errors.append(f"{context.raw_asset_record.object_key}#curriculum-projections: {exc}")
    return documents, errors


def _normalize_curriculum_provider_response(
    source_pdf: str,
    provider_response_bytes: bytes,
    ocr_provider: str,
    ocr_model: str,
    raw_asset_id: str,
) -> tuple[list[dict[str, object]], bytes]:
    del raw_asset_id
    from campus_ingestion_core.curriculum_provider_normalize import (
        normalize_curriculum_provider_result,
    )
    from campus_ingestion_core.raw_ingestion_split_manifest import _load_layout_elements_rows

    layout_elements_bytes = normalize_curriculum_provider_result(
        provider_jsonl_bytes=provider_response_bytes,
        source_pdf=source_pdf,
        ocr_provider=ocr_provider,
        ocr_model=ocr_model,
    )
    return _load_layout_elements_rows(layout_elements_bytes), layout_elements_bytes


_DEFAULT_COLLECTION_INGESTION_STRATEGY = CollectionIngestionStrategy(
    strategy_name="default_split_manifest_ingestion_v1",
    supports_raw_split_manifest=True,
    build_raw_split_manifest_documents=_build_default_raw_split_manifest_documents,
)

_COLLECTION_INGESTION_STRATEGIES: dict[tuple[str, str], CollectionIngestionStrategy] = {
    ("regulations", "student_rules"): CollectionIngestionStrategy(
        strategy_name="student_rules_ingestion_v1",
        supports_raw_split_manifest=True,
        build_raw_split_manifest_documents=_build_student_rules_raw_split_manifest_documents,
    ),
    ("curriculum", "curriculum_plan"): CollectionIngestionStrategy(
        strategy_name="curriculum_plan_ingestion_v1",
        supports_raw_split_manifest=True,
        build_raw_split_manifest_documents=_build_curriculum_raw_split_manifest_documents,
    ),
}

__all__ = (
    "CollectionIngestionStrategy",
    "RawSplitManifestBuildContext",
    "resolve_collection_ingestion_strategy",
)
