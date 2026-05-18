from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path


def _object_mapping(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _int_mapping(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, int] = {}
    for key, item in value.items():
        if isinstance(key, str) and isinstance(item, int):
            result[key] = item
    return result


def _object_list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def _target_report_fields(execution_report: dict[str, object]) -> dict[str, object]:
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


def build_seam_report(
    *,
    actual_run_id: str,
    collector_result: dict[str, object],
    consumer_result: dict[str, object],
    db_run: dict[str, object],
    drain_result: dict[str, object],
    event_id: str,
    execution_report: dict[str, object],
    execution_report_path: Path,
    local_run_id: str,
    output_root: Path,
    target_seed: dict[str, object],
) -> dict[str, object]:
    crawl_run = collector_result["crawlRun"]
    assert isinstance(crawl_run, dict)
    counters = crawl_run.get("counters")
    assert isinstance(counters, dict)
    denominator = counters.get("consumerDenominator")
    assert isinstance(denominator, dict)
    source_bundle = next(
        artifact
        for artifact in collector_result["uploadedArtifacts"]
        if artifact["artifactType"] == "source_truth_bundle"
    )
    uploaded_artifacts = [
        {
            "artifact_type": artifact.get("artifactType"),
            "object_key": artifact.get("objectKey"),
            "record_count": artifact.get("recordCount"),
        }
        for artifact in collector_result["uploadedArtifacts"]
        if isinstance(artifact, dict)
    ]
    target_report = _target_report_fields(execution_report)
    return {
        "schema_version": "official_web_no_promotion_live_seam.v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "local_run_id": local_run_id,
        "actual_run_id": actual_run_id,
        "event_id": event_id,
        "output_root": str(output_root.resolve()),
        "target_seed": target_seed,
        "collector": {
            "status": crawl_run.get("status"),
            "retained_source_truth_pages": denominator.get("retainedSourceTruthPages"),
            "rejected_pages": denominator.get("rejectedPages"),
            "source_truth_bundle_record_count": source_bundle.get("recordCount"),
            "source_truth_bundle_object_key": source_bundle.get("objectKey"),
            "uploaded_object_refs": uploaded_artifacts,
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
            "promotion_decision": (execution_report.get("promotion") or {}).get("decision"),
            "import_is_null": execution_report.get("import") is None,
            "error_is_null": execution_report.get("error") is None,
            "candidate_count": (
                (execution_report.get("consumerCandidateReview") or {})
                .get("counts", {})
                .get("candidate_count")
            ),
            "release_tasks": _object_mapping(execution_report.get("releaseTasks")),
            **target_report,
        },
    }


def assert_seam_report(report: dict[str, object]) -> None:
    collector = report["collector"]
    app_api = report["app_api"]
    consumer = report["consumer"]
    target_seed = _object_mapping(report.get("target_seed"))
    assert isinstance(collector, dict)
    assert isinstance(app_api, dict)
    assert isinstance(consumer, dict)
    db_run = app_api["db_run"]
    assert isinstance(db_run, dict)
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
    if int(app_api.get("target_attempt_count") or 0) < 1:
        raise RuntimeError("app-api recorded no target attempts for the seam run")
    if not app_api.get("target_job_ids"):
        raise RuntimeError("app-api target job ids are missing from seam evidence")
    expected_target_url = target_seed.get("targetUrl")
    expected_target_job_id = target_seed.get("targetJobId")
    expected_target_candidate_id = target_seed.get("targetCandidateId")
    if expected_target_url and expected_target_job_id and expected_target_candidate_id:
        target_attempts = _object_list(app_api.get("target_attempts"))
        matched_seed_attempt = any(
            isinstance(attempt, dict)
            and attempt.get("normalizedCanonicalUrl") == expected_target_url
            and attempt.get("jobId") == expected_target_job_id
            and attempt.get("candidateId") == expected_target_candidate_id
            for attempt in target_attempts
        )
        if not matched_seed_attempt:
            raise RuntimeError("app-api target attempts did not match the seeded target")
    if not consumer.get("target_family_counts"):
        raise RuntimeError("consumer target family counts are missing")
    if not consumer.get("target_materialization_policy_counts"):
        raise RuntimeError("consumer target materialization policy counts are missing")
    if consumer.get("target_lineage_issues"):
        raise RuntimeError("consumer reported target lineage issues")
    selected_write = _object_mapping(consumer.get("selected_write"))
    target_field_reviews = _object_list(consumer.get("target_field_reviews"))
    if selected_write.get("decision") in {"dry_run_ready", "partial_dry_run_ready"}:
        if int(consumer.get("selected_write_ready_count") or 0) < 1:
            raise RuntimeError("consumer selected-write ready count is missing")
        if not target_field_reviews:
            raise RuntimeError("consumer target field reviews are missing")
        ready_reviews = [
            review
            for review in target_field_reviews
            if isinstance(review, dict) and review.get("status") == "ready_for_selected_write"
        ]
        if not ready_reviews:
            raise RuntimeError("consumer target field reviews did not mark a ready record")
        for review in ready_reviews:
            summary = _object_mapping(review.get("summary"))
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
        preview_records = _object_list(selected_write.get("preview_records"))
        if not preview_records:
            raise RuntimeError("consumer selected-write preview records are missing")
        for record in preview_records:
            if not isinstance(record, dict):
                raise RuntimeError("consumer selected-write preview record is invalid")
            if not _object_mapping(record.get("field_status")):
                raise RuntimeError("consumer selected-write preview records lack field status")
            if not _object_list(record.get("required_fields")):
                raise RuntimeError("consumer selected-write preview records lack required fields")
