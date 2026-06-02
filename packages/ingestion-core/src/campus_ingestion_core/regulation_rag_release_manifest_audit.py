from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Protocol

from campus_regulation_semantics.answer_ready_evidence_contract import (
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
)

from campus_ingestion_core.index_release import load_index_release_manifest
from campus_ingestion_core.regulation_rag_release_admission import (
    load_regulation_rag_release_admission_manifest,
)


class RegulationRagReleaseManifestAuditReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


_RELEASE_REQUIRED_FIELDS: tuple[str, ...] = (
    "release_id",
    "corpus",
    "collection",
    "physical_collection_name",
    "serving_alias",
    "document_count",
    "point_count",
    "validation_status",
    "retrieval_acceptance_status",
    "release_admission_manifest_key",
    "release_admission_status",
    "component_eval_status",
    "post_publish_audit_status",
    "published_at",
)

_ADMISSION_REQUIRED_FIELDS: tuple[str, ...] = (
    "schema_version",
    "policy_version",
    "admission_run_id",
    "corpus",
    "collection",
    "admission_status",
    "admitted_at",
    "document_count",
    "answer_ready_contract_version",
    "answer_ready_contract_status",
    "semantic_oracle_status",
)


def audit_regulation_rag_release_manifests(
    *,
    reader: RegulationRagReleaseManifestAuditReader,
    bucket: str,
    corpus: str,
    collection: str,
    release_id: str,
) -> dict[str, object]:
    release_manifest = load_index_release_manifest(
        reader=reader,
        bucket=bucket,
        corpus=corpus,
        collection=collection,
        release_id=release_id,
    )
    release_manifest_key = f"{corpus}/releases/{collection}/{release_id}/index-release.json"
    release_field_map = _presence_map(
        {
            "release_id": release_manifest.release_id,
            "corpus": release_manifest.corpus,
            "collection": release_manifest.collection,
            "physical_collection_name": release_manifest.physical_collection_name,
            "serving_alias": release_manifest.serving_alias,
            "document_count": release_manifest.document_count,
            "point_count": release_manifest.point_count,
            "validation_status": release_manifest.validation_status,
            "retrieval_acceptance_status": release_manifest.retrieval_acceptance_status,
            "release_admission_manifest_key": release_manifest.release_admission_manifest_key,
            "release_admission_status": release_manifest.release_admission_status,
            "component_eval_status": release_manifest.component_eval_status,
            "post_publish_audit_status": release_manifest.post_publish_audit_status,
            "published_at": release_manifest.published_at,
        },
        required_fields=_RELEASE_REQUIRED_FIELDS,
    )
    release_missing_fields = _missing_fields(release_field_map)
    admission_manifest_key = (
        str(release_manifest.release_admission_manifest_key or "").strip() or None
    )
    if admission_manifest_key is None:
        admission_field_map = _presence_map({}, required_fields=_ADMISSION_REQUIRED_FIELDS)
        admission_missing_fields = list(_ADMISSION_REQUIRED_FIELDS)
        admission_summary: dict[str, object] = {}
        cross_check_issues = ["release_admission_manifest_key_missing"]
    else:
        admission_manifest = load_regulation_rag_release_admission_manifest(
            reader=reader,
            bucket=bucket,
            object_key=admission_manifest_key,
        )
        admission_field_map = _presence_map(
            {
                "schema_version": admission_manifest.schema_version,
                "policy_version": admission_manifest.policy_version,
                "admission_run_id": admission_manifest.admission_run_id,
                "corpus": admission_manifest.corpus,
                "collection": admission_manifest.collection,
                "admission_status": admission_manifest.admission_status,
                "admitted_at": admission_manifest.admitted_at,
                "document_count": admission_manifest.document_count,
                "answer_ready_contract_version": admission_manifest.answer_ready_contract_version,
                "answer_ready_contract_status": admission_manifest.answer_ready_contract_status,
                "semantic_oracle_status": admission_manifest.semantic_oracle_status,
            },
            required_fields=_ADMISSION_REQUIRED_FIELDS,
        )
        admission_missing_fields = _missing_fields(admission_field_map)
        admission_summary = {
            "answer_ready_contract_version": admission_manifest.answer_ready_contract_version,
            "answer_ready_contract_status": admission_manifest.answer_ready_contract_status,
            "semantic_oracle_status": admission_manifest.semantic_oracle_status,
            "document_ids": [document.document_id for document in admission_manifest.documents],
            "version_ids": [document.version_id for document in admission_manifest.documents],
        }
        cross_check_issues = _cross_check_issues(
            release_corpus=release_manifest.corpus,
            release_collection=release_manifest.collection,
            release_document_ids=[document.document_id for document in release_manifest.documents],
            release_version_ids=[document.version_id for document in release_manifest.documents],
            published_at=release_manifest.published_at,
            admission_corpus=admission_manifest.corpus,
            admission_collection=admission_manifest.collection,
            admission_document_ids=[
                document.document_id for document in admission_manifest.documents
            ],
            admission_version_ids=[
                document.version_id for document in admission_manifest.documents
            ],
            admitted_at=admission_manifest.admitted_at,
            answer_ready_contract_version=admission_manifest.answer_ready_contract_version,
        )
    release_status = "passed" if not release_missing_fields else "failed"
    admission_status = "passed" if not admission_missing_fields else "failed"
    cross_check_status = "passed" if not cross_check_issues else "failed"
    overall_status = (
        "passed"
        if release_status == "passed"
        and admission_status == "passed"
        and cross_check_status == "passed"
        else "failed"
    )
    return {
        "schema_version": "regulation_rag_release_manifest_field_audit.v1",
        "overall_status": overall_status,
        "corpus": corpus,
        "collection": collection,
        "release_id": release_id,
        "release_manifest_object_key": release_manifest_key,
        "admission_manifest_object_key": admission_manifest_key,
        "release_manifest_status": release_status,
        "admission_manifest_status": admission_status,
        "cross_check_status": cross_check_status,
        "release_manifest_missing_fields": release_missing_fields,
        "admission_manifest_missing_fields": admission_missing_fields,
        "cross_check_issues": cross_check_issues,
        "release_manifest_fields": release_field_map,
        "admission_manifest_fields": admission_field_map,
        "admission_manifest_summary": admission_summary,
    }


def _presence_map(
    values: Mapping[str, object],
    *,
    required_fields: Sequence[str],
) -> dict[str, dict[str, object]]:
    result: dict[str, dict[str, object]] = {}
    for field in required_fields:
        value = values.get(field)
        result[field] = {
            "present": _has_value(value),
            "value": value,
        }
    return result


def _missing_fields(field_map: Mapping[str, Mapping[str, object]]) -> list[str]:
    return [field for field, payload in field_map.items() if not bool(payload.get("present"))]


def _has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _cross_check_issues(
    *,
    release_corpus: str,
    release_collection: str,
    release_document_ids: Sequence[str],
    release_version_ids: Sequence[str],
    published_at: str,
    admission_corpus: str,
    admission_collection: str,
    admission_document_ids: Sequence[str],
    admission_version_ids: Sequence[str],
    admitted_at: str,
    answer_ready_contract_version: str,
) -> list[str]:
    issues: list[str] = []
    if release_corpus != admission_corpus:
        issues.append("corpus_mismatch")
    if release_collection != admission_collection:
        issues.append("collection_mismatch")
    if list(release_document_ids) != list(admission_document_ids):
        issues.append("document_ids_mismatch")
    if list(release_version_ids) != list(admission_version_ids):
        issues.append("version_ids_mismatch")
    if answer_ready_contract_version != ANSWER_READY_EVIDENCE_CONTRACT_VERSION:
        issues.append("answer_ready_contract_version_mismatch")
    published_at_value = _parse_iso8601_datetime(published_at)
    admitted_at_value = _parse_iso8601_datetime(admitted_at)
    if published_at_value is None:
        issues.append("published_at_invalid")
    if admitted_at_value is None:
        issues.append("admitted_at_invalid")
    if (
        published_at_value is not None
        and admitted_at_value is not None
        and admitted_at_value > published_at_value
    ):
        issues.append("admission_after_publish")
    return issues


def _parse_iso8601_datetime(value: str) -> datetime | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    try:
        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


__all__ = [
    "ANSWER_READY_EVIDENCE_CONTRACT_VERSION",
    "audit_regulation_rag_release_manifests",
]
