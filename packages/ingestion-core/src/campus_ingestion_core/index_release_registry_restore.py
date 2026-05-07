from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.models import DocumentRegistryRecord, SourceObservation

_SHA256_VERSION_RE = re.compile(r"^sha256:(?P<hash>[0-9a-f]{64})(?::|$)")


class RestoreRegistry(Protocol):
    def get(
        self,
        document_id: str,
        revision_track: str,
        version_id: str,
    ) -> DocumentRegistryRecord | None: ...

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None: ...


@dataclass(frozen=True, slots=True)
class IndexReleaseRegistryRestoreReport:
    corpus: str
    collection: str
    release_id: str
    manifest_document_count: int
    payload_document_count: int
    candidate_count: int
    restored_count: int
    skipped_existing_count: int
    execute: bool
    restored_document_ids: tuple[str, ...]
    skipped_existing_document_ids: tuple[str, ...]


def build_restored_registry_records_from_release_payloads(
    *,
    corpus: str,
    collection: str,
    release_manifest_payload: Mapping[str, object],
    release_payloads: Sequence[Mapping[str, object]],
    import_source: str = "index_release_registry_restore",
    ingestion_timestamp: str | None = None,
) -> tuple[DocumentRegistryRecord, ...]:
    release_id = _required_text(release_manifest_payload, "release_id")
    if _required_text(release_manifest_payload, "corpus") != corpus:
        raise ValueError(f"release manifest corpus does not match restore scope: {release_id}")
    if _required_text(release_manifest_payload, "collection") != collection:
        raise ValueError(f"release manifest collection does not match restore scope: {release_id}")

    payload_by_document_key = _payload_by_document_key(release_payloads)
    restored: list[DocumentRegistryRecord] = []
    for document_ref in _manifest_document_refs(release_manifest_payload):
        key = _document_key(document_ref)
        payload = payload_by_document_key.get(key)
        if payload is None:
            raise ValueError(
                "missing release payload for manifest document "
                f"{key[0]}@{key[2]} in release {release_id}"
            )
        restored.append(
            _record_from_release_payload(
                corpus=corpus,
                collection=collection,
                document_ref=document_ref,
                payload=payload,
                release_manifest_payload=release_manifest_payload,
                import_source=import_source,
                ingestion_timestamp=ingestion_timestamp,
            )
        )
    return tuple(restored)


def restore_registry_scope_from_index_release_payloads(
    *,
    corpus: str,
    collection: str,
    release_manifest_payload: Mapping[str, object],
    release_payloads: Sequence[Mapping[str, object]],
    registry: RestoreRegistry,
    execute: bool = False,
    import_source: str = "index_release_registry_restore",
    ingestion_timestamp: str | None = None,
) -> IndexReleaseRegistryRestoreReport:
    records = build_restored_registry_records_from_release_payloads(
        corpus=corpus,
        collection=collection,
        release_manifest_payload=release_manifest_payload,
        release_payloads=release_payloads,
        import_source=import_source,
        ingestion_timestamp=ingestion_timestamp,
    )
    missing: list[DocumentRegistryRecord] = []
    existing_document_ids: list[str] = []
    for record in records:
        existing = registry.get(record.document_id, record.revision_track, record.version_id)
        if existing is None:
            missing.append(record)
            continue
        existing_document_ids.append(record.document_id)
    if execute and missing:
        registry.upsert_many(tuple(missing))
    return IndexReleaseRegistryRestoreReport(
        corpus=corpus,
        collection=collection,
        release_id=_required_text(release_manifest_payload, "release_id"),
        manifest_document_count=len(_manifest_document_refs(release_manifest_payload)),
        payload_document_count=len({_document_key(payload) for payload in release_payloads}),
        candidate_count=len(records),
        restored_count=len(missing) if execute else 0,
        skipped_existing_count=len(existing_document_ids),
        execute=execute,
        restored_document_ids=tuple(record.document_id for record in missing),
        skipped_existing_document_ids=tuple(existing_document_ids),
    )


def _record_from_release_payload(
    *,
    corpus: str,
    collection: str,
    document_ref: Mapping[str, object],
    payload: Mapping[str, object],
    release_manifest_payload: Mapping[str, object],
    import_source: str,
    ingestion_timestamp: str | None,
) -> DocumentRegistryRecord:
    document_id = _required_text(document_ref, "document_id")
    revision_track = _required_text(document_ref, "revision_track")
    version_id = _required_text(document_ref, "version_id")
    source_uri = _first_text(payload, ("source_uri", "canonical_url", "latest_url"))
    source_channel = _required_text(payload, "source_channel")
    document_units_object_key = _required_text(document_ref, "document_units_object_key")
    normalized_ingestion_timestamp = (
        ingestion_timestamp
        or _optional_text(release_manifest_payload, "indexed_at")
        or datetime.now(UTC).isoformat()
    )
    content_hash = _content_hash_from_ref_or_version(document_ref, version_id)
    cleaning_policy_version = (
        _optional_text(payload, "cleaning_policy_version")
        or _optional_text(release_manifest_payload, "cleaning_policy_version")
    )
    parser_version = _required_text(payload, "parser_version")
    embedding_model = (
        _optional_text(payload, "embedding_model")
        or _optional_text(release_manifest_payload, "embedding_model")
    )
    visibility_level = _optional_text(payload, "visibility_level")
    entitlement_groups = _text_tuple(payload.get("entitlement_groups"))
    visibility_scope = _optional_text(payload, "visibility_scope")
    processed_object_keys = tuple(
        key
        for key in (
            document_units_object_key,
            _optional_sibling_key(document_units_object_key, "canonical.md"),
            _optional_sibling_key(document_units_object_key, "provider-response.jsonl"),
            _optional_sibling_key(
                document_units_object_key,
                "reader-assets/asset-manifest.json",
            ),
            _optional_sibling_key(document_units_object_key, "reader-assets/meta.json"),
            _optional_sibling_key(document_units_object_key, "reader-assets/outline.json"),
            _optional_sibling_key(document_units_object_key, "reader-assets/reader.json"),
        )
        if key
    )
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=revision_track,
        version_id=version_id,
        source_uri=source_uri,
        content_hash=content_hash,
        corpus=corpus,
        collection=collection,
        cleaning_policy_version=cleaning_policy_version,
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        visibility_level=visibility_level,
        policy_projection_version=(
            _optional_text(payload, "policy_projection_version")
            or DEFAULT_POLICY_PROJECTION_VERSION
        ),
        status=_optional_text(payload, "status") or "active",
        ingestion_timestamp=normalized_ingestion_timestamp,
        parser_version=parser_version,
        embedding_model=embedding_model,
        source_channel=source_channel,
        is_current=_bool(payload.get("is_current"), default=True),
        effective_date=_optional_text(payload, "effective_date"),
        published_date=_optional_text(payload, "published_date")
        or _optional_text(payload, "source_notice_release_time"),
        provenance_status=_optional_text(payload, "provenance_status"),
        source_observations=(
            SourceObservation(
                source_channel=source_channel,
                source_uri=source_uri,
                is_primary=True,
                import_source=import_source,
            ),
        ),
        document_units_object_key=document_units_object_key,
        canonical_markdown_object_key=_optional_sibling_key(
            document_units_object_key,
            "canonical.md",
        ),
        provider_response_object_key=_optional_sibling_key(
            document_units_object_key,
            "provider-response.jsonl",
        ),
        processed_object_keys=processed_object_keys,
        import_source=import_source,
    )


def _payload_by_document_key(
    payloads: Sequence[Mapping[str, object]],
) -> dict[tuple[str, str, str], Mapping[str, object]]:
    by_key: dict[tuple[str, str, str], Mapping[str, object]] = {}
    for payload in payloads:
        key = _document_key(payload)
        if key in by_key:
            continue
        by_key[key] = payload
    return by_key


def _manifest_document_refs(
    release_manifest_payload: Mapping[str, object],
) -> tuple[Mapping[str, object], ...]:
    documents = release_manifest_payload.get("documents")
    if not isinstance(documents, Sequence) or isinstance(documents, (str, bytes)):
        raise ValueError("release manifest documents must be an array")
    return tuple(_mapping(document, "release manifest document") for document in documents)


def _document_key(raw: Mapping[str, object]) -> tuple[str, str, str]:
    return (
        _required_text(raw, "document_id"),
        _required_text(raw, "revision_track"),
        _required_text(raw, "version_id"),
    )


def _content_hash_from_ref_or_version(
    document_ref: Mapping[str, object],
    version_id: str,
) -> str:
    explicit = _optional_text(document_ref, "content_hash")
    if explicit:
        return explicit.removeprefix("sha256:")
    match = _SHA256_VERSION_RE.match(version_id)
    if match:
        return match.group("hash")
    raise ValueError(f"unable to derive content_hash from version_id: {version_id}")


def _optional_sibling_key(document_units_object_key: str, filename: str) -> str | None:
    if not document_units_object_key.endswith("document-units.jsonl"):
        return None
    return f"{document_units_object_key[: -len('document-units.jsonl')]}{filename}"


def _mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _required_text(raw: Mapping[str, object], field_name: str) -> str:
    value = _optional_text(raw, field_name)
    if not value:
        raise ValueError(f"{field_name} is required")
    return value


def _optional_text(raw: Mapping[str, object], field_name: str) -> str:
    value = raw.get(field_name)
    return str(value).strip() if value is not None else ""


def _first_text(raw: Mapping[str, object], field_names: Sequence[str]) -> str:
    for field_name in field_names:
        value = _optional_text(raw, field_name)
        if value:
            return value
    raise ValueError(f"one of {', '.join(field_names)} is required")


def _text_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        stripped = value.strip()
        return (stripped,) if stripped else ()
    if not isinstance(value, Sequence):
        return ()
    return tuple(str(item).strip() for item in value if str(item).strip())


def _bool(value: object, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


__all__ = [
    "IndexReleaseRegistryRestoreReport",
    "build_restored_registry_records_from_release_payloads",
    "restore_registry_scope_from_index_release_payloads",
]
