from __future__ import annotations

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import is_source_object_key
from campus_ingestion_core.settings import ObjectStoreSettings


def artifact_bucket_for_key(*, object_store: ObjectStoreSettings, key: str) -> str:
    if is_source_object_key(key):
        return object_store.bucket_source
    return object_store.bucket_derived


def registry_record_needs_refresh(
    *,
    existing: DocumentRegistryRecord,
    document_units_bytes: bytes,
    document_units_key: str,
    provider_response_bytes: bytes | None,
    provider_response_key: str | None,
    layout_elements_bytes: bytes | None,
    layout_elements_key: str | None,
    canonical_markdown_bytes: bytes | None,
    canonical_markdown_key: str | None,
    processed_object_keys: tuple[str, ...],
    writer: object,
    object_store: ObjectStoreSettings,
) -> bool:
    if existing.document_units_object_key != document_units_key:
        return True
    if existing.provider_response_object_key != provider_response_key:
        return True
    if existing.layout_elements_object_key != layout_elements_key:
        return True
    if existing.canonical_markdown_object_key != canonical_markdown_key:
        return True
    if tuple(existing.processed_object_keys) != processed_object_keys:
        return True
    if missing_processed_object_keys(
        writer=writer,
        object_store=object_store,
        object_keys=processed_object_keys,
    ):
        return True
    if stored_artifact_payload_differs(
        writer=writer,
        object_store=object_store,
        key=document_units_key,
        expected_bytes=document_units_bytes,
    ):
        return True
    if stored_artifact_payload_differs(
        writer=writer,
        object_store=object_store,
        key=provider_response_key,
        expected_bytes=provider_response_bytes,
    ):
        return True
    if stored_artifact_payload_differs(
        writer=writer,
        object_store=object_store,
        key=layout_elements_key,
        expected_bytes=layout_elements_bytes,
    ):
        return True
    return stored_artifact_payload_differs(
        writer=writer,
        object_store=object_store,
        key=canonical_markdown_key,
        expected_bytes=canonical_markdown_bytes,
    )


def missing_processed_object_keys(
    *,
    writer: object,
    object_store: ObjectStoreSettings,
    object_keys: tuple[str, ...],
) -> bool:
    get_bytes = getattr(writer, "get_bytes", None)
    if not callable(get_bytes):
        return False
    for key in object_keys:
        try:
            get_bytes(bucket=artifact_bucket_for_key(object_store=object_store, key=key), key=key)
        except Exception:
            return True
    return False


def stored_artifact_payload_differs(
    *,
    writer: object,
    object_store: ObjectStoreSettings,
    key: str | None,
    expected_bytes: bytes | None,
) -> bool:
    if key is None or expected_bytes is None:
        return False
    get_bytes = getattr(writer, "get_bytes", None)
    if not callable(get_bytes):
        return False
    try:
        stored_bytes = get_bytes(
            bucket=artifact_bucket_for_key(object_store=object_store, key=key),
            key=key,
        )
    except Exception:
        return True
    return stored_bytes != expected_bytes
