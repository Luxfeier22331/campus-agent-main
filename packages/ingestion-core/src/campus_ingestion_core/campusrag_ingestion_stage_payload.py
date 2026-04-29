from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from campus_ingestion_core.campusrag_ingestion_artifacts import (
    build_document_processed_object_keys,
    parse_document_import_stub,
)
from campus_ingestion_core.models import DocumentRegistryRecord


def build_registry_record_from_stage_payload(
    stage_payload: Mapping[str, object],
    *,
    artifact_source: Literal["staged", "final"] = "final",
    timestamp: str | None = None,
) -> DocumentRegistryRecord:
    from campus_ingestion_core.campusrag_ingestion_support import _build_registry_record, utc_now

    document_payload = dict(stage_payload["document"])
    staged_object_keys = {
        str(key): str(value)
        for key, value in dict(stage_payload.get("staged_object_keys") or {}).items()
        if value is not None
    }
    final_object_keys = {
        str(key): str(value)
        for key, value in dict(stage_payload.get("final_object_keys") or {}).items()
        if value is not None
    }
    artifact_keys = staged_object_keys if artifact_source == "staged" else final_object_keys
    if "document_units" not in artifact_keys:
        raise ValueError(
            f"staged document is missing {artifact_source} document_units key: "
            f"{document_payload.get('document_id')!r}"
        )
    document_stub = parse_document_import_stub(document_payload)
    provider_response_key = (
        artifact_keys.get("provider_response") or document_stub.provider_response_object_key
    )
    layout_elements_key = (
        artifact_keys.get("layout_elements") or document_stub.layout_elements_object_key
    )
    canonical_markdown_key = artifact_keys.get("canonical_markdown")
    return _build_registry_record(
        document_id=str(document_payload["document_id"]),
        version_id=str(document_payload["version_id"]),
        metadata=dict(document_stub.metadata),
        content_hash=str(stage_payload["content_hash"]),
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
        processed_object_keys=_resolve_stage_payload_processed_object_keys(
            artifact_source=artifact_source,
            artifact_keys=artifact_keys,
            document_payload=document_payload,
        ),
        timestamp=timestamp or utc_now(),
    )


def _resolve_stage_payload_processed_object_keys(
    *,
    artifact_source: Literal["staged", "final"],
    artifact_keys: Mapping[str, str],
    document_payload: Mapping[str, object],
) -> tuple[str, ...]:
    if artifact_source == "staged":
        return build_document_processed_object_keys(
            document_units_key=artifact_keys.get("document_units"),
            provider_response_key=artifact_keys.get("provider_response"),
            layout_elements_key=artifact_keys.get("layout_elements"),
            canonical_markdown_key=artifact_keys.get("canonical_markdown"),
            additional_keys=(
                str(item) for item in document_payload.get("additional_processed_object_keys") or ()
            ),
        )
    values = [
        *[str(item) for item in document_payload.get("processed_object_keys") or ()],
        *[str(item) for item in document_payload.get("additional_processed_object_keys") or ()],
    ]
    if values:
        return build_document_processed_object_keys(additional_keys=values)
    return build_document_processed_object_keys(
        document_units_key=artifact_keys.get("document_units"),
        provider_response_key=artifact_keys.get("provider_response"),
        layout_elements_key=artifact_keys.get("layout_elements"),
        canonical_markdown_key=artifact_keys.get("canonical_markdown"),
    )
