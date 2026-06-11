from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.campusrag_ingestion_support import DocumentImportInput
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.raw_ingestion_online_ocr import OnlineOcrProviderResult
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import SplitManifest

COLLECTION_REPLAY_UNSUPPORTED_ERROR = "provider_response_replay is not registered for collection"


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
ProviderReplayNormalizer = Callable[
    [str, bytes, str, str, str], tuple[list[dict[str, object]], bytes]
]
ProviderReplayDocumentBuilder = Callable[["ReplayDocumentBuildContext"], list[DocumentImportInput]]


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
class ReplayDocumentBuildContext:
    source: dict[str, str]
    collection_config: object
    split_manifest: SplitManifest
    corpus: str
    collection: str
    source_pdf: str
    raw_asset_id: str
    raw_version_id: str
    provider_response_key: str
    layout_elements_key: str
    structured_rows: list[dict[str, object]]
    reader: CollectionIngestionReader | None
    source_bucket: str | None
    replay_raw_asset_record: RawAssetRecord | None


@dataclass(frozen=True, slots=True)
class CollectionIngestionStrategy:
    strategy_name: str
    supports_raw_split_manifest: bool
    supports_provider_response_replay: bool
    build_raw_split_manifest_documents: RawSplitManifestBuilder | None = None
    normalize_provider_response_for_replay: ProviderReplayNormalizer | None = None
    build_provider_replay_documents: ProviderReplayDocumentBuilder | None = None
    default_replay_source_pdf: str | None = None
    provider_replay_qdrant_targets: tuple[tuple[str, str], ...] = ()
    delete_primary_registry_scope_for_provider_replay: bool = True
    preserve_source_provider_response_on_cleanup: bool = False

    def require_raw_split_manifest(self) -> RawSplitManifestBuilder:
        if not self.supports_raw_split_manifest or self.build_raw_split_manifest_documents is None:
            raise ValueError(
                f"raw split-manifest ingestion is not registered for strategy {self.strategy_name}"
            )
        return self.build_raw_split_manifest_documents

    def require_provider_response_replay(self) -> ProviderReplayDocumentBuilder:
        if (
            not self.supports_provider_response_replay
            or self.normalize_provider_response_for_replay is None
            or self.build_provider_replay_documents is None
        ):
            raise ValueError(f"{COLLECTION_REPLAY_UNSUPPORTED_ERROR}: {self.strategy_name}")
        return self.build_provider_replay_documents

    def require_provider_response_normalizer(self) -> ProviderReplayNormalizer:
        self.require_provider_response_replay()
        if self.normalize_provider_response_for_replay is None:
            raise ValueError(f"{COLLECTION_REPLAY_UNSUPPORTED_ERROR}: {self.strategy_name}")
        return self.normalize_provider_response_for_replay


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


def _normalize_student_rules_provider_response(
    source_pdf: str,
    provider_response_bytes: bytes,
    ocr_provider: str,
    ocr_model: str,
    raw_asset_id: str,
) -> tuple[list[dict[str, object]], bytes]:
    from campus_ingestion_core.handbook_provider_normalize import (
        normalize_handbook_provider_result,
        serialize_handbook_layout_elements,
    )

    structured_rows = normalize_handbook_provider_result(
        source_pdf=source_pdf,
        provider_jsonl_bytes=provider_response_bytes,
        ocr_provider=ocr_provider,
        ocr_model=ocr_model,
        source_artifact_id=raw_asset_id,
    )
    return structured_rows, serialize_handbook_layout_elements(structured_rows)


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


def _build_student_rules_provider_replay_documents(
    context: ReplayDocumentBuildContext,
) -> list[DocumentImportInput]:
    from campus_ingestion_core.handbook_source_projections import (
        build_handbook_projection_import_documents,
    )
    from campus_ingestion_core.local_rebuild_documents import (
        _build_handbook_replay_document_input,
    )

    documents = [
        _build_handbook_replay_document_input(
            source_label=f"{context.provider_response_key}#{manifest_document.document_id}",
            source_doc=context.source_pdf,
            manifest_document=manifest_document,
            structured_rows=context.structured_rows,
            provider_response_key=context.provider_response_key,
            layout_elements_key=context.layout_elements_key,
            corpus=context.corpus,
            collection=context.collection,
        )
        for manifest_document in context.split_manifest.documents
    ]
    raw_asset_ref = _build_replay_raw_asset_record(
        raw_asset_id=context.raw_asset_id,
        raw_version_id=context.raw_version_id,
        corpus=context.corpus,
        collection=context.collection,
        source_pdf=context.source_pdf,
        provider_response_key=context.provider_response_key,
    )
    documents.extend(
        build_handbook_projection_import_documents(
            source=context.source,
            config_path=getattr(context.collection_config, "source_projections_path", None),
            raw_asset_record=raw_asset_ref,
            hybrid_raw_asset_record=context.replay_raw_asset_record,
            provider_response_key=context.provider_response_key,
            layout_elements_key=context.layout_elements_key,
            structured_rows=context.structured_rows,
            split_manifest_documents=context.split_manifest.documents,
            reader=context.reader,
            source_bucket=context.source_bucket,
            import_source="provider_response_replay",
        )
    )
    return documents


def _build_curriculum_provider_replay_documents(
    context: ReplayDocumentBuildContext,
) -> list[DocumentImportInput]:
    from campus_ingestion_core.local_rebuild_support import _read_default_visibility_scope
    from campus_ingestion_core.raw_ingestion_split_manifest import (
        _build_split_manifest_document_input,
    )
    from campus_ingestion_core.raw_ingestion_split_manifest_curriculum import (
        CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
        build_curriculum_projection_documents,
    )

    raw_asset_ref = _build_replay_raw_asset_record(
        raw_asset_id=context.raw_asset_id,
        raw_version_id=context.raw_version_id,
        corpus=context.corpus,
        collection=context.collection,
        source_pdf=context.source_pdf,
        provider_response_key=context.provider_response_key,
    )
    default_visibility_scope = _read_default_visibility_scope(context.source)
    documents = [
        _build_split_manifest_document_input(
            raw_asset_record=raw_asset_ref,
            manifest_version=context.split_manifest.manifest_version,
            manifest_document=manifest_document,
            structured_rows=context.structured_rows,
            provider_response_key=context.provider_response_key,
            layout_elements_key=context.layout_elements_key,
            default_visibility_scope=default_visibility_scope,
            corpus=context.corpus,
            collection=context.collection,
            row_policy=CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
        )
        for manifest_document in context.split_manifest.documents
    ]
    documents.extend(
        build_curriculum_projection_documents(
            raw_asset_record=raw_asset_ref,
            source_pdf=context.source_pdf,
            split_manifest_documents=context.split_manifest.documents,
            structured_rows=context.structured_rows,
            provider_response_key=context.provider_response_key,
            layout_elements_key=context.layout_elements_key,
            import_source="provider_response_replay",
        )
    )
    return documents


def _build_replay_raw_asset_record(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    corpus: str,
    collection: str,
    source_pdf: str,
    provider_response_key: str,
) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus=corpus,
        collection=collection,
        raw_source_uri=f"campusrag://source/{corpus}/{raw_asset_id}/{raw_version_id}",
        content_hash=raw_version_id.removeprefix("sha256:") or raw_version_id,
        source_filename=source_pdf,
        object_key=provider_response_key,
        ingestion_timestamp="1970-01-01T00:00:00+00:00",
        import_source="provider_response_replay",
    )


_DEFAULT_COLLECTION_INGESTION_STRATEGY = CollectionIngestionStrategy(
    strategy_name="default_split_manifest_ingestion_v1",
    supports_raw_split_manifest=True,
    supports_provider_response_replay=False,
    build_raw_split_manifest_documents=_build_default_raw_split_manifest_documents,
)

_COLLECTION_INGESTION_STRATEGIES: dict[tuple[str, str], CollectionIngestionStrategy] = {
    ("regulations", "student_rules"): CollectionIngestionStrategy(
        strategy_name="student_rules_ingestion_v1",
        supports_raw_split_manifest=True,
        supports_provider_response_replay=True,
        build_raw_split_manifest_documents=_build_student_rules_raw_split_manifest_documents,
        normalize_provider_response_for_replay=_normalize_student_rules_provider_response,
        build_provider_replay_documents=_build_student_rules_provider_replay_documents,
        default_replay_source_pdf="学生手册_2018.pdf",
        delete_primary_registry_scope_for_provider_replay=False,
        preserve_source_provider_response_on_cleanup=True,
    ),
    ("curriculum", "curriculum_plan"): CollectionIngestionStrategy(
        strategy_name="curriculum_plan_ingestion_v1",
        supports_raw_split_manifest=True,
        supports_provider_response_replay=True,
        build_raw_split_manifest_documents=_build_curriculum_raw_split_manifest_documents,
        normalize_provider_response_for_replay=_normalize_curriculum_provider_response,
        build_provider_replay_documents=_build_curriculum_provider_replay_documents,
        default_replay_source_pdf="curriculum-plan.pdf",
        provider_replay_qdrant_targets=(
            ("curriculum", "course_facts"),
            ("curriculum", "program_family_facts"),
            ("curriculum", "program_semester_facts"),
        ),
    ),
}

__all__ = (
    "COLLECTION_REPLAY_UNSUPPORTED_ERROR",
    "CollectionIngestionStrategy",
    "RawSplitManifestBuildContext",
    "ReplayDocumentBuildContext",
    "resolve_collection_ingestion_strategy",
)
