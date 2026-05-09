from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_operations_artifact_key
from campus_ingestion_core.registry_scope_chunk_preparation_models import (
    REGISTRY_SCOPE_CHUNK_PREPARATION_OPERATION,
    RegistryScopePreparationObjectStore,
)
from campus_ingestion_core.registry_scope_chunk_provenance import hash_bytes
from campus_ingestion_core.registry_scope_common import record_label


def _build_preparation_artifact_key(
    *,
    corpus: str,
    collection: str,
    preparation_run_id: str,
    filename: str,
) -> str:
    return build_operations_artifact_key(
        corpus=corpus,
        operation=REGISTRY_SCOPE_CHUNK_PREPARATION_OPERATION,
        run_id=preparation_run_id,
        filename=filename,
        segments=(collection,),
    )


def _record_key(record: DocumentRegistryRecord) -> tuple[str, str, str]:
    return (record.document_id, record.revision_track, record.version_id)


def _hash_values(values: Sequence[str] | Any) -> str:
    digest = hashlib.sha256()
    for value in sorted(str(item) for item in values):
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _hash_document_units_bytes(
    *,
    object_store: RegistryScopePreparationObjectStore,
    bucket: str,
    record: DocumentRegistryRecord,
) -> str:
    if not record.document_units_object_key:
        return ""
    return hash_bytes(object_store.get_bytes(bucket=bucket, key=record.document_units_object_key))


def _assert_current_cleaning_provenance(
    *,
    record: DocumentRegistryRecord,
    runtime_cleaning_policy_version: str,
    document_units_bytes: bytes,
) -> None:
    if record.corpus != "regulations" or record.collection not in {
        "institutional_rules",
        "scoped_rules",
    }:
        return
    rows = _document_unit_payloads(document_units_bytes)
    if not rows:
        raise ValueError(f"{record_label(record)} has no document-units rows")
    for row in rows:
        metadata = row.get("metadata")
        if not isinstance(metadata, Mapping):
            raise ValueError(f"{record_label(record)} is missing document-units metadata")
        normalizer_version = str(metadata.get("normalizer_version") or "")
        if normalizer_version not in _allowed_regulation_normalizer_versions(record=record):
            raise ValueError(
                "canonical cleaning provenance failed for "
                f"{record_label(record)}: normalizer_version must be "
                f"one of {_allowed_regulation_normalizer_versions(record=record)}"
            )
        quality = metadata.get("normalization_quality")
        if isinstance(quality, str):
            quality = {"quality_verdict": quality}
        if (
            not isinstance(quality, Mapping)
            or str(quality.get("quality_verdict") or "") != "passed"
        ):
            raise ValueError(
                "canonical cleaning provenance failed for "
                f"{record_label(record)}: normalization quality must be passed"
            )
        metadata_cleaning_policy = str(
            metadata.get("cleaning_policy_version")
            or quality.get("cleaning_policy_version")
            or record.cleaning_policy_version
        )
        if metadata_cleaning_policy != runtime_cleaning_policy_version:
            raise ValueError(
                "canonical cleaning provenance failed for "
                f"{record_label(record)}: cleaning policy must match runtime profile"
            )


def _allowed_regulation_normalizer_versions(*, record: DocumentRegistryRecord) -> tuple[str, ...]:
    return (REGULATION_CANONICAL_NORMALIZER_VERSION,)


def _document_unit_payloads(document_units_bytes: bytes) -> tuple[Mapping[str, Any], ...]:
    rows: list[Mapping[str, Any]] = []
    for line in document_units_bytes.decode("utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, Mapping):
            raise ValueError("document-units row must be a JSON object")
        rows.append(payload)
    return tuple(rows)
