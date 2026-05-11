from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from campus_ingestion_core.source_handoff_projection import (
    official_web_execution_from_verified_handoff,
    official_web_object_refs_from_artifacts,
    official_web_source_handoff_from_event,
    official_web_source_run_ref_from_projection,
)
from campus_ingestion_core.source_handoff_state_machine import (
    FailureReason,
    IngestionStep,
    ObjectVerification,
    SourceObjectRef,
    build_stable_id,
    utc_now_dt,
)
from campus_ingestion_core.source_handoff_store import SourceHandoffStore

from campus_ingestion_worker.official_web_handoff_consumer_io import require_text
from campus_ingestion_worker.official_web_handoff_consumer_models import (
    OfficialWebHandoffConsumeError,
    OfficialWebHandoffConsumerSettings,
    OfficialWebSourceObjectStore,
)


@dataclass(frozen=True, slots=True)
class OfficialWebCanonicalExecutionContext:
    handoff_id: str
    execution_id: str
    worker_id: str
    attempt_count: int


def prepare_official_web_canonical_execution(
    *,
    payload: Mapping[str, object],
    settings: OfficialWebHandoffConsumerSettings,
    object_store: OfficialWebSourceObjectStore,
    source_handoff_store: SourceHandoffStore,
    worker_id: str | None = None,
    now: datetime | None = None,
) -> OfficialWebCanonicalExecutionContext:
    timestamp = now or utc_now_dt()
    event_id = require_text(payload.get("eventId"), "payload.eventId")
    run_id = require_text(payload.get("runId"), "payload.runId")
    site_id = require_text(payload.get("siteId"), "payload.siteId")
    run_intent = require_text(payload.get("runIntent"), "payload.runIntent")
    run_status = require_text(payload.get("status"), "payload.status")
    artifacts = _require_artifact_payloads(payload.get("artifacts"))
    worker = worker_id or settings.app_name

    run_ref = official_web_source_run_ref_from_projection(
        site_id=site_id,
        run_id=run_id,
        run_status=run_status,
        run_intent=run_intent,
        terminal_at=str(payload.get("finishedAt") or "") or timestamp,
    )
    artifact_refs = official_web_object_refs_from_artifacts(
        _artifact_payloads_with_bucket(artifacts, settings.source_bucket)
    )
    required_refs = tuple(ref for ref in artifact_refs if ref.required)
    optional_refs = tuple(ref for ref in artifact_refs if not ref.required)
    bundle_ref = _find_required_ref(required_refs, "handoff_bundle")
    handoff = official_web_source_handoff_from_event(
        event_id=event_id,
        source_run_ref=run_ref,
        source_bucket=settings.source_bucket,
        required_objects=required_refs,
        optional_objects=optional_refs,
        page_or_unit_changes=_page_or_unit_changes(payload.get("pageChanges")),
        created_at=timestamp,
    )
    handoff = source_handoff_store.create_or_get_handoff(handoff)
    source_handoff_store.mark_handoff_verifying(handoff.handoff_id, now=timestamp)

    bundle_payload = _verify_declared_required_object(
        object_store=object_store,
        source_handoff_store=source_handoff_store,
        handoff_id=handoff.handoff_id,
        object_ref=bundle_ref,
        now=timestamp,
    )
    page_refs = _page_object_refs_from_bundle_payload(
        bundle_payload=bundle_payload,
        bucket=settings.source_bucket,
        object_store=object_store,
    )
    source_handoff_store.append_objects(handoff.handoff_id, page_refs)
    for page_ref in page_refs:
        _record_matched_verification(
            source_handoff_store=source_handoff_store,
            handoff_id=handoff.handoff_id,
            object_ref=page_ref,
            now=timestamp,
        )
    for optional_ref in optional_refs:
        _record_optional_ref_seen(
            source_handoff_store=source_handoff_store,
            handoff_id=handoff.handoff_id,
            object_ref=optional_ref,
            now=timestamp,
        )

    verified_handoff = source_handoff_store.mark_handoff_verified(handoff.handoff_id, now=timestamp)
    execution = source_handoff_store.enqueue_execution(
        official_web_execution_from_verified_handoff(verified_handoff, created_at=timestamp)
    )
    claimed = source_handoff_store.claim_next_execution(
        worker_id=worker,
        lease_seconds=300,
        now=timestamp,
    )
    if claimed is None or claimed.execution_id != execution.execution_id:
        raise OfficialWebHandoffConsumeError(
            code="canonical_execution_claim_failed",
            message="official_web canonical execution could not be claimed for this handoff.",
        )
    context = OfficialWebCanonicalExecutionContext(
        handoff_id=handoff.handoff_id,
        execution_id=claimed.execution_id,
        worker_id=worker,
        attempt_count=claimed.attempt_count,
    )
    mark_official_web_canonical_step_passed(
        source_handoff_store=source_handoff_store,
        context=context,
        step_name="verify_objects",
        now=timestamp,
    )
    return context


def mark_official_web_canonical_step_passed(
    *,
    source_handoff_store: SourceHandoffStore,
    context: OfficialWebCanonicalExecutionContext,
    step_name: str,
    now: datetime | None = None,
) -> None:
    timestamp = now or utc_now_dt()
    source_handoff_store.upsert_step(
        IngestionStep(
            execution_id=context.execution_id,
            step_id=build_stable_id("ow_step", context.execution_id, step_name),
            step_name=step_name,
            status="passed",
            attempt_count=context.attempt_count,
            created_at=timestamp,
            updated_at=timestamp,
            started_at=timestamp,
            finished_at=timestamp,
        )
    )


def complete_official_web_canonical_execution(
    *,
    source_handoff_store: SourceHandoffStore,
    context: OfficialWebCanonicalExecutionContext,
    result_kind: str,
    now: datetime | None = None,
) -> None:
    source_handoff_store.complete_execution(
        context.execution_id,
        worker_id=context.worker_id,
        result_kind=result_kind,
        now=now,
    )


def fail_official_web_canonical_execution(
    *,
    source_handoff_store: SourceHandoffStore,
    context: OfficialWebCanonicalExecutionContext,
    error_payload: Mapping[str, object],
    now: datetime | None = None,
) -> None:
    source_handoff_store.fail_execution_terminal(
        context.execution_id,
        worker_id=context.worker_id,
        failure_reason=FailureReason(
            code=str(error_payload.get("code") or "official_web_execution_failed"),
            message=str(error_payload.get("message") or ""),
            source_channel="official_web",
        ),
        now=now,
    )


def _verify_declared_required_object(
    *,
    object_store: OfficialWebSourceObjectStore,
    source_handoff_store: SourceHandoffStore,
    handoff_id: str,
    object_ref: SourceObjectRef,
    now: datetime,
) -> dict[str, object]:
    payload_bytes = object_store.get_bytes(bucket=object_ref.bucket, key=object_ref.object_key)
    observed_sha = hashlib.sha256(payload_bytes).hexdigest()
    observed_size = len(payload_bytes)
    if observed_sha != object_ref.content_sha256:
        _record_failed_verification(
            source_handoff_store=source_handoff_store,
            handoff_id=handoff_id,
            object_ref=object_ref,
            status="checksum_mismatch",
            observed_sha=observed_sha,
            observed_size=observed_size,
            now=now,
        )
        raise OfficialWebHandoffConsumeError(
            code="source_object_checksum_mismatch",
            message=f"required object checksum mismatch: {object_ref.object_role}",
        )
    if observed_size != object_ref.byte_size:
        _record_failed_verification(
            source_handoff_store=source_handoff_store,
            handoff_id=handoff_id,
            object_ref=object_ref,
            status="size_mismatch",
            observed_sha=observed_sha,
            observed_size=observed_size,
            now=now,
        )
        raise OfficialWebHandoffConsumeError(
            code="source_object_size_mismatch",
            message=f"required object size mismatch: {object_ref.object_role}",
        )
    source_handoff_store.record_object_verification(
        ObjectVerification(
            verification_id=build_stable_id(
                "ow_object_verification",
                handoff_id,
                object_ref.object_role,
                object_ref.object_key,
            ),
            handoff_id=handoff_id,
            object_role=object_ref.object_role,
            bucket=object_ref.bucket,
            object_key=object_ref.object_key,
            status="matched",
            expected_sha256=object_ref.content_sha256,
            observed_sha256=observed_sha,
            expected_byte_size=object_ref.byte_size or 0,
            observed_byte_size=observed_size,
            checked_at=now,
        )
    )
    decoded = json.loads(payload_bytes.decode("utf-8"))
    if not isinstance(decoded, dict):
        raise OfficialWebHandoffConsumeError(
            code="invalid_source_truth_bundle",
            message="source truth bundle must decode to an object.",
        )
    return decoded


def _page_object_refs_from_bundle_payload(
    *,
    bundle_payload: Mapping[str, object],
    bucket: str,
    object_store: OfficialWebSourceObjectStore,
) -> tuple[SourceObjectRef, ...]:
    pages = bundle_payload.get("pages")
    if not isinstance(pages, Sequence) or isinstance(pages, str | bytes):
        raise OfficialWebHandoffConsumeError(
            code="invalid_source_truth_bundle",
            message="bundle pages must be an array.",
        )
    refs: list[SourceObjectRef] = []
    for page in pages:
        if not isinstance(page, Mapping):
            raise OfficialWebHandoffConsumeError(
                code="invalid_source_truth_bundle",
                message="bundle pages[] must be an object.",
            )
        source_unit_id = require_text(page.get("rawAssetId"), "rawAssetId")
        for field_name, role in (
            ("pageManifestObjectKey", "official_web_page_manifest"),
            ("contentBlocksObjectKey", "official_web_content_blocks"),
        ):
            object_key = require_text(page.get(field_name), field_name)
            payload_bytes = object_store.get_bytes(bucket=bucket, key=object_key)
            refs.append(
                SourceObjectRef(
                    object_role=role,
                    bucket=bucket,
                    object_key=object_key,
                    content_sha256=hashlib.sha256(payload_bytes).hexdigest(),
                    byte_size=len(payload_bytes),
                    required=True,
                    source_unit_id=source_unit_id,
                )
            )
    return tuple(refs)


def _record_matched_verification(
    *,
    source_handoff_store: SourceHandoffStore,
    handoff_id: str,
    object_ref: SourceObjectRef,
    now: datetime,
) -> None:
    source_handoff_store.record_object_verification(
        ObjectVerification(
            verification_id=build_stable_id(
                "ow_object_verification",
                handoff_id,
                object_ref.object_role,
                object_ref.object_key,
            ),
            handoff_id=handoff_id,
            object_role=object_ref.object_role,
            bucket=object_ref.bucket,
            object_key=object_ref.object_key,
            status="matched",
            expected_sha256=object_ref.content_sha256,
            observed_sha256=object_ref.content_sha256,
            expected_byte_size=object_ref.byte_size or 0,
            observed_byte_size=object_ref.byte_size,
            checked_at=now,
        )
    )


def _record_optional_ref_seen(
    *,
    source_handoff_store: SourceHandoffStore,
    handoff_id: str,
    object_ref: SourceObjectRef,
    now: datetime,
) -> None:
    source_handoff_store.record_object_verification(
        ObjectVerification(
            verification_id=build_stable_id(
                "ow_object_verification",
                handoff_id,
                object_ref.object_role,
                object_ref.object_key,
            ),
            handoff_id=handoff_id,
            object_role=object_ref.object_role,
            bucket=object_ref.bucket,
            object_key=object_ref.object_key,
            status="skipped_optional",
            expected_sha256=object_ref.content_sha256 or "0" * 64,
            observed_sha256=object_ref.content_sha256 or "",
            expected_byte_size=object_ref.byte_size or 0,
            observed_byte_size=object_ref.byte_size,
            checked_at=now,
        )
    )


def _record_failed_verification(
    *,
    source_handoff_store: SourceHandoffStore,
    handoff_id: str,
    object_ref: SourceObjectRef,
    status: str,
    observed_sha: str,
    observed_size: int,
    now: datetime,
) -> None:
    failure_reason = FailureReason(
        code=status,
        message=f"{object_ref.object_role} verification failed",
        source_channel="official_web",
    )
    source_handoff_store.record_object_verification(
        ObjectVerification(
            verification_id=build_stable_id(
                "ow_object_verification",
                handoff_id,
                object_ref.object_role,
                object_ref.object_key,
            ),
            handoff_id=handoff_id,
            object_role=object_ref.object_role,
            bucket=object_ref.bucket,
            object_key=object_ref.object_key,
            status=status,
            expected_sha256=object_ref.content_sha256,
            observed_sha256=observed_sha,
            expected_byte_size=object_ref.byte_size or 0,
            observed_byte_size=observed_size,
            checked_at=now,
            failure_reason=failure_reason,
        )
    )
    source_handoff_store.reject_handoff(handoff_id, failure_reason=failure_reason, now=now)


def _find_required_ref(refs: Sequence[SourceObjectRef], object_role: str) -> SourceObjectRef:
    for ref in refs:
        if ref.object_role == object_role:
            return ref
    raise OfficialWebHandoffConsumeError(
        code="missing_required_source_object",
        message=f"official_web handoff is missing required object role: {object_role}",
    )


def _require_artifact_payloads(value: object) -> tuple[Mapping[str, object], ...]:
    if not isinstance(value, Sequence) or isinstance(value, str | bytes):
        raise OfficialWebHandoffConsumeError(
            code="invalid_handoff_payload",
            message="payload.artifacts must be an array.",
        )
    artifacts: list[Mapping[str, object]] = []
    for item in value:
        if not isinstance(item, Mapping):
            raise OfficialWebHandoffConsumeError(
                code="invalid_handoff_payload",
                message="payload.artifacts[] must be an object.",
            )
        artifacts.append(item)
    return tuple(artifacts)


def _artifact_payloads_with_bucket(
    artifacts: Sequence[Mapping[str, object]],
    bucket: str,
) -> tuple[Mapping[str, object], ...]:
    return tuple(
        item if item.get("bucket") else {**dict(item), "bucket": bucket} for item in artifacts
    )


def _page_or_unit_changes(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, str | bytes):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


__all__ = [
    "OfficialWebCanonicalExecutionContext",
    "complete_official_web_canonical_execution",
    "fail_official_web_canonical_execution",
    "mark_official_web_canonical_step_passed",
    "prepare_official_web_canonical_execution",
]
