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
_SELECTED_WRITE_ADMISSION_POLICY_VERSION = "official_web_selected_write_release_task_admission.v4"


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
    field_status = _mapping(
        candidate.get("field_status") or candidate.get("fieldStatus"),
        "field_status",
    )
    if not field_status:
        raise ValueError("field_status must contain at least one item")
    required_fields = _required_string_list(
        candidate.get("required_fields") or candidate.get("requiredFields"),
        "required_fields",
    )
    required_evidence = _string_list(
        candidate.get("required_evidence") or candidate.get("requiredEvidence")
    )
    optional_fields = _string_list(
        candidate.get("optional_fields") or candidate.get("optionalFields")
    )
    optional_evidence = _string_list(
        candidate.get("optional_evidence") or candidate.get("optionalEvidence")
    )
    _assert_selected_write_field_status_ready(
        field_status=field_status,
        optional_fields=optional_fields,
        required_fields=required_fields,
    )
    source_ref = _mapping(candidate.get("source_ref") or {}, "source_ref")
    _required_text(
        source_ref.get("raw_asset_id") or source_ref.get("rawAssetId"),
        "source_ref.raw_asset_id",
    )
    _required_text(
        source_ref.get("raw_version_id") or source_ref.get("rawVersionId"),
        "source_ref.raw_version_id",
    )
    source_refs = _source_refs(candidate=candidate, fallback_source_ref=source_ref)
    source_urls = _source_urls_from_refs(
        source_refs=source_refs,
        fallback_url=_required_text(
            candidate.get("normalized_canonical_url") or candidate.get("normalizedCanonicalUrl"),
            "normalized_canonical_url",
        ),
    )
    evidence = {
        "candidateKey": candidate_key,
        "fieldStatus": dict(field_status),
        "inventoryId": _optional_text(candidate.get("inventory_id")),
        "matchedEvidence": _string_list(
            candidate.get("matched_evidence") or candidate.get("matchedEvidence")
        ),
        "normalizedCanonicalUrl": _required_text(
            candidate.get("normalized_canonical_url") or candidate.get("normalizedCanonicalUrl"),
            "normalized_canonical_url",
        ),
        "requiredEvidence": required_evidence,
        "requiredFields": required_fields,
        "optionalEvidence": optional_evidence,
        "optionalFields": optional_fields,
        "reviewVerdict": _optional_text(candidate.get("review_verdict")),
        "selectedWriteTarget": selected_write_target,
        "sourceObjectKeys": _required_string_list(source_object_keys, "source_object_keys"),
        "sourceRef": source_ref,
        "sourceRefs": source_refs,
        "sourceUrls": source_urls,
        "targetCandidateId": _optional_text(candidate.get("target_candidate_id")),
        "targetDeclarationVersion": _optional_text(candidate.get("target_declaration_version")),
        "targetId": _optional_text(candidate.get("target_id")),
        "typedCandidateSchemaVersion": _optional_text(
            candidate.get("typed_candidate_schema_version")
        ),
    }
    target_label = _optional_text(candidate.get("target_label") or candidate.get("targetLabel"))
    if target_label is not None:
        evidence["targetLabel"] = target_label
    return build_official_web_release_task(
        input_ref=_release_input_ref(
            evidence=evidence,
            policy_version=_SELECTED_WRITE_ADMISSION_POLICY_VERSION,
        ),
        inventory_id=_optional_text(candidate.get("inventory_id")) or candidate_key,
        job_id=_required_text(candidate.get("target_job_id"), "target_job_id"),
        now=now,
        publish_alias=False,
        run_id=_required_text(run_id, "run_id"),
        selected_write_target=selected_write_target,
        task_id=_selected_write_task_id(
            candidate_key=candidate_key,
            policy_version=_SELECTED_WRITE_ADMISSION_POLICY_VERSION,
        ),
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
    if selected_write.get("decision") not in {"dry_run_ready", "partial_dry_run_ready"}:
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


def _source_refs(
    *,
    candidate: Mapping[str, Any],
    fallback_source_ref: Mapping[str, Any],
) -> list[dict[str, Any]]:
    raw_refs = candidate.get("source_refs") or candidate.get("sourceRefs")
    refs: list[dict[str, Any]] = []
    if isinstance(raw_refs, Sequence) and not isinstance(raw_refs, str | bytes):
        for raw_ref in raw_refs:
            if not isinstance(raw_ref, Mapping):
                continue
            normalized_url = _optional_text(
                raw_ref.get("normalized_canonical_url") or raw_ref.get("normalizedCanonicalUrl")
            )
            if not normalized_url:
                continue
            refs.append(
                {
                    "source_channel": _optional_text(
                        raw_ref.get("source_channel") or raw_ref.get("sourceChannel")
                    )
                    or "official_web",
                    "raw_asset_id": _optional_text(
                        raw_ref.get("raw_asset_id") or raw_ref.get("rawAssetId")
                    )
                    or "",
                    "raw_version_id": _optional_text(
                        raw_ref.get("raw_version_id") or raw_ref.get("rawVersionId")
                    )
                    or "",
                    "normalized_canonical_url": normalized_url,
                }
            )
    if not refs:
        refs.append(
            {
                "source_channel": _optional_text(
                    fallback_source_ref.get("source_channel")
                    or fallback_source_ref.get("sourceChannel")
                )
                or "official_web",
                "raw_asset_id": _required_text(
                    fallback_source_ref.get("raw_asset_id")
                    or fallback_source_ref.get("rawAssetId"),
                    "source_ref.raw_asset_id",
                ),
                "raw_version_id": _required_text(
                    fallback_source_ref.get("raw_version_id")
                    or fallback_source_ref.get("rawVersionId"),
                    "source_ref.raw_version_id",
                ),
                "normalized_canonical_url": _required_text(
                    fallback_source_ref.get("normalized_canonical_url")
                    or fallback_source_ref.get("normalizedCanonicalUrl"),
                    "source_ref.normalized_canonical_url",
                ),
            }
        )
    return _dedupe_source_refs(refs)


def _source_urls_from_refs(
    *,
    source_refs: Sequence[Mapping[str, Any]],
    fallback_url: str,
) -> list[str]:
    urls = [
        url
        for url in (
            _optional_text(ref.get("normalized_canonical_url") or ref.get("normalizedCanonicalUrl"))
            for ref in source_refs
        )
        if url
    ]
    if not urls:
        urls = [_required_text(fallback_url, "normalized_canonical_url")]
    return _dedupe_strings(urls)


def _dedupe_source_refs(refs: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ref in refs:
        normalized_url = _optional_text(
            ref.get("normalized_canonical_url") or ref.get("normalizedCanonicalUrl")
        )
        if not normalized_url or normalized_url in seen:
            continue
        seen.add(normalized_url)
        result.append(dict(ref))
    return result


def _dedupe_strings(values: Sequence[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value).strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _selected_write_task_id(*, candidate_key: str, policy_version: str) -> str:
    digest = hashlib.sha256(f"{policy_version}:{candidate_key}".encode()).hexdigest()[:24]
    return f"owrelease_selected_write_{digest}"


def _assert_selected_write_field_status_ready(
    *,
    field_status: Mapping[str, Any],
    optional_fields: Sequence[str],
    required_fields: Sequence[str],
) -> None:
    missing_required = [
        field_name
        for field_name in required_fields
        if str(field_status.get(field_name) or "").strip() != "present"
    ]
    if missing_required:
        raise ValueError("field_status must be present for every required selected-write field")
    optional_field_set = set(optional_fields)
    unsupported_optional = [
        field_name
        for field_name in optional_field_set
        if str(field_status.get(field_name) or "").strip()
        not in {"present", "source_not_provided", "not_applicable"}
    ]
    if unsupported_optional:
        raise ValueError("field_status contains unsupported optional selected-write field status")


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
