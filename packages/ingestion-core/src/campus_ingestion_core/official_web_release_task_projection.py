from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from campus_ingestion_core.official_web_release_task import OfficialWebReleaseTask, utc_now

OFFICIAL_WEB_RELEASE_TASK_PROJECTION_SCHEMA_VERSION = "official_web_release_task_projection.v1"
OFFICIAL_WEB_RELEASE_TASK_REDACTION_VERSION = "official_web_release_task_redaction.v1"
DEFAULT_OFFICIAL_WEB_RELEASE_TASK_PRODUCER_VERSION = (
    "campus_ingestion_core.official_web_release_task_projection.v1"
)

_FORBIDDEN_KEYS = frozenset(
    {
        "artifactObjectKey",
        "artifact_object_key",
        "bucket",
        "bundleObjectKey",
        "bundle_object_key",
        "contentBlocksObjectKey",
        "content_blocks_object_key",
        "html",
        "inputRef",
        "input_ref",
        "key",
        "localPath",
        "local_path",
        "objectKey",
        "object_key",
        "outputRef",
        "output_ref",
        "pageManifestObjectKey",
        "page_manifest_object_key",
        "rawBody",
        "rawHtml",
        "rawStack",
        "raw_body",
        "raw_html",
        "raw_stack",
        "sourceObjectKeys",
        "source_object_keys",
    }
)


def build_official_web_release_task_operator_snapshot(
    task: OfficialWebReleaseTask,
    *,
    projected_at: str | None = None,
    producer_version: str = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_PRODUCER_VERSION,
) -> dict[str, Any]:
    projected = projected_at or utc_now().isoformat()
    return _sanitize_value(
        {
            "id": task.task_id,
            "schemaVersion": OFFICIAL_WEB_RELEASE_TASK_PROJECTION_SCHEMA_VERSION,
            "taskId": task.task_id,
            "taskType": task.task_type,
            "sourceChannel": "official_web",
            "inventoryId": task.inventory_id,
            "jobId": task.job_id,
            "runId": task.run_id,
            "selectedWriteTarget": task.selected_write_target or None,
            "lifecycleStatus": task.status,
            "latestStage": task.status,
            "attemptCount": task.attempt_count,
            "maxAttempts": task.max_attempts,
            "inputSummary": _input_summary(task.input_ref),
            "outputSummary": _output_summary(task.output_ref or {}),
            "timeline": _timeline(task),
            "lastErrorCode": task.last_error_code or None,
            "lastErrorMessage": task.last_error_message or None,
            "createdAt": task.created_at.isoformat(),
            "updatedAt": task.updated_at.isoformat(),
            "projectedAt": projected,
            "producerVersion": producer_version,
            "redactionVersion": OFFICIAL_WEB_RELEASE_TASK_REDACTION_VERSION,
        }
    )


def _input_summary(input_ref: Mapping[str, Any]) -> dict[str, Any]:
    source_urls = _string_list(_first_present(input_ref, "sourceUrls", "source_urls"))
    source_object_keys = _string_list(
        _first_present(input_ref, "sourceObjectKeys", "source_object_keys")
    )
    return {
        "sourceObjectCount": len(source_object_keys),
        "sourceUrlCount": len(source_urls),
        "sourceUrls": source_urls[:10],
        "policyVersion": _optional_text(
            _first_present(input_ref, "policyVersion", "policy_version")
        ),
    }


def _output_summary(output_ref: Mapping[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for source_key, target_key in (
        ("releaseId", "releaseId"),
        ("release_id", "releaseId"),
        ("recordCount", "recordCount"),
        ("record_count", "recordCount"),
        ("fullRecordCount", "fullRecordCount"),
        ("full_record_count", "fullRecordCount"),
        ("documentCount", "documentCount"),
        ("document_count", "documentCount"),
        ("taskScopeDisplayNames", "taskScopeDisplayNames"),
        ("task_scope_display_names", "taskScopeDisplayNames"),
        ("fullImpactDisplayNames", "fullImpactDisplayNames"),
        ("full_impact_display_names", "fullImpactDisplayNames"),
        ("corpus", "corpus"),
        ("collection", "collection"),
        ("status", "status"),
    ):
        value = output_ref.get(source_key)
        if value not in (None, "") and target_key not in summary:
            summary[target_key] = value
    return summary


def _timeline(task: OfficialWebReleaseTask) -> list[dict[str, Any]]:
    summary = f"official web release task observed: {task.status}"
    if task.last_error_code:
        summary = f"official web release task failed: {task.last_error_code}"
    return [
        {
            "stage": task.status,
            "status": task.status,
            "occurredAt": task.updated_at.isoformat(),
            "summary": summary,
        }
    ]


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize_value(item) for item in value]
    if not isinstance(value, dict):
        return value
    sanitized: dict[str, Any] = {}
    for key, item in value.items():
        if key in _FORBIDDEN_KEYS:
            continue
        sanitized[key] = _sanitize_value(item)
    return sanitized


def _first_present(payload: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload:
            return payload[key]
    return None


def _string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list | tuple):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _optional_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


__all__ = [
    "DEFAULT_OFFICIAL_WEB_RELEASE_TASK_PRODUCER_VERSION",
    "OFFICIAL_WEB_RELEASE_TASK_PROJECTION_SCHEMA_VERSION",
    "OFFICIAL_WEB_RELEASE_TASK_REDACTION_VERSION",
    "build_official_web_release_task_operator_snapshot",
]
