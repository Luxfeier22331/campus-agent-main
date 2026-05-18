from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path


def build_source_pack_seam_report(
    *,
    source_pack_plan: Mapping[str, object],
    actual_run_id: str,
    collector_result: Mapping[str, object],
    consumer_result: Mapping[str, object],
    db_run: Mapping[str, object],
    drain_result: Mapping[str, object],
    event_id: str,
    execution_report: Mapping[str, object],
    execution_report_path: Path,
    local_run_id: str,
    output_root: Path,
    source_truth_bundle_payload: Mapping[str, object],
    target_seed: Mapping[str, object],
) -> dict[str, object]:
    crawl_run = _object_mapping(collector_result.get("crawlRun"))
    counters = _object_mapping(crawl_run.get("counters"))
    denominator = _object_mapping(counters.get("consumerDenominator"))
    uploaded_artifacts = [
        {
            "artifact_type": artifact.get("artifactType"),
            "object_key": artifact.get("ObjectKey") or artifact.get("objectKey"),
            "record_count": artifact.get("recordCount"),
        }
        for artifact in _object_list(collector_result.get("uploadedArtifacts"))
        if isinstance(artifact, dict)
    ]
    source_truth_bundle = next(
        (
            artifact
            for artifact in uploaded_artifacts
            if artifact.get("artifact_type") == "source_truth_bundle"
        ),
        {},
    )
    seeded_rows = _seeded_rows(target_seed)
    return {
        "schema_version": "official_web_source_pack_no_promotion_live_seam.v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "local_run_id": local_run_id,
        "actual_run_id": actual_run_id,
        "event_id": event_id,
        "output_root": str(output_root.resolve()),
        "source_pack": {
            "site_id": _require_text(source_pack_plan.get("siteId"), "siteId"),
            "source_pack_id": _require_text(source_pack_plan.get("sourcePackId"), "sourcePackId"),
            "entry_count": len(_object_list(source_pack_plan.get("rows"))),
            "owner_surface_counts": _count_by_key(
                _object_list(source_pack_plan.get("rows")),
                field_name="ownerSurfaces",
            ),
            "release_target_counts": _count_by_key(
                _object_list(source_pack_plan.get("rows")),
                field_name="releaseTargets",
            ),
        },
        "target_seed": {
            "declaration_version": target_seed.get("declarationVersion"),
            "preview_requeued_freshness_rows": target_seed.get("previewRequeuedFreshnessRows"),
            "seeded_row_count": len(seeded_rows),
            "seeded_rows": seeded_rows,
            "target_job_ids": _object_list(target_seed.get("targetJobIds")),
            "unique_hosts": _object_list(target_seed.get("uniqueHosts")),
            "unique_urls": _object_list(target_seed.get("uniqueUrls")),
        },
        "collector": {
            "status": crawl_run.get("status"),
            "retained_source_truth_pages": denominator.get("retainedSourceTruthPages"),
            "rejected_pages": denominator.get("rejectedPages"),
            "source_truth_bundle_record_count": source_truth_bundle.get("record_count"),
            "source_truth_bundle_object_key": source_truth_bundle.get("object_key"),
            "uploaded_object_refs": uploaded_artifacts,
            "source_truth_target_matches": _source_truth_target_matches(
                source_truth_bundle_payload
            ),
            "page_observation_target_matches": _page_observation_target_matches(
                output_root / "collector-output" / "page-observations.jsonl"
            ),
        },
        "app_api": {
            "drain": drain_result,
            "db_run": db_run,
            "target_attempt_count": db_run.get("target_attempt_count"),
            "target_attempts": db_run.get("target_attempts") or [],
            "target_job_ids": db_run.get("target_job_ids") or [],
            "target_jobs": db_run.get("target_jobs") or [],
        },
        "consumer": {
            "counts": consumer_result.get("counts"),
            "execution_report_path": str(execution_report_path),
            "status": execution_report.get("status"),
            "promotion_decision": _object_mapping(execution_report.get("promotion")).get(
                "decision"
            ),
            "import_is_null": execution_report.get("import") is None,
            "error_is_null": execution_report.get("error") is None,
            "candidate_count": _object_mapping(
                _object_mapping(execution_report.get("consumerCandidateReview")).get("counts")
            ).get("candidate_count"),
            "release_tasks": _object_mapping(execution_report.get("releaseTasks")),
            **_target_report_fields(execution_report),
        },
    }


def assert_source_pack_seam_report(report: Mapping[str, object]) -> None:
    collector = _object_mapping(report.get("collector"))
    app_api = _object_mapping(report.get("app_api"))
    consumer = _object_mapping(report.get("consumer"))
    target_seed = _object_mapping(report.get("target_seed"))
    db_run = _object_mapping(app_api.get("db_run"))
    seeded_rows = _seeded_rows(target_seed)
    if not seeded_rows:
        raise RuntimeError("source-pack target seed rows are missing")
    if collector.get("status") != "completed":
        raise RuntimeError("collector did not complete")
    if int(collector.get("retained_source_truth_pages") or 0) < 1:
        raise RuntimeError("collector retained no source-truth pages")
    if consumer.get("status") != "staged":
        raise RuntimeError("consumer did not stage execution")
    if consumer.get("promotion_decision") != "staged":
        raise RuntimeError("promotion decision was not staged")
    if consumer.get("import_is_null") is not True or consumer.get("error_is_null") is not True:
        raise RuntimeError("consumer imported or errored during no-promotion seam")
    if db_run.get("ingestion_dispatch_status") != "dispatched":
        raise RuntimeError("app-api dispatch status was not dispatched")
    if db_run.get("ingestion_execution_status") != "staged":
        raise RuntimeError("app-api execution status was not staged")
    if db_run.get("ingestion_execution_error_code") is not None:
        raise RuntimeError("app-api execution status has an error")
    seeded_unique_urls = {_require_text(row.get("targetUrl"), "targetUrl") for row in seeded_rows}
    target_attempts = _object_list(app_api.get("target_attempts"))
    attempted_urls = {
        _require_text(attempt.get("normalizedCanonicalUrl"), "normalizedCanonicalUrl")
        for attempt in target_attempts
        if isinstance(attempt, dict) and attempt.get("normalizedCanonicalUrl")
    }
    if not seeded_unique_urls.issubset(attempted_urls):
        raise RuntimeError("app-api target attempts did not cover the source-pack unique urls")
    if not app_api.get("target_job_ids"):
        raise RuntimeError("app-api target job ids are missing from seam evidence")
    source_truth_target_matches = _object_list(collector.get("source_truth_target_matches"))
    page_observation_target_matches = _object_list(collector.get("page_observation_target_matches"))
    for seeded_row in seeded_rows:
        expected_target_url = _require_text(seeded_row.get("targetUrl"), "targetUrl")
        expected_target_job_id = _require_text(seeded_row.get("targetJobId"), "targetJobId")
        expected_target_candidate_id = _require_text(
            seeded_row.get("targetCandidateId"), "targetCandidateId"
        )
        matched_seed_target = any(
            isinstance(match, dict)
            and match.get("normalizedCanonicalUrl") == expected_target_url
            and match.get("targetJobId") == expected_target_job_id
            and match.get("targetCandidateId") == expected_target_candidate_id
            for match in source_truth_target_matches
        )
        matched_observation = next(
            (
                match
                for match in page_observation_target_matches
                if isinstance(match, dict)
                and match.get("normalizedCanonicalUrl") == expected_target_url
                and match.get("targetJobId") == expected_target_job_id
                and match.get("targetCandidateId") == expected_target_candidate_id
            ),
            None,
        )
        if matched_seed_target:
            continue
        if isinstance(matched_observation, dict) and matched_observation.get("disposition") in {
            "deleted",
            "fetch_failed",
        }:
            continue
        if not matched_seed_target:
            raise RuntimeError("source-truth target matches did not cover the seeded target rows")
    if consumer.get("target_lineage_issues"):
        raise RuntimeError("consumer reported target lineage issues")
    coverage_seed_rows = _coverage_seed_rows(
        seeded_rows=seeded_rows,
        page_observation_target_matches=page_observation_target_matches,
    )
    expected_target_family_counts = Counter(
        _require_text(row.get("consumerFamily"), "consumerFamily") for row in coverage_seed_rows
    )
    expected_materialization_policy_counts = Counter(
        _require_text(row.get("materializationPolicy"), "materializationPolicy")
        for row in coverage_seed_rows
    )
    actual_target_family_counts = _int_mapping(consumer.get("target_family_counts"))
    if not _counter_covers_seed_rows(
        actual_counts=actual_target_family_counts,
        expected_seed_counts=dict(expected_target_family_counts),
    ):
        raise RuntimeError("consumer target family counts did not cover source-pack seed rows")
    actual_target_materialization_policy_counts = _int_mapping(
        consumer.get("target_materialization_policy_counts")
    )
    if not _counter_covers_seed_rows(
        actual_counts=actual_target_materialization_policy_counts,
        expected_seed_counts=dict(expected_materialization_policy_counts),
    ):
        raise RuntimeError(
            "consumer target materialization policy counts did not cover source-pack seed rows"
        )
    selected_write = _object_mapping(consumer.get("selected_write"))
    target_field_reviews = _object_list(consumer.get("target_field_reviews"))
    release_tasks = _object_mapping(consumer.get("release_tasks"))
    if selected_write.get("decision") in {"dry_run_ready", "partial_dry_run_ready"}:
        if int(consumer.get("selected_write_ready_count") or 0) < 1:
            raise RuntimeError("consumer selected-write ready count is missing")
        if not target_field_reviews:
            raise RuntimeError("consumer target field reviews are missing")
        if release_tasks.get("enabled") is not True:
            raise RuntimeError("consumer release task admission is not enabled")
        if int(release_tasks.get("admittedCount") or 0) < 1:
            raise RuntimeError("consumer did not admit any selected-write release tasks")
        if not _object_list(release_tasks.get("taskIds")):
            raise RuntimeError("consumer release task ids are missing")
        ready_reviews = [
            review
            for review in target_field_reviews
            if isinstance(review, dict) and review.get("status") == "ready_for_selected_write"
        ]
        if not ready_reviews:
            raise RuntimeError("consumer target field reviews did not mark a ready record")
        for review in ready_reviews:
            summary = _object_mapping(_object_mapping(review).get("summary"))
            field_status = _object_mapping(summary.get("fieldStatus"))
            required_fields = [
                str(field_name)
                for field_name in _object_list(summary.get("requiredFields"))
                if str(field_name).strip()
            ]
            if not field_status or not required_fields:
                raise RuntimeError("consumer target field reviews lack field status denominator")
            missing_required = [
                field_name
                for field_name in required_fields
                if str(field_status.get(field_name) or "") != "present"
            ]
            if missing_required:
                raise RuntimeError("consumer target field reviews have missing required fields")


def _seeded_rows(target_seed: Mapping[str, object]) -> list[dict[str, object]]:
    return [
        row
        for row in _object_list(target_seed.get("seededRows") or target_seed.get("seeded_rows"))
        if isinstance(row, dict)
    ]


def _counter_covers_seed_rows(
    *,
    actual_counts: Mapping[str, int],
    expected_seed_counts: Mapping[str, int],
) -> bool:
    for key, expected_count in expected_seed_counts.items():
        if int(actual_counts.get(key) or 0) < int(expected_count):
            return False
    return True


def _coverage_seed_rows(
    *,
    seeded_rows: list[dict[str, object]],
    page_observation_target_matches: list[object],
) -> list[dict[str, object]]:
    skipped_dispositions = {"deleted", "fetch_failed"}
    skipped_keys = {
        (
            _optional_text(match.get("normalizedCanonicalUrl")),
            _optional_text(match.get("targetJobId")),
            _optional_text(match.get("targetCandidateId")),
        )
        for raw_match in page_observation_target_matches
        if isinstance(raw_match, dict)
        for match in [_object_mapping(raw_match)]
        if _optional_text(match.get("disposition")) in skipped_dispositions
    }
    return [
        row
        for row in seeded_rows
        if (
            _require_text(row.get("targetUrl"), "targetUrl"),
            _require_text(row.get("targetJobId"), "targetJobId"),
            _require_text(row.get("targetCandidateId"), "targetCandidateId"),
        )
        not in skipped_keys
    ]


def _source_truth_target_matches(
    source_truth_bundle_payload: Mapping[str, object],
) -> list[dict[str, object]]:
    matches: list[dict[str, object]] = []
    for page in _object_list(source_truth_bundle_payload.get("pages")):
        page_mapping = _object_mapping(page)
        normalized_canonical_url = _optional_text(
            page_mapping.get("normalized_canonical_url")
            or page_mapping.get("normalizedCanonicalUrl")
        )
        for target_match in _object_list(
            page_mapping.get("target_matches") or page_mapping.get("targetMatches")
        ):
            target_match_mapping = _object_mapping(target_match)
            matches.append(
                {
                    "normalizedCanonicalUrl": normalized_canonical_url,
                    "targetJobId": _optional_text(
                        target_match_mapping.get("target_job_id")
                        or target_match_mapping.get("targetJobId")
                    ),
                    "targetCandidateId": _optional_text(
                        target_match_mapping.get("target_candidate_id")
                        or target_match_mapping.get("targetCandidateId")
                    ),
                }
            )
    return matches


def _page_observation_target_matches(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    matches: list[dict[str, object]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue
        observation = _object_mapping(json.loads(raw_line))
        normalized_canonical_url = _optional_text(
            observation.get("normalized_canonical_url") or observation.get("normalizedCanonicalUrl")
        )
        disposition = _optional_text(observation.get("disposition"))
        target_matches = _object_list(
            observation.get("target_matches") or observation.get("targetMatches")
        )
        if target_matches:
            for target_match in target_matches:
                target_match_mapping = _object_mapping(target_match)
                matches.append(
                    {
                        "normalizedCanonicalUrl": normalized_canonical_url,
                        "targetJobId": _optional_text(
                            target_match_mapping.get("target_job_id")
                            or target_match_mapping.get("targetJobId")
                        ),
                        "targetCandidateId": _optional_text(
                            target_match_mapping.get("target_candidate_id")
                            or target_match_mapping.get("targetCandidateId")
                        ),
                        "disposition": disposition,
                    }
                )
            continue
        target_job_id = _optional_text(
            observation.get("target_job_id") or observation.get("targetJobId")
        )
        target_candidate_id = _optional_text(
            observation.get("target_candidate_id") or observation.get("targetCandidateId")
        )
        if target_job_id and target_candidate_id:
            matches.append(
                {
                    "normalizedCanonicalUrl": normalized_canonical_url,
                    "targetJobId": target_job_id,
                    "targetCandidateId": target_candidate_id,
                    "disposition": disposition,
                }
            )
    return matches


def _count_by_key(rows: list[object], *, field_name: str) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for raw_row in rows:
        row = _object_mapping(raw_row)
        raw_values = row.get(field_name)
        if isinstance(raw_values, list):
            for value in raw_values:
                if isinstance(value, str) and value.strip():
                    counter[value.strip()] += 1
    return dict(counter)


def _sorted_unique(values: Sequence[object]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value).strip()})


def _target_report_fields(execution_report: Mapping[str, object]) -> dict[str, object]:
    replay = _object_mapping(execution_report.get("replay"))
    coverage = _object_mapping(execution_report.get("coverage"))
    consumer_candidate_review = _object_mapping(execution_report.get("consumerCandidateReview"))
    consumer_candidate_review_counts = _object_mapping(consumer_candidate_review.get("counts"))
    target_lineage_issues = _object_list(
        coverage.get("targetLineageIssues") or replay.get("target_lineage_issues")
    )
    return {
        "selected_write": _object_mapping(consumer_candidate_review.get("selectedWrite")),
        "selected_write_ready_count": consumer_candidate_review_counts.get(
            "selected_write_ready_count"
        ),
        "target_field_reviews": _object_list(consumer_candidate_review.get("targetFieldReviews")),
        "target_family_counts": _int_mapping(
            coverage.get("targetFamilyCounts") or replay.get("target_family_counts")
        ),
        "target_lineage_issues": target_lineage_issues,
        "target_materialization_policy_counts": _int_mapping(
            coverage.get("targetMaterializationPolicyCounts")
            or replay.get("target_materialization_policy_counts")
        ),
    }


def _object_mapping(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _object_list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def _int_mapping(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, int] = {}
    for key, item in value.items():
        if isinstance(key, str) and isinstance(item, int):
            result[key] = item
    return result


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"{field_name} is required")
    return value.strip()


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None
