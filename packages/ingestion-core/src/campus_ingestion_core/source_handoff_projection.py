from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.source_handoff_state_machine import (
    SOURCE_HANDOFF_SCHEMA_VERSION,
    IngestionChildTask,
    IngestionExecution,
    SourceHandoff,
    SourceObjectRef,
    SourceRunRef,
    build_stable_id,
    utc_now_dt,
)


def official_web_source_run_ref_from_projection(
    *,
    site_id: str,
    run_id: str,
    run_status: str,
    run_intent: str,
    terminal_at: datetime | str | None,
) -> SourceRunRef:
    return SourceRunRef(
        source_channel="official_web",
        source_surface=str(run_intent or "").strip() or "baseline",
        site_id=site_id,
        source_run_id=run_id,
        source_run_owner="app_api_official_web",
        source_run_status=run_status,
        source_run_terminal_at=terminal_at,
        source_run_ref=f"official_web:crawl_run:{str(run_id).strip()}",
    )


def official_web_source_handoff_from_event(
    *,
    event_id: str,
    source_run_ref: SourceRunRef,
    source_bucket: str,
    required_objects: Sequence[SourceObjectRef],
    optional_objects: Sequence[SourceObjectRef] = (),
    page_or_unit_changes: Sequence[Mapping[str, Any]] = (),
    created_at: datetime | str | None = None,
) -> SourceHandoff:
    timestamp = created_at or utc_now_dt()
    event = _required_text(event_id, "event_id")
    return SourceHandoff(
        handoff_id=build_stable_id("ow_handoff", event),
        schema_version=SOURCE_HANDOFF_SCHEMA_VERSION,
        source_run_ref=source_run_ref,
        handoff_kind="official_web_source_truth_replay",
        source_bucket=source_bucket,
        required_objects=tuple(required_objects),
        optional_objects=tuple(optional_objects),
        page_or_unit_changes=tuple(page_or_unit_changes),
        idempotency_key=f"official_web:{event}",
        status="created",
        created_at=timestamp,
        updated_at=timestamp,
    )


def official_web_object_refs_from_artifacts(
    artifacts: Sequence[Mapping[str, Any]],
) -> tuple[SourceObjectRef, ...]:
    refs: list[SourceObjectRef] = []
    for artifact in artifacts:
        artifact_type = str(
            artifact.get("artifact_type")
            or artifact.get("artifactType")
            or artifact.get("type")
            or artifact.get("role")
            or ""
        ).strip()
        role, required = _official_web_artifact_role(artifact_type)
        refs.append(
            SourceObjectRef(
                object_role=role,
                bucket=_required_text(artifact.get("bucket"), "bucket"),
                object_key=_required_text(
                    artifact.get("object_key") or artifact.get("objectKey") or artifact.get("key"),
                    "object_key",
                ),
                content_sha256=str(
                    artifact.get("content_sha256")
                    or artifact.get("contentSha256")
                    or artifact.get("sha256")
                    or ""
                ).strip(),
                byte_size=artifact.get("byte_size") or artifact.get("byteSize"),
                required=required,
                content_type=str(artifact.get("content_type") or "").strip(),
            )
        )
    return tuple(refs)


def official_web_object_refs_from_bundle(
    pages: Sequence[Mapping[str, Any]],
    *,
    bucket: str,
) -> tuple[SourceObjectRef, ...]:
    refs: list[SourceObjectRef] = []
    for page in pages:
        source_unit_id = str(page.get("page_id") or page.get("url") or "").strip()
        refs.append(
            SourceObjectRef(
                object_role="official_web_page_manifest",
                bucket=bucket,
                object_key=_required_text(
                    page.get("pageManifestObjectKey"), "pageManifestObjectKey"
                ),
                content_sha256=str(page.get("pageManifestSha256") or "").strip(),
                byte_size=page.get("pageManifestByteSize"),
                required=True,
                source_unit_id=source_unit_id,
            )
        )
        refs.append(
            SourceObjectRef(
                object_role="official_web_content_blocks",
                bucket=bucket,
                object_key=_required_text(
                    page.get("contentBlocksObjectKey"),
                    "contentBlocksObjectKey",
                ),
                content_sha256=str(page.get("contentBlocksSha256") or "").strip(),
                byte_size=page.get("contentBlocksByteSize"),
                required=True,
                source_unit_id=source_unit_id,
            )
        )
    return tuple(refs)


def official_web_execution_from_verified_handoff(
    handoff: SourceHandoff,
    *,
    created_at: datetime | str | None = None,
    requested_result_kind: str = "stage_only",
    max_attempts: int = 3,
) -> IngestionExecution:
    _require_verified_handoff(handoff)
    timestamp = created_at or utc_now_dt()
    return IngestionExecution(
        execution_id=build_stable_id("ow_exec", handoff.handoff_id, requested_result_kind),
        handoff_id=handoff.handoff_id,
        processor_profile="official_web_source_truth_replay",
        requested_result_kind=requested_result_kind,
        status="queued",
        result_kind="none",
        attempt_count=0,
        max_attempts=max_attempts,
        idempotency_key=f"{handoff.idempotency_key}:{requested_result_kind}",
        created_at=timestamp,
        updated_at=timestamp,
    )


def official_web_execution_to_app_api_projection(
    execution: IngestionExecution,
) -> dict[str, Any]:
    status = _official_web_app_api_status(execution)
    failure = execution.failure_reason
    return {
        "schema_version": "official_web_ingestion_execution_projection.v1",
        "ingestion_execution_status": status,
        "ingestion_execution_ref": execution.execution_id,
        "ingestion_execution_updated_at": execution.updated_at,
        "ingestion_execution_error_code": failure.code if failure else "",
        "ingestion_execution_error_message": failure.message if failure else "",
    }


def authenticated_notice_source_run_ref_from_ledger(
    run_refs: AuthenticatedNoticeCollectorRunObjectRefs,
    *,
    site_id: str,
    source_run_terminal_at: datetime | str | None,
    source_run_status: str = "success",
) -> SourceRunRef:
    return SourceRunRef(
        source_channel="authenticated_notice_portal",
        source_surface=run_refs.source_surface,
        site_id=site_id,
        source_run_id=run_refs.run_id,
        source_run_owner="authenticated_notice_collector_ledger",
        source_run_status=source_run_status,
        source_run_terminal_at=source_run_terminal_at,
        source_run_ref=(f"authenticated_notice_portal:{run_refs.source_surface}:{run_refs.run_id}"),
    )


def authenticated_notice_source_handoff_from_ledger(
    *,
    source_run_ref: SourceRunRef,
    run_refs: AuthenticatedNoticeCollectorRunObjectRefs,
    required_objects: Sequence[SourceObjectRef],
    optional_objects: Sequence[SourceObjectRef] = (),
    created_at: datetime | str | None = None,
) -> SourceHandoff:
    timestamp = created_at or utc_now_dt()
    handoff_kind = (
        "authenticated_file_release_import"
        if run_refs.source_surface == "file_release"
        else "authenticated_notice_import"
    )
    return SourceHandoff(
        handoff_id=build_stable_id(
            "an_handoff",
            run_refs.source_surface,
            run_refs.run_id,
            run_refs.bundle_content_sha256,
            run_refs.manifest_content_sha256,
        ),
        schema_version=SOURCE_HANDOFF_SCHEMA_VERSION,
        source_run_ref=source_run_ref,
        handoff_kind=handoff_kind,
        source_bucket=run_refs.source_bucket,
        required_objects=tuple(required_objects),
        optional_objects=tuple(optional_objects),
        idempotency_key=(
            "authenticated_notice:"
            f"{run_refs.source_surface}:{run_refs.run_id}:"
            f"{run_refs.bundle_content_sha256}:{run_refs.manifest_content_sha256}"
        ),
        status="created",
        created_at=timestamp,
        updated_at=timestamp,
    )


def authenticated_notice_object_refs_from_run_refs(
    run_refs: AuthenticatedNoticeCollectorRunObjectRefs,
) -> tuple[SourceObjectRef, ...]:
    return (
        SourceObjectRef(
            object_role="handoff_bundle",
            bucket=run_refs.source_bucket,
            object_key=run_refs.bundle_object_key,
            content_sha256=run_refs.bundle_content_sha256,
            byte_size=run_refs.bundle_byte_size,
            required=True,
        ),
        SourceObjectRef(
            object_role="handoff_manifest",
            bucket=run_refs.source_bucket,
            object_key=run_refs.manifest_object_key,
            content_sha256=run_refs.manifest_content_sha256,
            byte_size=run_refs.manifest_byte_size,
            required=True,
        ),
    )


def authenticated_notice_object_refs_from_manifest(
    objects: Sequence[Mapping[str, Any]],
    *,
    default_bucket: str,
) -> tuple[SourceObjectRef, ...]:
    refs: list[SourceObjectRef] = []
    for item in objects:
        source_surface = str(item.get("source_surface") or "").strip()
        role = (
            "file_release_released_source_bytes"
            if source_surface == "file_release"
            else "notice_attachment_source_bytes"
        )
        refs.append(
            SourceObjectRef(
                object_role=role,
                bucket=str(item.get("bucket") or default_bucket).strip(),
                object_key=_required_text(item.get("object_key") or item.get("key"), "object_key"),
                content_sha256=str(item.get("content_sha256") or item.get("sha256") or "").strip(),
                byte_size=item.get("byte_size"),
                required=bool(item.get("required", True)),
                source_unit_id=str(item.get("source_unit_id") or "").strip(),
                content_type=str(item.get("content_type") or "").strip(),
            )
        )
    return tuple(refs)


def authenticated_notice_execution_from_verified_handoff(
    handoff: SourceHandoff,
    *,
    processor_profile: str,
    requested_result_kind: str,
    created_at: datetime | str | None = None,
    max_attempts: int = 3,
) -> IngestionExecution:
    _require_verified_handoff(handoff)
    timestamp = created_at or utc_now_dt()
    return IngestionExecution(
        execution_id=build_stable_id("an_exec", handoff.handoff_id, requested_result_kind),
        handoff_id=handoff.handoff_id,
        processor_profile=processor_profile,
        requested_result_kind=requested_result_kind,
        status="queued",
        result_kind="none",
        attempt_count=0,
        max_attempts=max_attempts,
        idempotency_key=f"{handoff.idempotency_key}:{requested_result_kind}",
        created_at=timestamp,
        updated_at=timestamp,
    )


def authenticated_notice_queue_status_to_execution_projection(
    *,
    queue_status: str,
    has_running_step: bool = False,
) -> dict[str, str]:
    normalized = _required_text(queue_status, "queue_status")
    mapping = {
        "queued": "queued",
        "leased": "running" if has_running_step else "claimed",
        "succeeded": "completed",
        "failed_retryable": "failed_retryable",
        "failed_terminal": "failed_terminal",
        "dead_letter": "dead_letter",
        "manual_review": "failed_terminal",
        "blocked": "failed_terminal",
        "cancelled": "cancelled",
    }
    if normalized not in mapping:
        raise ValueError(f"unsupported authenticated-notice queue_status: {normalized}")
    return {"status": mapping[normalized]}


def authenticated_notice_child_task_to_ingestion_child_task(
    *,
    execution_id: str,
    child_task: Mapping[str, Any],
    created_at: datetime | str | None = None,
) -> IngestionChildTask:
    timestamp = created_at or utc_now_dt()
    return IngestionChildTask(
        execution_id=execution_id,
        child_task_id=_required_text(child_task.get("task_id"), "task_id"),
        task_kind=_map_authenticated_notice_child_task_kind(
            _required_text(child_task.get("task_kind"), "task_kind")
        ),
        processor_profile=_required_text(
            child_task.get("processor_profile_id"),
            "processor_profile_id",
        ),
        status=_required_text(child_task.get("state"), "state"),
        attempt_count=int(child_task.get("attempt_ordinal") or 0),
        source_unit_id=str(child_task.get("source_unit_id") or "").strip(),
        reason_code=str(child_task.get("reason_code") or "").strip(),
        input_refs=tuple(_safe_ref(item) for item in child_task.get("input_refs") or ()),
        output_refs=tuple(_safe_ref(item) for item in child_task.get("output_refs") or ()),
        created_at=timestamp,
        updated_at=timestamp,
    )


def _official_web_artifact_role(artifact_type: str) -> tuple[str, bool]:
    mapping = {
        "source_truth_bundle": ("handoff_bundle", True),
        "crawl_run_manifest": ("handoff_manifest", True),
        "quality_audit": ("quality_audit", False),
        "provider_capture": ("provider_capture", False),
    }
    if artifact_type not in mapping:
        raise ValueError(f"unsupported official-web artifact type: {artifact_type}")
    return mapping[artifact_type]


def _official_web_app_api_status(execution: IngestionExecution) -> str:
    if execution.status == "completed":
        if execution.result_kind in ("staged", "promoted"):
            return execution.result_kind
        return "succeeded"
    if execution.status in ("queued", "claimed", "running", "failed_retryable"):
        return "running"
    if execution.status in ("failed_terminal", "dead_letter", "cancelled"):
        return "failed"
    return "pending"


def _map_authenticated_notice_child_task_kind(task_kind: str) -> str:
    if task_kind == "cleanup_evaluation":
        return "cleanup_guard"
    return task_kind


def _safe_ref(value: Mapping[str, Any]) -> dict[str, Any]:
    allowed_keys = (
        "role",
        "bucket",
        "key",
        "object_key",
        "sha256",
        "content_sha256",
        "byte_size",
        "schema_version",
    )
    return {key: value[key] for key in allowed_keys if key in value}


def _require_verified_handoff(handoff: SourceHandoff) -> None:
    if handoff.status != "verified":
        raise ValueError("handoff must be verified before creating execution")


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} is required")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


__all__ = [
    "authenticated_notice_child_task_to_ingestion_child_task",
    "authenticated_notice_execution_from_verified_handoff",
    "authenticated_notice_object_refs_from_manifest",
    "authenticated_notice_object_refs_from_run_refs",
    "authenticated_notice_queue_status_to_execution_projection",
    "authenticated_notice_source_handoff_from_ledger",
    "authenticated_notice_source_run_ref_from_ledger",
    "official_web_execution_from_verified_handoff",
    "official_web_execution_to_app_api_projection",
    "official_web_object_refs_from_artifacts",
    "official_web_object_refs_from_bundle",
    "official_web_source_handoff_from_event",
    "official_web_source_run_ref_from_projection",
]
