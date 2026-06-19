from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path

import httpx

from campus_evals.langfuse_adapter import (
    LangfuseAdapterRequestError,
    LangfuseAdapterSettings,
)
from campus_evals.langfuse_dataset_projection import build_langfuse_dataset_items
from campus_evals.langfuse_review_projection import build_langfuse_review_export_item
from campus_evals.langfuse_score_report import (
    DEFAULT_REGISTRY_PATH,
    validate_langfuse_score_report,
    write_langfuse_score_report,
)
from campus_evals.langfuse_score_report import (
    SCHEMA_VERSION as SCORE_REPORT_SCHEMA_VERSION,
)

SCORE_CONFIG_SYNC_SCHEMA_VERSION = "langfuse_score_config_sync_report.v1"
DATASET_MANIFEST_SCHEMA_VERSION = "langfuse_dataset_manifest.v1"
DATASET_SYNC_REPORT_SCHEMA_VERSION = "langfuse_dataset_sync_report.v1"
EXPERIMENT_MANIFEST_SCHEMA_VERSION = "langfuse_experiment_manifest.v1"
EXPERIMENT_RESULT_SCHEMA_VERSION = "langfuse_experiment_result.v1"
REVIEW_MANIFEST_SCHEMA_VERSION = "langfuse_review_manifest.v1"
REVIEW_QUEUE_SYNC_REPORT_SCHEMA_VERSION = "langfuse_review_queue_sync_report.v1"
REVIEW_EXPORT_SCHEMA_VERSION = "langfuse_review_export.v1"


def sync_langfuse_score_configs(
    *,
    registry_path: Path = DEFAULT_REGISTRY_PATH,
    settings: LangfuseAdapterSettings,
    dry_run: bool,
    client: httpx.Client | None = None,
) -> dict[str, object]:
    registry = _load_json_object(registry_path)
    scores = _mapping_list(registry.get("scores"), "registry.scores")
    existing = {
        _required_string(item.get("name"), "score_config.name"): item
        for item in _list_paginated(settings, "/api/public/score-configs", client=client)
    }
    planned_score_names = [
        _required_string(score.get("name"), "registry.scores[].name")
        for score in scores
        if _required_string(score.get("name"), "registry.scores[].name") not in existing
    ]
    created = 0
    failed = 0
    if not dry_run:
        for score in scores:
            name = _required_string(score.get("name"), "registry.scores[].name")
            if name in existing:
                continue
            try:
                _request_json(
                    settings,
                    "POST",
                    "/api/public/score-configs",
                    json_body=_score_config_payload(score),
                    client=client,
                )
                created += 1
            except LangfuseAdapterRequestError:
                failed += 1
                raise
    return {
        "schema_version": SCORE_CONFIG_SYNC_SCHEMA_VERSION,
        "dry_run": dry_run,
        "expected": len(scores),
        "existing": len(existing),
        "planned_create": len(planned_score_names) if dry_run else 0,
        "planned_score_names": planned_score_names,
        "created": created,
        "failed": failed,
    }


def sync_langfuse_datasets(
    *,
    manifest_path: Path,
    settings: LangfuseAdapterSettings,
    dry_run: bool,
    client: httpx.Client | None = None,
) -> dict[str, object]:
    manifest = _load_json_object(manifest_path)
    _require_equal(
        manifest.get("schema_version"), DATASET_MANIFEST_SCHEMA_VERSION, "schema_version"
    )
    source_git_head = _required_string(manifest.get("source_git_head"), "source_git_head")
    datasets = _mapping_list(manifest.get("datasets"), "datasets")
    existing_dataset_names = {
        _required_string(item.get("name"), "dataset.name")
        for item in _list_paginated(settings, "/api/public/v2/datasets", client=client)
    }

    dataset_reports: list[dict[str, object]] = []
    totals = {
        "created": 0,
        "updated": 0,
        "archived": 0,
        "unchanged": 0,
        "failed": 0,
        "planned_create": 0,
        "planned_update": 0,
        "planned_archive": 0,
    }
    for dataset in datasets:
        dataset_report = _sync_one_dataset(
            dataset=dataset,
            source_git_head=source_git_head,
            settings=settings,
            dry_run=dry_run,
            existing_dataset_names=existing_dataset_names,
            client=client,
        )
        dataset_reports.append(dataset_report)
        for key in totals:
            totals[key] += int(dataset_report.get(key) or 0)

    return {
        "schema_version": DATASET_SYNC_REPORT_SCHEMA_VERSION,
        "manifest_path": str(manifest_path),
        "dry_run": dry_run,
        "datasets": dataset_reports,
        **totals,
    }


def run_langfuse_experiment(
    *,
    manifest_path: Path,
    settings: LangfuseAdapterSettings,
    client: httpx.Client | None = None,
) -> dict[str, object]:
    manifest = _load_json_object(manifest_path)
    _require_equal(
        manifest.get("schema_version"), EXPERIMENT_MANIFEST_SCHEMA_VERSION, "schema_version"
    )
    dataset_source = _required_string(manifest.get("dataset_source"), "dataset_source")
    dataset_run_id = _optional_string(manifest.get("dataset_run_id"))
    item_results: list[dict[str, object]] = []
    for item in _mapping_list(manifest.get("item_results"), "item_results"):
        item_result = dict(item)
        if dataset_source == "langfuse":
            trace_id = _required_string(item.get("trace_id"), "item_results[].trace_id")
            response = _request_json(
                settings,
                "POST",
                "/api/public/dataset-run-items",
                json_body={
                    "runName": _required_string(manifest.get("run_name"), "run_name"),
                    "runDescription": _optional_string(manifest.get("run_description")),
                    "metadata": {
                        "experiment_run_id": _required_string(
                            manifest.get("experiment_run_id"), "experiment_run_id"
                        ),
                        "variant_id": _required_string(manifest.get("variant_id"), "variant_id"),
                    },
                    "datasetItemId": _required_string(
                        item.get("dataset_item_id"), "item_results[].dataset_item_id"
                    ),
                    "traceId": trace_id,
                    "observationId": _optional_string(item.get("observation_id")),
                    "datasetVersion": _optional_string(manifest.get("dataset_version")),
                },
                client=client,
            )
            dataset_run_id = _required_string(response.get("datasetRunId"), "datasetRunId")
            item_result["dataset_run_item_id"] = _required_string(response.get("id"), "id")
        item_results.append(item_result)

    artifact = _experiment_artifact(manifest, item_results, dataset_run_id)
    artifact_path = Path(_required_string(manifest.get("artifact_path"), "artifact_path"))
    _write_json(artifact_path, artifact)
    score_report = _score_report_from_experiment_manifest(manifest, artifact, dataset_run_id)
    score_report_path = Path(
        _required_string(manifest.get("score_report_path"), "score_report_path")
    )
    write_langfuse_score_report(score_report_path, score_report)
    return {
        **artifact,
        "artifact_path": str(artifact_path),
        "score_report_path": str(score_report_path),
    }


def sync_langfuse_annotation_queue(
    *,
    manifest_path: Path,
    settings: LangfuseAdapterSettings,
    dry_run: bool,
    client: httpx.Client | None = None,
) -> dict[str, object]:
    manifest = _load_json_object(manifest_path)
    _require_equal(manifest.get("schema_version"), REVIEW_MANIFEST_SCHEMA_VERSION, "schema_version")
    queue_id = _required_string(manifest.get("queue_id"), "queue_id")
    config_ids = {
        _required_string(item.get("name"), "score_configs[].name"): _required_string(
            item.get("config_id"), "score_configs[].config_id"
        )
        for item in _mapping_list(manifest.get("score_configs"), "score_configs")
    }
    enqueued = 0
    prefilled = 0
    for item in _mapping_list(manifest.get("items"), "items"):
        object_id = _required_string(item.get("object_id"), "items[].object_id")
        object_type = _required_string(item.get("object_type"), "items[].object_type")
        if not dry_run:
            _request_json(
                settings,
                "POST",
                f"/api/public/annotation-queues/{queue_id}/items",
                json_body={"objectId": object_id, "objectType": object_type},
                client=client,
            )
        enqueued += 1
        for score in _mapping_list(item.get("prefill_scores") or [], "items[].prefill_scores"):
            score_name = _required_string(score.get("name"), "prefill_scores[].name")
            config_id = config_ids.get(score_name)
            if not config_id:
                raise ValueError(f"missing score config id for {score_name}")
            if not dry_run:
                _request_json(
                    settings,
                    "POST",
                    "/api/public/scores",
                    json_body={
                        "id": _stable_id("annotation", queue_id, object_id, score_name),
                        "traceId": object_id if object_type == "TRACE" else None,
                        "observationId": object_id if object_type == "OBSERVATION" else None,
                        "name": score_name,
                        "value": score.get("value"),
                        "dataType": _required_string(score.get("data_type"), "data_type"),
                        "comment": _optional_string(score.get("comment")),
                        "configId": config_id,
                        "source": "ANNOTATION",
                    },
                    client=client,
                )
            prefilled += 1
    return {
        "schema_version": REVIEW_QUEUE_SYNC_REPORT_SCHEMA_VERSION,
        "queue_id": queue_id,
        "dry_run": dry_run,
        "enqueued": enqueued if not dry_run else 0,
        "prefilled_scores": prefilled if not dry_run else 0,
        "planned_enqueue": enqueued if dry_run else 0,
        "planned_prefill_scores": prefilled if dry_run else 0,
    }


def export_langfuse_review_results(
    *,
    manifest_path: Path,
    output_path: Path,
    settings: LangfuseAdapterSettings,
    client: httpx.Client | None = None,
) -> dict[str, object]:
    manifest = _load_json_object(manifest_path)
    queue_id = _required_string(manifest.get("queue_id"), "queue_id")
    items = _list_paginated(
        settings,
        f"/api/public/annotation-queues/{queue_id}/items",
        query={"status": "COMPLETED"},
        client=client,
    )
    export_items = [build_langfuse_review_export_item(queue_id, item) for item in items]
    payload = {
        "schema_version": REVIEW_EXPORT_SCHEMA_VERSION,
        "queue_id": queue_id,
        "items": export_items,
    }
    _write_json(output_path, payload)
    return {**payload, "output_path": str(output_path)}


def _sync_one_dataset(
    *,
    dataset: Mapping[str, object],
    source_git_head: str,
    settings: LangfuseAdapterSettings,
    dry_run: bool,
    existing_dataset_names: set[str],
    client: httpx.Client | None,
) -> dict[str, object]:
    name = _required_string(dataset.get("name"), "datasets[].name")
    slug = _required_string(dataset.get("slug"), "datasets[].slug")
    fixture_path = _resolve_path(_required_string(dataset.get("fixture_path"), "fixture_path"))
    fixture_hash = _sha256_bytes(fixture_path.read_bytes())
    desired_items = build_langfuse_dataset_items(
        dataset, fixture_path, fixture_hash, source_git_head
    )
    existing_items = _list_paginated(
        settings,
        "/api/public/dataset-items",
        query={"datasetName": name},
        client=client,
    )
    existing_by_id = {
        _required_string(item.get("id"), "dataset_item.id"): item for item in existing_items
    }
    desired_by_id = {item["id"]: item for item in desired_items}
    planned_create = [item for item in desired_items if item["id"] not in existing_by_id]
    planned_update = [
        item
        for item in desired_items
        if item["id"] in existing_by_id
        and dict(existing_by_id[item["id"]].get("metadata") or {}).get("fixture_hash")
        != fixture_hash
    ]
    planned_archive = [
        item
        for item_id, item in existing_by_id.items()
        if item_id not in desired_by_id
        and dict(item.get("metadata") or {}).get("dataset_slug") == slug
    ]
    unchanged = len(desired_items) - len(planned_create) - len(planned_update)
    created = updated = archived = failed = 0
    if not dry_run:
        if name not in existing_dataset_names:
            _request_json(
                settings, "POST", "/api/public/v2/datasets", json_body={"name": name}, client=client
            )
        for item in planned_create:
            _request_json(
                settings, "POST", "/api/public/dataset-items", json_body=item, client=client
            )
            created += 1
        for item in planned_update:
            _request_json(
                settings, "POST", "/api/public/dataset-items", json_body=item, client=client
            )
            updated += 1
        for item in planned_archive:
            archive_payload = {
                "datasetName": name,
                "id": _required_string(item.get("id"), "dataset_item.id"),
                "status": "ARCHIVED",
                "metadata": dict(item.get("metadata") or {}),
            }
            _request_json(
                settings,
                "POST",
                "/api/public/dataset-items",
                json_body=archive_payload,
                client=client,
            )
            archived += 1
    return {
        "name": name,
        "slug": slug,
        "fixture_path": str(fixture_path),
        "fixture_hash": fixture_hash,
        "desired_items": desired_items,
        "created": created,
        "updated": updated,
        "archived": archived,
        "unchanged": unchanged,
        "failed": failed,
        "planned_create": len(planned_create) if dry_run else 0,
        "planned_update": len(planned_update) if dry_run else 0,
        "planned_archive": len(planned_archive) if dry_run else 0,
    }


def _score_report_from_experiment_manifest(
    manifest: Mapping[str, object],
    artifact: Mapping[str, object],
    dataset_run_id: str | None,
) -> dict[str, object]:
    normalized_dataset_run_id = _optional_string(dataset_run_id)
    eval_run_id = _required_string(manifest.get("experiment_run_id"), "experiment_run_id")
    score_items: list[dict[str, object]] = []
    omitted_items: list[dict[str, object]] = []
    for item in _mapping_list(artifact.get("item_results"), "item_results"):
        case_id = _required_string(item.get("case_id"), "case_id")
        trace_id = _optional_string(item.get("trace_id"))
        observation_id = _optional_string(item.get("observation_id"))
        dataset_item_id = _required_string(item.get("dataset_item_id"), "dataset_item_id")
        for score in _mapping_list(item.get("scores"), "item_results[].scores"):
            name = _required_string(score.get("name"), "score.name")
            if not (trace_id or normalized_dataset_run_id):
                omitted_items.append(
                    _experiment_omitted_item(
                        case_id=case_id,
                        source_result_id=f"{case_id}:{name}",
                        reason="missing_publish_target_identity",
                        manifest=manifest,
                    )
                )
                continue
            score_items.append(
                _score_item_from_manifest_score(
                    eval_run_id=eval_run_id,
                    case_id=case_id,
                    score=score,
                    dataset_run_id=normalized_dataset_run_id,
                    dataset_item_id=dataset_item_id,
                    trace_id=trace_id,
                    observation_id=observation_id,
                    manifest=manifest,
                )
            )
    for score in _mapping_list(artifact.get("aggregate_scores"), "aggregate_scores"):
        name = _required_string(score.get("name"), "aggregate_scores[].name")
        if normalized_dataset_run_id is None:
            omitted_items.append(
                _experiment_omitted_item(
                    case_id=_slug(f"aggregate:{name}"),
                    source_result_id=f"aggregate:{name}",
                    reason="missing_dataset_run_for_aggregate_score",
                    manifest=manifest,
                )
            )
            continue
        score_items.append(
            _score_item_from_manifest_score(
                eval_run_id=eval_run_id,
                case_id=_slug(f"aggregate:{name}"),
                score=score,
                dataset_run_id=normalized_dataset_run_id,
                dataset_item_id=None,
                trace_id=None,
                observation_id=None,
                manifest=manifest,
            )
        )
    report: dict[str, object] = {
        "schema_version": SCORE_REPORT_SCHEMA_VERSION,
        "eval_kind": _required_string(manifest.get("experiment_kind"), "experiment_kind"),
        "eval_run_id": eval_run_id,
        "profile_id": _required_string(manifest.get("experiment_kind"), "experiment_kind"),
        "surface_key": _required_string(manifest.get("surface_key"), "surface_key"),
        "variant_id": _required_string(manifest.get("variant_id"), "variant_id"),
        "environment": _required_string(manifest.get("environment"), "environment"),
        "release": _required_string(manifest.get("release"), "release"),
        "source_git_head": _required_string(manifest.get("source_git_head"), "source_git_head"),
        "source_artifact_path": _required_string(manifest.get("artifact_path"), "artifact_path"),
        "source_result_denominator": len(score_items) + len(omitted_items),
        "expected_publish_denominator": len(score_items),
        "score_items": score_items,
        "omitted_items": omitted_items,
    }
    validate_langfuse_score_report(report)
    return report


def _score_item_from_manifest_score(
    *,
    eval_run_id: str,
    case_id: str,
    score: Mapping[str, object],
    dataset_run_id: str | None,
    dataset_item_id: str | None,
    trace_id: str | None,
    observation_id: str | None,
    manifest: Mapping[str, object],
) -> dict[str, object]:
    name = _required_string(score.get("name"), "score.name")
    return {
        "idempotency_key": _stable_id("lfscore", eval_run_id, case_id, name),
        "name": name,
        "data_type": _required_string(score.get("data_type"), "score.data_type"),
        "value": score.get("value"),
        "case_id": case_id,
        "trace_id": trace_id,
        "observation_id": observation_id,
        "session_id": None,
        "dataset_run_id": dataset_run_id,
        "dataset_item_id": dataset_item_id,
        "metadata": {
            "case_id": case_id,
            "dataset_item_id": dataset_item_id,
            "eval_kind": _required_string(manifest.get("experiment_kind"), "experiment_kind"),
            "release": _required_string(manifest.get("release"), "release"),
            "schema_version": EXPERIMENT_RESULT_SCHEMA_VERSION,
            "source_git_head": _required_string(manifest.get("source_git_head"), "source_git_head"),
            "surface_key": _required_string(manifest.get("surface_key"), "surface_key"),
            "variant_id": _required_string(manifest.get("variant_id"), "variant_id"),
        },
        "comment": _optional_string(score.get("comment")),
    }


def _experiment_omitted_item(
    *,
    case_id: str,
    source_result_id: str,
    reason: str,
    manifest: Mapping[str, object],
) -> dict[str, object]:
    return {
        "case_id": case_id,
        "source_result_id": source_result_id,
        "reason": reason,
        "source_artifact_ref": _required_string(manifest.get("artifact_path"), "artifact_path"),
        "metadata": {
            "case_id": case_id,
            "eval_kind": _required_string(manifest.get("experiment_kind"), "experiment_kind"),
            "release": _required_string(manifest.get("release"), "release"),
            "schema_version": EXPERIMENT_RESULT_SCHEMA_VERSION,
            "surface_key": _required_string(manifest.get("surface_key"), "surface_key"),
            "variant_id": _required_string(manifest.get("variant_id"), "variant_id"),
        },
    }


def _experiment_artifact(
    manifest: Mapping[str, object],
    item_results: list[dict[str, object]],
    dataset_run_id: str | None,
) -> dict[str, object]:
    failed = [
        item for item in item_results if _required_string(item.get("status"), "status") != "passed"
    ]
    artifact: dict[str, object] = {
        "schema_version": EXPERIMENT_RESULT_SCHEMA_VERSION,
        "experiment_run_id": _required_string(
            manifest.get("experiment_run_id"), "experiment_run_id"
        ),
        "experiment_kind": _required_string(manifest.get("experiment_kind"), "experiment_kind"),
        "dataset_name": _required_string(manifest.get("dataset_name"), "dataset_name"),
        "dataset_version": _optional_string(manifest.get("dataset_version")),
        "dataset_run_id": dataset_run_id,
        "variant_id": _required_string(manifest.get("variant_id"), "variant_id"),
        "baseline_id": _optional_string(manifest.get("baseline_id")),
        "surface_key": _required_string(manifest.get("surface_key"), "surface_key"),
        "environment": _required_string(manifest.get("environment"), "environment"),
        "release": _required_string(manifest.get("release"), "release"),
        "source_git_head": _required_string(manifest.get("source_git_head"), "source_git_head"),
        "item_results": item_results,
        "aggregate_scores": _mapping_list(manifest.get("aggregate_scores"), "aggregate_scores"),
        "verdict": "fail" if failed else "pass",
    }
    baseline_artifact_path = _optional_string(manifest.get("baseline_artifact_path"))
    if baseline_artifact_path:
        artifact["baseline_comparison"] = _baseline_comparison(
            manifest=manifest,
            artifact=artifact,
            baseline_artifact_path=Path(baseline_artifact_path),
        )
    return artifact


def _baseline_comparison(
    *,
    manifest: Mapping[str, object],
    artifact: Mapping[str, object],
    baseline_artifact_path: Path,
) -> dict[str, object]:
    baseline = _load_json_object(baseline_artifact_path)
    _require_equal(
        baseline.get("schema_version"),
        EXPERIMENT_RESULT_SCHEMA_VERSION,
        "baseline.schema_version",
    )
    current_scores = _aggregate_score_map(_mapping_list(artifact.get("aggregate_scores"), "scores"))
    baseline_scores = _aggregate_score_map(
        _mapping_list(baseline.get("aggregate_scores"), "baseline.aggregate_scores")
    )
    deltas = []
    for name in sorted(set(current_scores) & set(baseline_scores)):
        current = current_scores[name]
        previous = baseline_scores[name]
        if _is_number(current["value"]) and _is_number(previous["value"]):
            deltas.append(
                {
                    "name": name,
                    "data_type": current["data_type"],
                    "current_value": current["value"],
                    "baseline_value": previous["value"],
                    "delta": round(float(current["value"]) - float(previous["value"]), 10),
                }
            )
    return {
        "baseline_id": _optional_string(manifest.get("baseline_id")),
        "baseline_artifact_path": str(baseline_artifact_path),
        "baseline_experiment_run_id": _optional_string(baseline.get("experiment_run_id")),
        "baseline_verdict": _optional_string(baseline.get("verdict")),
        "current_verdict": _optional_string(artifact.get("verdict")),
        "aggregate_score_deltas": deltas,
    }


def _aggregate_score_map(scores: list[dict[str, object]]) -> dict[str, dict[str, object]]:
    mapped: dict[str, dict[str, object]] = {}
    for score in scores:
        mapped[_required_string(score.get("name"), "score.name")] = {
            "data_type": _required_string(score.get("data_type"), "score.data_type"),
            "value": score.get("value"),
        }
    return mapped


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _list_paginated(
    settings: LangfuseAdapterSettings,
    path: str,
    *,
    query: Mapping[str, object] | None = None,
    client: httpx.Client | None = None,
) -> list[dict[str, object]]:
    page = 1
    items: list[dict[str, object]] = []
    while True:
        payload = _request_json(
            settings,
            "GET",
            path,
            query={**dict(query or {}), "page": page, "limit": 50},
            client=client,
        )
        items.extend(_mapping_list(payload.get("data"), "data"))
        meta = dict(payload.get("meta") or {})
        total_pages = int(meta.get("totalPages") or meta.get("total_pages") or page)
        if page >= total_pages:
            return items
        page += 1


def _request_json(
    settings: LangfuseAdapterSettings,
    method: str,
    path: str,
    *,
    query: Mapping[str, object] | None = None,
    json_body: Mapping[str, object] | None = None,
    client: httpx.Client | None = None,
) -> dict[str, object]:
    url = settings.base_url.strip().rstrip("/") + path
    request_kwargs: dict[str, object] = {
        "params": {key: value for key, value in dict(query or {}).items() if value is not None},
        "auth": (settings.public_key.strip(), settings.secret_key.strip()),
    }
    if json_body is not None:
        request_kwargs["json"] = dict(json_body)
    if client is not None:
        response = client.request(method, url, **request_kwargs)
    else:
        with httpx.Client(timeout=settings.timeout_seconds) as live_client:
            response = live_client.request(method, url, **request_kwargs)
    if response.status_code >= 400:
        raise LangfuseAdapterRequestError(
            status_code=response.status_code,
            message=response.text,
        )
    if not response.content:
        return {}
    return dict(response.json() or {})


def _score_config_payload(score: Mapping[str, object]) -> dict[str, object]:
    data_type = _required_string(score.get("data_type"), "data_type")
    payload: dict[str, object] = {
        "name": _required_string(score.get("name"), "name"),
        "dataType": data_type,
        "description": _optional_string(score.get("description")),
    }
    value_range = score.get("value_range")
    if data_type == "NUMERIC" and isinstance(value_range, list) and len(value_range) == 2:
        payload["minValue"] = value_range[0]
        payload["maxValue"] = value_range[1]
    if data_type == "CATEGORICAL":
        categories = _string_list(score.get("categories") or score.get("value_range"))
        payload["categories"] = [{"label": item, "value": item} for item in categories]
    return payload


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _write_json(path: Path, payload: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _mapping_list(value: object, field: str) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    result: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, Mapping):
            raise ValueError(f"{field} items must be objects")
        result.append(dict(item))
    return result


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _required_string(value: object, field: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _require_equal(actual: object, expected: object, field: str) -> None:
    if actual != expected:
        raise ValueError(f"{field} must be {expected}")


def _stable_id(*parts: object) -> str:
    prefix = _slug(str(parts[0]))
    digest = _sha256_text(":".join(str(part) for part in parts[1:]))[:24]
    return f"{prefix}:{digest}"


def _slug(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _resolve_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return Path.cwd() / path


__all__ = [
    "export_langfuse_review_results",
    "run_langfuse_experiment",
    "sync_langfuse_annotation_queue",
    "sync_langfuse_datasets",
    "sync_langfuse_score_configs",
]
