from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from campus_retrieval_core.backend_qdrant_source_metadata import effective_payload_metadata
from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
)
from qdrant_client import QdrantClient

from campus_ingestion_core.answer_ready_contract_quality import (
    evaluate_answer_ready_contract_metadata,
)
from campus_ingestion_core.component_eval_release import (
    derive_component_eval_release_status,
)
from campus_ingestion_core.index_release import IndexReleaseManifest, resolve_alias_target
from campus_ingestion_core.process_indexing import audit_payload_indexes
from campus_ingestion_core.registry_scope_release_support import (
    is_mock_qdrant_client as _is_mock_qdrant_client,
)
from campus_ingestion_core.registry_scope_release_support import (
    read_collection_points_count as _read_collection_points_count,
)
from campus_ingestion_core.registry_scope_release_support import (
    release_payload_mismatch_issues as _release_payload_mismatch_issues,
)
from campus_ingestion_core.registry_scope_release_support import (
    sample_release_payloads as _sample_release_payloads,
)

_ANSWER_READY_PUBLISHED_FALLBACK_PROVENANCE_FIELDS = (
    "condition_subject_provenance",
    "procedure_action_provenance",
)


class RegistryScopeAuditObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class ReleasePostPublishAuditResult:
    status: str
    summary: dict[str, object]


def refresh_release_point_metadata(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    release_metadata: Mapping[str, object],
    batch_size: int = 256,
) -> int:
    if _is_mock_qdrant_client(qdrant_client):
        return 0
    if not qdrant_client.collection_exists(collection_name):
        raise ValueError(
            f"cannot refresh release metadata for missing collection {collection_name}"
        )
    scroll_offset: object | None = None
    refreshed_count = 0
    while True:
        records, next_offset = qdrant_client.scroll(
            collection_name=collection_name,
            limit=batch_size,
            offset=scroll_offset,
            with_payload=False,
            with_vectors=False,
        )
        point_ids = [record.id for record in records or ()]
        if point_ids:
            qdrant_client.set_payload(
                collection_name=collection_name,
                payload=dict(release_metadata),
                points=point_ids,
                wait=True,
            )
            refreshed_count += len(point_ids)
        if not next_offset or not point_ids:
            break
        scroll_offset = next_offset
    return refreshed_count


def audit_published_scope_release(
    *,
    qdrant_client: QdrantClient,
    object_store: RegistryScopeAuditObjectStore,
    bucket: str,
    manifest: IndexReleaseManifest,
    manifest_object_key: str,
    expected_release_metadata: Mapping[str, object],
    sample_limit: int = 16,
) -> ReleasePostPublishAuditResult:
    if _is_mock_qdrant_client(qdrant_client):
        return ReleasePostPublishAuditResult(
            status="skipped",
            summary={
                "status": "skipped",
                "reason": "mock_qdrant_client",
                "release_id": manifest.release_id,
                "physical_collection_name": manifest.physical_collection_name,
            },
        )
    issues: list[str] = []
    semantic_oracle_pass_count = 0
    semantic_oracle_fail_count = 0
    payload_index_audit_status = "failed"
    required_filter_index_status = "failed"
    alias_target = resolve_alias_target(
        qdrant_client=qdrant_client,
        alias_name=manifest.serving_alias,
    )
    release_drift_guard_issues: list[str] = []
    if alias_target != manifest.physical_collection_name:
        release_drift_guard_issues.append(
            f"alias_target_mismatch:{alias_target or '<none>'}!={manifest.physical_collection_name}"
        )
    if not qdrant_client.collection_exists(manifest.physical_collection_name):
        issues.append("missing_physical_collection")
        payloads: tuple[dict[str, object], ...] = ()
        points_count: int | None = None
    else:
        points_count = _read_collection_points_count(
            qdrant_client=qdrant_client,
            collection_name=manifest.physical_collection_name,
        )
        payload_index_audit = audit_payload_indexes(
            qdrant_client=qdrant_client,
            collection_name=manifest.physical_collection_name,
        )
        issues.extend(
            f"payload_index_missing:{field_name}"
            for field_name in payload_index_audit.missing_indexes
        )
        issues.extend(
            f"payload_index_schema_mismatch:{field_name}"
            for field_name in payload_index_audit.mismatched_indexes
        )
        payload_index_audit_status = str(payload_index_audit.status or "failed")
        required_filter_index_status = str(payload_index_audit.status or "failed")
        if points_count == 0:
            issues.append("empty_physical_collection")
        payloads = _sample_release_payloads(
            qdrant_client=qdrant_client,
            collection_name=manifest.physical_collection_name,
            sample_limit=sample_limit,
        )
        if not payloads:
            issues.append("missing_sampled_point_payload")
    if not qdrant_client.collection_exists(manifest.physical_collection_name):
        payload_index_audit_summary = {"status": "not_applicable", "reason": "missing_collection"}
    else:
        payload_index_audit_summary = payload_index_audit.summary
    release_drift_guard_issues.extend(
        _release_payload_mismatch_issues(
            payloads=payloads,
            expected_release_metadata=expected_release_metadata,
        )
    )
    issues.extend(release_drift_guard_issues)
    published_answer_ready_payload_issues = _published_answer_ready_payload_issues(
        corpus=manifest.corpus,
        collection=manifest.collection,
        payloads=payloads,
    )
    issues.extend(published_answer_ready_payload_issues)
    object_keys = [
        manifest_object_key,
        manifest.validation_summary_object_key,
        manifest.quality_gate_summary_object_key,
    ]
    if manifest.retrieval_acceptance_status:
        object_keys.append(manifest.retrieval_acceptance_summary_object_key)
    if manifest.component_eval_summary_object_key:
        object_keys.append(manifest.component_eval_summary_object_key)
    for object_key in object_keys:
        if not object_key:
            issues.append("missing_release_artifact_key")
            continue
        try:
            object_store.get_bytes(bucket=bucket, key=str(object_key))
        except Exception:
            issues.append(f"missing_release_artifact:{object_key}")
    if manifest.component_eval_summary_object_key:
        try:
            component_eval_summary = json.loads(
                object_store.get_bytes(
                    bucket=bucket,
                    key=str(manifest.component_eval_summary_object_key),
                ).decode("utf-8")
            )
        except Exception:
            component_eval_summary = None
        if isinstance(component_eval_summary, Mapping):
            component_eval_status = derive_component_eval_release_status(component_eval_summary)
            semantic_oracle_pass_count = component_eval_status.passed_case_count
            semantic_oracle_fail_count = component_eval_status.failed_case_count
    release_drift_guard_status = "passed" if not release_drift_guard_issues else "failed"
    if payload_index_audit_status == "passed":
        payload_index_audit_issues = [
            issue
            for issue in issues
            if issue
            and (
                issue
                in {
                    "missing_physical_collection",
                    "empty_physical_collection",
                    "missing_sampled_point_payload",
                }
                or issue.startswith(("payload_index_", "sample_"))
            )
        ]
        if payload_index_audit_issues:
            payload_index_audit_status = "failed"
    status = "passed" if not issues else "failed"
    return ReleasePostPublishAuditResult(
        status=status,
        summary={
            "status": status,
            "release_id": manifest.release_id,
            "serving_alias": manifest.serving_alias,
            "alias_target": alias_target,
            "physical_collection_name": manifest.physical_collection_name,
            "release_drift_guard_status": release_drift_guard_status,
            "payload_index_audit_status": payload_index_audit_status,
            "required_filter_index_status": required_filter_index_status,
            "points_count": points_count,
            "sampled_payload_count": len(payloads),
            "sampled_payload_contract_versions": tuple(
                _sampled_payload_contract_version(payload) for payload in payloads
            ),
            "semantic_oracle_pass_count": semantic_oracle_pass_count,
            "semantic_oracle_fail_count": semantic_oracle_fail_count,
            "semantic_oracle_result_count": (
                semantic_oracle_pass_count + semantic_oracle_fail_count
            ),
            "payload_index_audit": payload_index_audit_summary,
            "issues": tuple(issues),
        },
    )


def _published_answer_ready_payload_issues(
    *,
    corpus: str,
    collection: str,
    payloads: Sequence[Mapping[str, object]],
) -> tuple[str, ...]:
    issues: list[str] = []
    for index, payload in enumerate(payloads, start=1):
        point_id = payload.get("id") or payload.get("chunk_id") or f"sample-{index}"
        metadata = dict(payload)
        runtime_metadata = effective_payload_metadata(point_id, metadata)
        flat_target_payload = _is_target_answer_ready_payload(metadata)
        runtime_target_payload = _is_target_answer_ready_payload(runtime_metadata)
        if not flat_target_payload and not runtime_target_payload:
            continue
        if runtime_target_payload and not flat_target_payload:
            issues.extend(
                _published_answer_ready_projection_marker_issues(
                    sample_index=index,
                    metadata=metadata,
                    issue_prefix="answer_ready_payload_projection",
                )
            )
        if flat_target_payload and not runtime_target_payload:
            issues.extend(
                _published_answer_ready_projection_marker_issues(
                    sample_index=index,
                    metadata=runtime_metadata,
                    issue_prefix="answer_ready_runtime_projection",
                )
            )
        if flat_target_payload:
            validation = evaluate_answer_ready_contract_metadata(
                corpus=corpus,
                collection=collection,
                metadata=metadata,
            )
            issues.extend(
                f"sample_{index}_answer_ready_contract:{issue}" for issue in validation.issues
            )
            issues.extend(
                _published_answer_ready_fallback_provenance_issues(
                    sample_index=index,
                    metadata=metadata,
                )
            )
        if runtime_target_payload:
            runtime_validation = evaluate_answer_ready_contract_metadata(
                corpus=corpus,
                collection=collection,
                metadata=runtime_metadata,
            )
            issues.extend(
                f"sample_{index}_answer_ready_runtime_contract:{issue}"
                for issue in runtime_validation.issues
            )
            issues.extend(
                _published_answer_ready_fallback_provenance_issues(
                    sample_index=index,
                    metadata=runtime_metadata,
                    issue_prefix="answer_ready_runtime_fallback_provenance",
                )
            )
    return tuple(issues)


def _is_target_answer_ready_payload(metadata: Mapping[str, object]) -> bool:
    contract_version = str(metadata.get("evidence_contract_version") or "").strip()
    answer_role = str(metadata.get("answer_role") or "").strip()
    return bool(contract_version == ANSWER_READY_EVIDENCE_CONTRACT_VERSION and answer_role)


def _published_answer_ready_fallback_provenance_issues(
    *,
    sample_index: int,
    metadata: Mapping[str, object],
    issue_prefix: str = "answer_ready_fallback_provenance",
) -> tuple[str, ...]:
    issues: list[str] = []
    for field_name in _ANSWER_READY_PUBLISHED_FALLBACK_PROVENANCE_FIELDS:
        value = str(metadata.get(field_name) or "").strip()
        if value.startswith("fallback:"):
            issues.append(f"sample_{sample_index}_{issue_prefix}:{field_name}={value}")
    return tuple(issues)


def _published_answer_ready_projection_marker_issues(
    *,
    sample_index: int,
    metadata: Mapping[str, object],
    issue_prefix: str,
) -> tuple[str, ...]:
    issues: list[str] = []
    answer_role = str(metadata.get("answer_role") or "").strip()
    if not answer_role:
        issues.append(f"sample_{sample_index}_{issue_prefix}:answer_role_missing")
    contract_version = str(metadata.get("evidence_contract_version") or "").strip()
    if contract_version != ANSWER_READY_EVIDENCE_CONTRACT_VERSION:
        if contract_version:
            issues.append(
                f"sample_{sample_index}_{issue_prefix}:"
                f"evidence_contract_version_not_target={contract_version}"
            )
        else:
            issues.append(f"sample_{sample_index}_{issue_prefix}:evidence_contract_version_missing")
    return tuple(issues)


def _sampled_payload_contract_version(payload: Mapping[str, object]) -> str:
    version = str(payload.get("evidence_contract_version") or "").strip()
    return version or "<missing>"


__all__ = [
    "ReleasePostPublishAuditResult",
    "audit_published_scope_release",
    "refresh_release_point_metadata",
]
