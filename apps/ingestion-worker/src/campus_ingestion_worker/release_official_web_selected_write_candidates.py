from __future__ import annotations

from collections.abc import Mapping

from campus_ingestion_worker.release_official_web_selected_write_common import (
    OfficialWebSelectedWriteReleaseError,
    _evidence,
    _object_mapping,
    _require_text,
    _string_list,
)


def _matching_selected_write_candidates(
    *,
    replay_report: Mapping[str, object],
    selected_write_task: dict[str, object],
) -> list[dict[str, object]]:
    selected_write_target = _require_text(
        selected_write_task.get("selectedWriteTarget"),
        "selectedWriteTarget",
    )
    job_id = _require_text(selected_write_task.get("jobId"), "jobId")
    source_urls = _string_list(_evidence(selected_write_task).get("sourceUrls"))
    candidates = replay_report.get("consumer_candidate_pages")
    if not isinstance(candidates, list):
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_replay_report",
            message="replay report consumer_candidate_pages must be an array.",
        )
    matched: list[dict[str, object]] = []
    for item in candidates:
        candidate = _object_mapping(item)
        if candidate.get("target_job_id") != job_id:
            continue
        if candidate.get("selected_write_target") != selected_write_target:
            continue
        if source_urls and candidate.get("normalized_canonical_url") not in source_urls:
            continue
        if candidate.get("materialization_policy") != "candidate_only":
            continue
        if _object_mapping(candidate.get("quality_gate")).get("decision") != "pass":
            continue
        if not _object_mapping(candidate.get("typed_candidate")):
            continue
        matched.append(candidate)
    return matched
