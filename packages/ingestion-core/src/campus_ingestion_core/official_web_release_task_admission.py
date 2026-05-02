from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from campus_ingestion_core.official_web_release_task import (
    OfficialWebReleaseTask,
    build_official_web_release_task,
)
from campus_ingestion_core.official_web_release_task_store import OfficialWebReleaseTaskStore

_SELECTED_WRITE_TASK_TYPE_BY_TARGET = {
    "campus_services/contact_directory": "official_web_selected_write_contact_directory",
    "campus_services/service_guide": "official_web_selected_write_service_guide",
}


def build_stable_reference_release_task_from_gate(
    release_gate: Mapping[str, Any],
    *,
    now: datetime | None = None,
) -> OfficialWebReleaseTask:
    decision = _optional_text(release_gate.get("decision"))
    status = _optional_text(release_gate.get("status"))
    if decision != "approved" or status != "approved":
        raise ValueError("stable-reference release gate must be approved before task admission")
    evidence = _mapping(
        release_gate.get("evidenceJson") or release_gate.get("evidence") or {},
        "evidenceJson",
    )
    selected_write_target = _optional_text(
        evidence.get("selectedWriteTarget") or evidence.get("selected_write_target")
    )
    if selected_write_target != "official_web/stable_reference":
        raise ValueError("release gate is not a stable-reference target")
    input_ref = _release_input_ref(
        evidence=evidence,
        policy_version="official_web_stable_reference_release_task_admission.v1",
    )
    return build_official_web_release_task(
        input_ref=input_ref,
        inventory_id=_required_text(release_gate.get("inventoryId"), "inventoryId"),
        job_id=_required_text(release_gate.get("jobId"), "jobId"),
        now=now,
        publish_alias=release_gate.get("publishAlias") is True,
        run_id=_required_text(release_gate.get("runId"), "runId"),
        selected_write_target="official_web/stable_reference",
        task_id=_required_text(release_gate.get("releaseId"), "releaseId"),
        task_type="official_web_stable_reference",
    )


def build_selected_write_release_task_from_candidate(
    candidate: Mapping[str, Any],
    *,
    run_id: str,
    source_object_keys: Sequence[str],
    now: datetime | None = None,
) -> OfficialWebReleaseTask:
    if candidate.get("ready_for_selected_write") is not True:
        raise ValueError("selected-write candidate is not ready for task admission")
    selected_write_target = _required_text(
        candidate.get("selected_write_target") or candidate.get("selectedWriteTarget"),
        "selected_write_target",
    )
    task_type = _SELECTED_WRITE_TASK_TYPE_BY_TARGET.get(selected_write_target)
    if task_type is None:
        raise ValueError(f"unsupported selected-write target: {selected_write_target}")
    candidate_key = _required_text(
        candidate.get("candidate_key") or candidate.get("candidateKey"),
        "candidate_key",
    )
    evidence = {
        "candidateKey": candidate_key,
        "inventoryId": _optional_text(candidate.get("inventory_id")),
        "matchedEvidence": _string_list(
            candidate.get("matched_evidence") or candidate.get("matchedEvidence")
        ),
        "normalizedCanonicalUrl": _required_text(
            candidate.get("normalized_canonical_url") or candidate.get("normalizedCanonicalUrl"),
            "normalized_canonical_url",
        ),
        "reviewVerdict": _optional_text(candidate.get("review_verdict")),
        "selectedWriteTarget": selected_write_target,
        "sourceObjectKeys": _required_string_list(source_object_keys, "source_object_keys"),
        "sourceRef": _mapping(candidate.get("source_ref") or {}, "source_ref"),
        "sourceUrls": [
            _required_text(
                candidate.get("normalized_canonical_url")
                or candidate.get("normalizedCanonicalUrl"),
                "normalized_canonical_url",
            )
        ],
        "targetCandidateId": _optional_text(candidate.get("target_candidate_id")),
        "targetDeclarationVersion": _optional_text(candidate.get("target_declaration_version")),
        "targetId": _optional_text(candidate.get("target_id")),
        "typedCandidateSchemaVersion": _optional_text(
            candidate.get("typed_candidate_schema_version")
        ),
    }
    return build_official_web_release_task(
        input_ref=_release_input_ref(
            evidence=evidence,
            policy_version="official_web_selected_write_release_task_admission.v1",
        ),
        inventory_id=_optional_text(candidate.get("inventory_id")) or candidate_key,
        job_id=_required_text(candidate.get("target_job_id"), "target_job_id"),
        now=now,
        publish_alias=False,
        run_id=_required_text(run_id, "run_id"),
        selected_write_target=selected_write_target,
        task_id=_selected_write_task_id(candidate_key=candidate_key),
        task_type=task_type,
    )


def admit_selected_write_release_tasks_from_review(
    *,
    release_task_store: OfficialWebReleaseTaskStore,
    review_report: Mapping[str, Any],
    run_id: str,
    source_object_keys: Sequence[str],
    now: datetime | None = None,
) -> tuple[OfficialWebReleaseTask, ...]:
    selected_write = _mapping(review_report.get("selectedWrite") or {}, "selectedWrite")
    if selected_write.get("decision") != "dry_run_ready":
        return ()
    candidates = review_report.get("candidates")
    if not isinstance(candidates, list):
        return ()
    admitted: list[OfficialWebReleaseTask] = []
    for candidate in candidates:
        if not isinstance(candidate, Mapping):
            continue
        if candidate.get("ready_for_selected_write") is not True:
            continue
        task = build_selected_write_release_task_from_candidate(
            candidate,
            now=now,
            run_id=run_id,
            source_object_keys=source_object_keys,
        )
        admitted.append(release_task_store.create_or_get_task(task))
    return tuple(admitted)


def _release_input_ref(
    *,
    evidence: Mapping[str, Any],
    policy_version: str,
) -> dict[str, Any]:
    payload = dict(evidence)
    payload["policyVersion"] = policy_version
    payload["sourceObjectKeys"] = _required_string_list(
        payload.get("sourceObjectKeys") or payload.get("source_object_keys"),
        "sourceObjectKeys",
    )
    source_urls = _string_list(payload.get("sourceUrls") or payload.get("source_urls"))
    if source_urls:
        payload["sourceUrls"] = source_urls
    return payload


def _selected_write_task_id(*, candidate_key: str) -> str:
    digest = hashlib.sha256(candidate_key.encode("utf-8")).hexdigest()[:24]
    return f"owrelease_selected_write_{digest}"


def _mapping(value: Any, field_name: str) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    raise ValueError(f"{field_name} must be an object")


def _optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _required_text(value: Any, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    return text


def _required_string_list(value: Any, field_name: str) -> list[str]:
    values = _string_list(value)
    if not values:
        raise ValueError(f"{field_name} must contain at least one item")
    return values


def _string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


__all__ = [
    "admit_selected_write_release_tasks_from_review",
    "build_selected_write_release_task_from_candidate",
    "build_stable_reference_release_task_from_gate",
]
