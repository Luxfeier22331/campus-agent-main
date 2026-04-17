from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from campus_ingestion_core.authenticated_notice_closeout_models import (
    CloseoutRunState,
    utc_now,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    _build_registry_record,
)
from campus_ingestion_core.models import DocumentRegistryRecord


_CLOSEOUT_READY_STATES = frozenset({CloseoutRunState.VERIFIED, CloseoutRunState.DONE})


@dataclass(frozen=True, slots=True)
class CloseoutRunDocumentRecordPair:
    staged_record: DocumentRegistryRecord
    final_record: DocumentRegistryRecord


def load_verified_closeout_run_document_record_pairs(
    *,
    run_id: str,
    closeout_store: CloseoutStore,
    expected_corpus: str,
    expected_collection: str,
) -> tuple[CloseoutRunDocumentRecordPair, ...]:
    run = closeout_store.get_run(run_id)
    if run is None:
        raise ValueError(f"closeout run not found: {run_id}")
    if (run.corpus, run.collection) != (expected_corpus, expected_collection):
        raise ValueError(
            "closeout run scope does not match requested preparation scope: "
            f"{run.corpus}/{run.collection} vs {expected_corpus}/{expected_collection}"
        )
    if run.state not in _CLOSEOUT_READY_STATES:
        raise ValueError(
            f"closeout run must be verified before chunk validation/preparation: {run_id} ({run.state.value})"
        )
    staged_documents = closeout_store.get_staged_documents(run_id)
    if not staged_documents:
        raise ValueError(f"no staged documents found for closeout run: {run_id}")
    pairs: list[CloseoutRunDocumentRecordPair] = []
    for staged_document in staged_documents:
        staged_record = build_registry_record_from_staged_document(
            staged_document,
            artifact_source="staged",
        )
        final_record = build_registry_record_from_staged_document(
            staged_document,
            artifact_source="final",
        )
        if (staged_record.corpus, staged_record.collection) != (
            expected_corpus,
            expected_collection,
        ):
            raise ValueError(
                "staged document scope does not match requested preparation scope: "
                f"{staged_record.document_id} -> {staged_record.corpus}/{staged_record.collection}"
            )
        pairs.append(
            CloseoutRunDocumentRecordPair(
                staged_record=staged_record,
                final_record=final_record,
            )
        )
    return tuple(sorted(pairs, key=lambda item: _record_key(item.final_record)))


def build_registry_record_from_staged_document(
    staged_document: dict[str, Any],
    *,
    artifact_source: Literal["staged", "final"] = "final",
) -> DocumentRegistryRecord:
    document_payload = dict(staged_document["document"])
    staged_object_keys = {
        str(key): str(value)
        for key, value in dict(staged_document.get("staged_object_keys") or {}).items()
        if value is not None
    }
    final_object_keys = {
        str(key): str(value)
        for key, value in dict(staged_document.get("final_object_keys") or {}).items()
        if value is not None
    }
    artifact_keys = staged_object_keys if artifact_source == "staged" else final_object_keys
    if "document_units" not in artifact_keys:
        raise ValueError(
            f"staged document is missing {artifact_source} document_units key: "
            f"{document_payload.get('document_id')!r}"
        )
    document_stub = _document_import_from_stage_payload(document_payload)
    provider_response_key = artifact_keys.get("provider_response") or document_stub.provider_response_object_key
    layout_elements_key = artifact_keys.get("layout_elements") or document_stub.layout_elements_object_key
    canonical_markdown_key = artifact_keys.get("canonical_markdown")
    return _build_registry_record(
        document_id=str(document_payload["document_id"]),
        version_id=str(document_payload["version_id"]),
        metadata=dict(document_stub.metadata),
        content_hash=str(staged_document["content_hash"]),
        document=document_stub,
        default_visibility_scope=document_stub.visibility_scope,
        parser_version=str(document_payload["parser_version"]),
        embedding_model=str(document_payload["embedding_model"]),
        cleaning_policy_version=str(document_payload["cleaning_policy_version"]),
        raw_asset=None,
        document_units_key=str(artifact_keys["document_units"]),
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        canonical_markdown_key=canonical_markdown_key,
        processed_object_keys=_resolve_processed_object_keys(
            artifact_source=artifact_source,
            artifact_keys=artifact_keys,
            document_payload=document_payload,
        ),
        timestamp=utc_now(),
    )


def _resolve_processed_object_keys(
    *,
    artifact_source: Literal["staged", "final"],
    artifact_keys: dict[str, str],
    document_payload: dict[str, Any],
) -> tuple[str, ...]:
    if artifact_source == "staged":
        values = [
            artifact_keys.get("document_units"),
            artifact_keys.get("provider_response"),
            artifact_keys.get("layout_elements"),
            artifact_keys.get("canonical_markdown"),
            *[
                str(item)
                for item in document_payload.get("additional_processed_object_keys") or ()
            ],
        ]
    else:
        values = [
            *[str(item) for item in document_payload.get("processed_object_keys") or ()],
            *[
                str(item)
                for item in document_payload.get("additional_processed_object_keys") or ()
            ],
        ]
        if not values:
            values = [
                artifact_keys.get("document_units"),
                artifact_keys.get("provider_response"),
                artifact_keys.get("layout_elements"),
                artifact_keys.get("canonical_markdown"),
            ]
    return tuple(dict.fromkeys(value for value in values if value))


def _document_import_from_stage_payload(payload: dict[str, Any]) -> DocumentImportInput:
    return DocumentImportInput(
        source_label=str(payload["source_label"]),
        document_units_bytes=b"",
        provider_response_bytes=None,
        canonical_markdown_bytes=None,
        metadata=dict(payload["metadata"]),
        import_source=str(payload["import_source"]),
        revision_track=str(payload["revision_track"]),
        source_channel=str(payload["source_channel"]),
        is_current=bool(payload.get("is_current", False)),
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
        visibility_scope=(
            None if payload.get("visibility_scope") is None else str(payload["visibility_scope"])
        ),
        status=str(payload.get("status") or "active"),
        raw_source_uri=(
            None if payload.get("raw_source_uri") is None else str(payload["raw_source_uri"])
        ),
        raw_asset_id=(
            None if payload.get("raw_asset_id") is None else str(payload["raw_asset_id"])
        ),
        raw_version_id=(
            None if payload.get("raw_version_id") is None else str(payload["raw_version_id"])
        ),
        provider_response_object_key=(
            None
            if payload.get("provider_response_object_key") is None
            else str(payload["provider_response_object_key"])
        ),
        layout_elements_object_key=(
            None
            if payload.get("layout_elements_object_key") is None
            else str(payload["layout_elements_object_key"])
        ),
        additional_processed_object_keys=tuple(
            str(item) for item in payload.get("additional_processed_object_keys") or ()
        ),
        title=None if payload.get("title") is None else str(payload["title"]),
        year=None if payload.get("year") is None else str(payload["year"]),
    )


def _record_key(record: DocumentRegistryRecord) -> tuple[str, str, str]:
    return (record.document_id, record.revision_track, record.version_id)


__all__ = [
    "CloseoutRunDocumentRecordPair",
    "build_registry_record_from_staged_document",
    "load_verified_closeout_run_document_record_pairs",
]
