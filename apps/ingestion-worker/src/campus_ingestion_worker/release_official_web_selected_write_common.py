from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, is_dataclass
from typing import Any, Protocol

from campus_ingestion_core.official_web_release_task import OfficialWebReleaseTask


class OfficialWebSelectedWriteReleaseError(RuntimeError):
    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class OfficialWebSelectedWriteObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...


class OfficialWebSelectedWriteProjectionReporter(Protocol):
    def report(self, *, snapshot: dict[str, object]) -> None: ...


class OfficialWebSelectedWritePublisher(Protocol):
    def publish_release(
        self,
        *,
        corpus: str,
        collection: str,
        release_id: str,
        generated_at: str,
        schema_version: str,
        artifact_object_key: str,
        artifact_checksum: str,
        bundle: Mapping[str, Any],
        validation_status: str,
    ) -> object: ...


@dataclass(frozen=True, slots=True)
class OfficialWebSelectedWriteResult:
    selected_write_id: str
    status: str
    corpus: str
    collection: str
    release_id: str
    record_count: int
    full_record_count: int
    task_scope_display_names: list[str]
    full_impact_display_names: list[str]
    work_dir: str
    source_bundle_key: str


@dataclass(frozen=True, slots=True)
class OfficialWebSelectedWritePreviewResult:
    selected_write_id: str
    status: str
    corpus: str
    collection: str
    record_count: int
    full_record_count: int
    work_dir: str
    source_bundle_key: str
    bundle: dict[str, object]
    full_bundle: dict[str, object]


@dataclass(frozen=True, slots=True)
class _PreparedSelectedWriteProjection:
    selected_write_id: str
    source_bundle_key: str
    generated_at: str
    corpus: str
    collection: str
    bundle: dict[str, object]
    task_scope_bundle: dict[str, object]


def _source_document(*, selected_write_task: dict[str, object]) -> dict[str, object]:
    evidence = _evidence(selected_write_task)
    return {
        "title": selected_write_task.get("inventoryId") or selected_write_task.get("inventory_id"),
        "source_refs": _string_list(evidence.get("sourceUrls")),
    }


def _selected_write_field_review(selected_write_task: dict[str, object]) -> dict[str, object]:
    evidence = _evidence(selected_write_task)
    return {
        "field_status": {
            str(key).strip(): str(value).strip()
            for key, value in _object_mapping(
                evidence.get("fieldStatus") or evidence.get("field_status")
            ).items()
            if str(key).strip() and str(value).strip()
        },
        "required_fields": _string_list(
            evidence.get("requiredFields") or evidence.get("required_fields")
        ),
        "optional_fields": _string_list(
            evidence.get("optionalFields") or evidence.get("optional_fields")
        ),
    }


def _target_label(selected_write_task: dict[str, object]) -> str:
    return str(
        _evidence(selected_write_task).get("targetLabel")
        or _evidence(selected_write_task).get("target_label")
        or ""
    ).strip()


def _candidate_source_ref(
    *,
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
) -> str:
    inventory_id = _require_text(
        selected_write_task.get("inventoryId") or selected_write_task.get("inventory_id"),
        "inventoryId",
    )
    raw_version_id = _require_text(candidate.get("raw_version_id"), "candidate.raw_version_id")
    return f"official_web:{inventory_id}:{raw_version_id}"


def _candidate_public_source_ref(candidate: Mapping[str, object]) -> str:
    typed_candidate = _object_mapping(candidate.get("typed_candidate"))
    return str(
        typed_candidate.get("source_url") or candidate.get("normalized_canonical_url") or ""
    ).strip()


def _public_source_refs_for_selected_write_task(
    selected_write_task: dict[str, object],
) -> list[str]:
    evidence = _evidence(selected_write_task)
    urls = _string_list(evidence.get("sourceUrls") or evidence.get("source_urls"))
    refs = []
    for item in _mapping_list(evidence.get("sourceRefs") or evidence.get("source_refs")):
        ref_url = str(
            item.get("normalized_canonical_url") or item.get("normalizedCanonicalUrl") or ""
        ).strip()
        if ref_url:
            refs.append(ref_url)
    return _unique_strings([*urls, *refs])


def _release_task_model(
    release_task: Mapping[str, object] | OfficialWebReleaseTask,
) -> OfficialWebReleaseTask:
    return (
        release_task
        if isinstance(release_task, OfficialWebReleaseTask)
        else OfficialWebReleaseTask.from_payload(release_task)
    )


def _assert_selected_write_release_task(task: OfficialWebReleaseTask) -> None:
    if task.task_type not in {
        "official_web_selected_write_contact_directory",
        "official_web_selected_write_service_guide",
        "official_web_selected_write_academic_calendar",
    }:
        raise OfficialWebSelectedWriteReleaseError(
            code="unsupported_selected_write_release_task_type",
            message=f"unsupported selected-write release task type: {task.task_type}",
        )
    if task.status not in {"claimed", "running"}:
        raise OfficialWebSelectedWriteReleaseError(
            code="selected_write_release_task_not_claimed",
            message="selected-write release task must already be claimed or running.",
        )
    _require_text(_selected_write_target_from_task(task), "selectedWriteTarget")
    _require_text(task.job_id, "jobId")
    _assert_machine_field_review_ready(task.input_ref)


def _assert_machine_field_review_ready(input_ref: Mapping[str, object]) -> None:
    field_status = _object_mapping(input_ref.get("fieldStatus") or input_ref.get("field_status"))
    if not field_status:
        raise OfficialWebSelectedWriteReleaseError(
            code="missing_machine_field_review",
            message="selected-write task evidence must include fieldStatus.",
        )
    required_fields = _string_list(
        input_ref.get("requiredFields") or input_ref.get("required_fields")
    )
    optional_fields = _string_list(
        input_ref.get("optionalFields") or input_ref.get("optional_fields")
    )
    missing_required = [
        field_name
        for field_name in required_fields
        if str(field_status.get(field_name) or "").strip() != "present"
    ]
    if missing_required:
        raise OfficialWebSelectedWriteReleaseError(
            code="machine_field_review_not_ready",
            message=(
                "selected-write task required fieldStatus is not ready: "
                + ", ".join(sorted(missing_required))
            ),
        )
    unsupported_optional = [
        field_name
        for field_name in optional_fields
        if str(field_status.get(field_name) or "").strip()
        not in {"present", "source_not_provided", "not_applicable"}
    ]
    if unsupported_optional:
        raise OfficialWebSelectedWriteReleaseError(
            code="machine_field_review_not_ready",
            message=(
                "selected-write task optional fieldStatus is not ready: "
                + ", ".join(sorted(unsupported_optional))
            ),
        )
    if not required_fields:
        raise OfficialWebSelectedWriteReleaseError(
            code="missing_machine_field_review_required_fields",
            message="selected-write task evidence must include requiredFields.",
        )


def _selected_write_task_from_release_task(task: OfficialWebReleaseTask) -> dict[str, object]:
    return {
        "createdAt": task.created_at.isoformat(),
        "evidenceJson": dict(task.input_ref),
        "inventoryId": task.inventory_id,
        "jobId": task.job_id,
        "runId": task.run_id,
        "selectedWriteId": task.task_id,
        "selectedWriteTarget": _selected_write_target_from_task(task),
        "updatedAt": task.updated_at.isoformat(),
    }


def _selected_write_target_from_task(task: OfficialWebReleaseTask) -> str:
    if task.selected_write_target:
        return task.selected_write_target
    if task.task_type == "official_web_selected_write_contact_directory":
        return "campus_services/contact_directory"
    if task.task_type == "official_web_selected_write_service_guide":
        return "campus_services/service_guide"
    if task.task_type == "official_web_selected_write_academic_calendar":
        return "calendar/academic_calendar"
    return ""


def _object_mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _mapping_list(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _as_mapping(value: object) -> dict[str, object]:
    if is_dataclass(value):
        return asdict(value)
    return _object_mapping(value)


def _evidence(selected_write_task: dict[str, object]) -> dict[str, object]:
    return _object_mapping(
        selected_write_task.get("evidenceJson") or selected_write_task.get("evidence")
    )


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _unique_strings(values: Sequence[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        normalized = str(value).strip()
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_payload",
            message=f"{field_name} must be a non-empty string.",
        )
    return value.strip()


def _stable_record_id(*, prefix: str, seed: Mapping[str, object]) -> str:
    digest = hashlib.sha1(
        json.dumps(seed, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:16]
    return f"{prefix}:{digest}"
