from __future__ import annotations

import json
import re
from collections.abc import Mapping
from numbers import Number
from pathlib import Path

import httpx

from campus_evals.langfuse_adapter import (
    LangfuseAdapterDisabled,
    LangfuseAdapterRequestError,
    LangfuseAdapterSettings,
    derive_langfuse_trace_id,
)

SCHEMA_VERSION = "langfuse_score_report.v1"
REGISTRY_SCHEMA_VERSION = "langfuse_score_registry.v1"
DEFAULT_REGISTRY_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures/ops/langfuse_score_registry.v1.json"
)
SCORE_DATA_TYPES = frozenset({"BOOLEAN", "NUMERIC", "CATEGORICAL", "TEXT"})
_METADATA_ALLOWLIST = frozenset(
    {
        "candidate_id",
        "case_family",
        "case_id",
        "collection_key",
        "dataset_item_id",
        "eval_kind",
        "failure_class",
        "grader_version",
        "metric_key",
        "profile_id",
        "query_id",
        "release",
        "request_id",
        "schema_version",
        "source_artifact_path",
        "source_git_head",
        "surface_key",
        "top_k",
        "variant_id",
    }
)
_FORBIDDEN_METADATA_KEYS = frozenset(
    {
        "api_key",
        "authorization",
        "cookie",
        "cookies",
        "database_url",
        "jwt",
        "object_store_secret",
        "provider_raw_response",
        "raw_answer",
        "raw_prompt",
        "raw_retrieved_snippet",
        "raw_transcript",
        "retrieved_snippet",
        "source_body_text",
    }
)


def load_langfuse_score_report(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"score report cannot be read: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"score report is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("score report root must be a JSON object")
    return payload


def write_langfuse_score_report(path: Path, payload: Mapping[str, object]) -> None:
    validate_langfuse_score_report(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_langfuse_score_report(
    payload: Mapping[str, object],
    *,
    registry_path: Path | None = None,
) -> dict[str, object]:
    registry = _load_score_registry(registry_path or DEFAULT_REGISTRY_PATH)
    _require_equal(payload.get("schema_version"), SCHEMA_VERSION, "schema_version")
    eval_kind = _required_string(payload.get("eval_kind"), "eval_kind")
    eval_run_id = _required_string(payload.get("eval_run_id"), "eval_run_id")
    profile_id = _required_string(payload.get("profile_id"), "profile_id")
    _required_string(payload.get("surface_key"), "surface_key")
    _required_string(payload.get("variant_id"), "variant_id")
    _required_string(payload.get("environment"), "environment")
    _required_string(payload.get("release"), "release")
    _required_string(payload.get("source_git_head"), "source_git_head")
    _required_string(payload.get("source_artifact_path"), "source_artifact_path")

    score_items = _mapping_list(payload.get("score_items"), "score_items")
    omitted_items = _mapping_list(payload.get("omitted_items"), "omitted_items")
    if not score_items and not omitted_items:
        raise ValueError("score report must include score_items or omitted_items")
    source_result_denominator = _required_int(
        payload.get("source_result_denominator"), "source_result_denominator"
    )
    expected_publish_denominator = _required_int(
        payload.get("expected_publish_denominator"), "expected_publish_denominator"
    )
    if expected_publish_denominator != len(score_items):
        raise ValueError("expected_publish_denominator must equal score_items length")
    if source_result_denominator != len(score_items) + len(omitted_items):
        raise ValueError(
            "source_result_denominator must equal score_items plus omitted_items length"
        )
    for index, item in enumerate(score_items):
        _validate_score_item(item, index=index, registry=registry)
    for index, item in enumerate(omitted_items):
        _validate_omitted_item(item, index=index)
    return {
        "schema_version": SCHEMA_VERSION,
        "eval_kind": eval_kind,
        "eval_run_id": eval_run_id,
        "profile_id": profile_id,
        "source_result_denominator": source_result_denominator,
        "expected_publish_denominator": expected_publish_denominator,
        "score_count": len(score_items),
        "omitted": len(omitted_items),
    }


def publish_langfuse_score_report(
    *,
    score_report_payload: Mapping[str, object],
    score_report_path: Path | None,
    settings: LangfuseAdapterSettings,
    dry_run: bool = False,
    validate_only: bool = False,
    client: httpx.Client | None = None,
) -> dict[str, object]:
    if not settings.enabled and not (dry_run or validate_only):
        raise LangfuseAdapterDisabled("Langfuse adapter is disabled")
    validation = validate_langfuse_score_report(score_report_payload)
    score_items = _mapping_list(score_report_payload.get("score_items"), "score_items")
    published = 0
    failed = 0
    if not validate_only:
        for item in score_items:
            if dry_run:
                published += 1
                continue
            try:
                _post_score(
                    settings=settings,
                    payload=_score_item_to_langfuse_payload(item),
                    client=client,
                )
            except LangfuseAdapterRequestError:
                failed += 1
                raise
            published += 1
    return {
        "score_report_path": str(score_report_path) if score_report_path else None,
        "eval_run_id": _required_string(score_report_payload.get("eval_run_id"), "eval_run_id"),
        "release": _required_string(score_report_payload.get("release"), "release"),
        "source_result_denominator": validation["source_result_denominator"],
        "expected_publish_denominator": validation["expected_publish_denominator"],
        "published": published,
        "failed": failed,
        "omitted": validation["omitted"],
        "dry_run": dry_run,
        "validate_only": validate_only,
    }


def build_score_report_from_profile_report(
    *,
    profile_report_payload: Mapping[str, object],
    profile_report_path: Path,
    environment: str,
) -> dict[str, object]:
    schema_version = _required_string(
        profile_report_payload.get("schema_version"), "schema_version"
    )
    profile_id = _required_string(profile_report_payload.get("profile_id"), "profile_id")
    case_family = _required_string(profile_report_payload.get("case_family"), "case_family")
    version_summary = _mapping(profile_report_payload.get("version_summary"), "version_summary")
    git_head = _required_string(version_summary.get("git_head"), "version_summary.git_head")
    runtime_version = _required_string(
        version_summary.get("runtime_version"), "version_summary.runtime_version"
    )
    raw_results_value = profile_report_payload.get("sanitized_results")
    if not isinstance(raw_results_value, list) or not raw_results_value:
        raise ValueError("sanitized_results must be a non-empty list")
    raw_results = _mapping_list(raw_results_value, "sanitized_results")
    if not raw_results:
        raise ValueError("sanitized_results must be a non-empty list")

    eval_run_id = _stable_eval_run_id(
        profile_id=profile_id,
        git_head=git_head,
        runtime_version=runtime_version,
    )
    score_items: list[dict[str, object]] = []
    omitted_items: list[dict[str, object]] = []
    for result in raw_results:
        case_id = _required_string(result.get("case_id"), "sanitized_results[].case_id")
        raw_correlation = result.get("request_correlation")
        if not isinstance(raw_correlation, Mapping):
            omitted_items.append(
                _profile_omitted_item(
                    case_id=case_id,
                    reason="missing_request_correlation",
                    profile_report_path=profile_report_path,
                    profile_id=profile_id,
                )
            )
            continue
        product_trace_id = _optional_string(raw_correlation.get("trace_id"))
        request_id = _optional_string(raw_correlation.get("request_id"))
        if not product_trace_id or not request_id:
            omitted_items.append(
                _profile_omitted_item(
                    case_id=case_id,
                    reason="missing_request_correlation_identity",
                    profile_report_path=profile_report_path,
                    profile_id=profile_id,
                )
            )
            continue
        failure_class = _optional_string(result.get("failure_class"))
        score_items.append(
            {
                "idempotency_key": _score_idempotency_key(
                    eval_run_id=eval_run_id,
                    case_id=case_id,
                    score_name=f"{profile_id}.profile",
                ),
                "name": f"{profile_id}.profile",
                "data_type": "BOOLEAN",
                "value": 1 if bool(result.get("passed")) else 0,
                "case_id": case_id,
                "trace_id": derive_langfuse_trace_id(product_trace_id),
                "observation_id": None,
                "session_id": None,
                "dataset_run_id": None,
                "dataset_item_id": None,
                "metadata": {
                    "profile_id": profile_id,
                    "case_id": case_id,
                    "request_id": request_id,
                    "case_family": case_family,
                    "schema_version": schema_version,
                    "grader_version": runtime_version,
                    "failure_class": failure_class,
                },
                "comment": "profile result passed"
                if bool(result.get("passed"))
                else "profile result failed",
            }
        )
    report: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "eval_kind": "profile",
        "eval_run_id": eval_run_id,
        "profile_id": profile_id,
        "surface_key": _profile_surface_key(profile_id),
        "variant_id": "default",
        "environment": _required_string(environment, "environment"),
        "release": runtime_version,
        "source_git_head": git_head,
        "source_artifact_path": str(profile_report_path),
        "source_result_denominator": len(raw_results),
        "expected_publish_denominator": len(score_items),
        "score_items": score_items,
        "omitted_items": omitted_items,
    }
    validate_langfuse_score_report(report)
    return report


def build_score_report_from_retrieval_tuning_report(
    *,
    tuning_report_payload: Mapping[str, object],
    tuning_report_path: Path,
    environment: str,
    release: str,
    source_git_head: str,
    dataset_run_id: str,
    variant_id: str | None = None,
) -> dict[str, object]:
    _require_equal(
        tuning_report_payload.get("schema_version"),
        "retrieval-tuning-report-v1",
        "retrieval_tuning_report.schema_version",
    )
    scope = _mapping(tuning_report_payload.get("scope"), "retrieval_tuning_report.scope")
    corpus = _required_string(scope.get("corpus"), "retrieval_tuning_report.scope.corpus")
    collection = _required_string(
        scope.get("collection"), "retrieval_tuning_report.scope.collection"
    )
    collection_key = f"{corpus}/{collection}"
    candidates = _mapping_list(
        tuning_report_payload.get("candidates"), "retrieval_tuning_report.candidates"
    )
    if not candidates:
        raise ValueError("retrieval tuning report candidates must be non-empty")
    normalized_dataset_run_id = _required_string(dataset_run_id, "dataset_run_id")
    normalized_release = _required_string(release, "release")
    normalized_git_head = _required_string(source_git_head, "source_git_head")
    normalized_environment = _required_string(environment, "environment")
    resolved_variant_id = (
        _optional_string(variant_id)
        or _optional_string(tuning_report_payload.get("recommended_candidate_id"))
        or "sweep"
    )
    eval_run_id = _slug(
        f"rag-first-stage:{collection_key}:{normalized_release}:{normalized_dataset_run_id}"
    )
    score_items: list[dict[str, object]] = []
    for candidate in candidates:
        candidate_id = _required_string(
            candidate.get("candidate_id"), "retrieval_tuning_report.candidates[].candidate_id"
        )
        profile = _mapping(candidate.get("profile"), "retrieval_tuning_report.candidates[].profile")
        metrics = _mapping(candidate.get("metrics"), "retrieval_tuning_report.candidates[].metrics")
        top_k = profile.get("retrieval_top_k") or 5
        for metric_key, score_name in (
            ("doc_hit_at_1", "retrieval.doc_hit_at_1"),
            ("doc_hit_at_3", "retrieval.doc_hit_at_3"),
            ("doc_recall_at_5", "retrieval.doc_recall_at_k"),
            ("forbidden_hit_rate", "retrieval.forbidden_hit_rate"),
        ):
            metric_value = _required_number(
                metrics.get(metric_key),
                f"retrieval_tuning_report.candidates[].metrics.{metric_key}",
            )
            case_id = _slug(f"{collection_key}:{candidate_id}:{metric_key}")
            dataset_item_id = _slug(f"campus:{collection_key}:{candidate_id}:{metric_key}")
            score_items.append(
                {
                    "idempotency_key": _score_idempotency_key(
                        eval_run_id=eval_run_id,
                        case_id=case_id,
                        score_name=score_name,
                    ),
                    "name": score_name,
                    "data_type": "NUMERIC",
                    "value": metric_value,
                    "case_id": case_id,
                    "trace_id": None,
                    "observation_id": None,
                    "session_id": None,
                    "dataset_run_id": normalized_dataset_run_id,
                    "dataset_item_id": dataset_item_id,
                    "metadata": {
                        "candidate_id": candidate_id,
                        "collection_key": collection_key,
                        "dataset_item_id": dataset_item_id,
                        "eval_kind": "rag_first_stage_parameter_sweep",
                        "metric_key": metric_key,
                        "release": normalized_release,
                        "schema_version": "retrieval-tuning-report-v1",
                        "source_artifact_path": str(tuning_report_path),
                        "source_git_head": normalized_git_head,
                        "surface_key": collection_key,
                        "top_k": top_k,
                        "variant_id": resolved_variant_id,
                    },
                    "comment": f"{candidate_id} {metric_key}",
                }
            )
    report: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "eval_kind": "rag_first_stage_parameter_sweep",
        "eval_run_id": eval_run_id,
        "profile_id": "rag-first-stage-parameter-sweep",
        "surface_key": collection_key,
        "variant_id": resolved_variant_id,
        "environment": normalized_environment,
        "release": normalized_release,
        "source_git_head": normalized_git_head,
        "source_artifact_path": str(tuning_report_path),
        "source_result_denominator": len(score_items),
        "expected_publish_denominator": len(score_items),
        "score_items": score_items,
        "omitted_items": [],
    }
    validate_langfuse_score_report(report)
    return report


def _load_score_registry(path: Path) -> dict[str, Mapping[str, object]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"Langfuse score registry cannot be read: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Langfuse score registry is not valid JSON: {exc}") from exc
    if not isinstance(payload, Mapping):
        raise ValueError("Langfuse score registry root must be a JSON object")
    _require_equal(
        payload.get("schema_version"), REGISTRY_SCHEMA_VERSION, "registry.schema_version"
    )
    scores = _mapping_list(payload.get("scores"), "registry.scores")
    registry: dict[str, Mapping[str, object]] = {}
    for score in scores:
        name = _required_string(score.get("name"), "registry.scores[].name")
        data_type = _required_string(score.get("data_type"), "registry.scores[].data_type")
        if data_type not in SCORE_DATA_TYPES:
            raise ValueError(f"registry score {name} has unsupported data_type {data_type}")
        registry[name] = score
    return registry


def _validate_score_item(
    item: Mapping[str, object],
    *,
    index: int,
    registry: Mapping[str, Mapping[str, object]],
) -> None:
    prefix = f"score_items[{index}]"
    idempotency_key = _required_string(item.get("idempotency_key"), f"{prefix}.idempotency_key")
    if len(idempotency_key) > 255:
        raise ValueError(f"{prefix}.idempotency_key must be at most 255 characters")
    name = _required_string(item.get("name"), f"{prefix}.name")
    registered = registry.get(name)
    if registered is None:
        raise ValueError(f"unknown Langfuse score name: {name}")
    data_type = _required_string(item.get("data_type"), f"{prefix}.data_type")
    if data_type != _required_string(registered.get("data_type"), f"registry.{name}.data_type"):
        raise ValueError(f"{prefix}.data_type does not match registry for {name}")
    _required_string(item.get("case_id"), f"{prefix}.case_id")
    _validate_target_identity(item, prefix)
    _validate_score_value(
        item.get("value"), data_type=data_type, prefix=prefix, registry=registered
    )
    metadata = _mapping(item.get("metadata"), f"{prefix}.metadata")
    _validate_metadata(metadata, prefix=f"{prefix}.metadata")
    comment = item.get("comment")
    if comment is not None and not isinstance(comment, str):
        raise ValueError(f"{prefix}.comment must be a string or null")


def _validate_omitted_item(item: Mapping[str, object], *, index: int) -> None:
    prefix = f"omitted_items[{index}]"
    _required_string(item.get("case_id"), f"{prefix}.case_id")
    _required_string(item.get("source_result_id"), f"{prefix}.source_result_id")
    _required_string(item.get("reason"), f"{prefix}.reason")
    _required_string(item.get("source_artifact_ref"), f"{prefix}.source_artifact_ref")
    _validate_metadata(
        _mapping(item.get("metadata"), f"{prefix}.metadata"), prefix=f"{prefix}.metadata"
    )


def _validate_target_identity(item: Mapping[str, object], prefix: str) -> None:
    trace_id = _optional_string(item.get("trace_id"))
    observation_id = _optional_string(item.get("observation_id"))
    session_id = _optional_string(item.get("session_id"))
    dataset_run_id = _optional_string(item.get("dataset_run_id"))
    if observation_id and not trace_id:
        raise ValueError(f"{prefix}.observation_id requires trace_id")
    if session_id and (trace_id or observation_id or dataset_run_id):
        raise ValueError(f"{prefix}.session_id scores cannot carry trace or dataset identity")
    if not (trace_id or session_id or dataset_run_id):
        raise ValueError(f"{prefix} must carry trace_id, session_id, or dataset_run_id")


def _validate_score_value(
    value: object,
    *,
    data_type: str,
    prefix: str,
    registry: Mapping[str, object],
) -> None:
    if data_type == "BOOLEAN":
        if isinstance(value, bool) or value not in (0, 1):
            raise ValueError(f"{prefix}.BOOLEAN score value must be 0 or 1")
        return
    if data_type == "NUMERIC":
        if isinstance(value, bool) or not isinstance(value, Number):
            raise ValueError(f"{prefix}.NUMERIC score value must be a number")
        return
    if data_type == "CATEGORICAL":
        categories = tuple(str(item) for item in (registry.get("categories") or ()))
        if not isinstance(value, str) or value not in set(categories):
            raise ValueError(f"{prefix}.CATEGORICAL score value must be a registered category")
        return
    if data_type == "TEXT":
        if not isinstance(value, str) or not value.strip() or len(value) > 500:
            raise ValueError(f"{prefix}.TEXT score value must be 1-500 characters")
        if bool(registry.get("release_gate")):
            raise ValueError(f"{prefix}.TEXT score cannot be a release gate score")
        return
    raise ValueError(f"{prefix}.data_type is unsupported")


def _validate_metadata(metadata: Mapping[str, object], *, prefix: str) -> None:
    for key, value in metadata.items():
        normalized = str(key).strip()
        lower = normalized.lower()
        if lower in _FORBIDDEN_METADATA_KEYS:
            raise ValueError(f"{prefix}.{normalized} is forbidden Langfuse metadata")
        if normalized not in _METADATA_ALLOWLIST:
            raise ValueError(f"{prefix}.{normalized} is not in the Langfuse metadata allowlist")
        if isinstance(value, (dict, list)):
            raise ValueError(f"{prefix}.{normalized} must be scalar or null")


def _score_item_to_langfuse_payload(item: Mapping[str, object]) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": _required_string(item.get("idempotency_key"), "score_items[].idempotency_key"),
        "name": _required_string(item.get("name"), "score_items[].name"),
        "value": item.get("value"),
        "dataType": _required_string(item.get("data_type"), "score_items[].data_type"),
        "source": "API",
        "metadata": dict(_mapping(item.get("metadata"), "score_items[].metadata")),
    }
    for source_key, langfuse_key in (
        ("trace_id", "traceId"),
        ("observation_id", "observationId"),
        ("session_id", "sessionId"),
        ("dataset_run_id", "datasetRunId"),
    ):
        value = _optional_string(item.get(source_key))
        if value:
            payload[langfuse_key] = value
    dataset_item_id = _optional_string(item.get("dataset_item_id"))
    if dataset_item_id:
        payload["metadata"]["dataset_item_id"] = dataset_item_id
    comment = item.get("comment")
    if comment is not None:
        payload["comment"] = str(comment)
    return payload


def _post_score(
    *,
    settings: LangfuseAdapterSettings,
    payload: dict[str, object],
    client: httpx.Client | None,
) -> None:
    score_url = f"{settings.base_url.strip().rstrip('/')}/api/public/scores"
    if client is not None:
        response = client.post(
            score_url,
            json=payload,
            auth=(settings.public_key.strip(), settings.secret_key.strip()),
        )
    else:
        with httpx.Client(timeout=settings.timeout_seconds) as live_client:
            response = live_client.post(
                score_url,
                json=payload,
                auth=(settings.public_key.strip(), settings.secret_key.strip()),
            )
    if response.status_code < 400:
        return
    raise LangfuseAdapterRequestError(
        status_code=response.status_code,
        message=_extract_error_message(response),
    )


def _profile_omitted_item(
    *,
    case_id: str,
    reason: str,
    profile_report_path: Path,
    profile_id: str,
) -> dict[str, object]:
    return {
        "case_id": case_id,
        "source_result_id": case_id,
        "reason": reason,
        "source_artifact_ref": str(profile_report_path),
        "metadata": {"profile_id": profile_id, "case_id": case_id},
    }


def _stable_eval_run_id(*, profile_id: str, git_head: str, runtime_version: str) -> str:
    return _slug(f"{profile_id}:{git_head}:{runtime_version}")


def _score_idempotency_key(*, eval_run_id: str, case_id: str, score_name: str) -> str:
    return _slug(f"lfscore:{eval_run_id}:{case_id}:{score_name}")


def _profile_surface_key(profile_id: str) -> str:
    if profile_id == "online-answer-path":
        return "app-api.chat"
    return profile_id


def _slug(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.:-]+", "-", value.strip())[:255]


def _extract_error_message(response: httpx.Response) -> str:
    try:
        payload = dict(response.json() or {})
    except ValueError:
        return response.text.strip() or "request failed"
    return str(payload.get("message") or payload.get("error") or response.text or "request failed")


def _mapping(value: object, field: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field} must be a JSON object")
    return value


def _mapping_list(value: object, field: str) -> list[Mapping[str, object]]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    items: list[Mapping[str, object]] = []
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            raise ValueError(f"{field}[{index}] must be a JSON object")
        items.append(item)
    return items


def _required_string(value: object, field: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _required_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    if value < 0:
        raise ValueError(f"{field} must be non-negative")
    return value


def _required_number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Number):
        raise ValueError(f"{field} must be a number")
    return float(value)


def _require_equal(actual: object, expected: str, field: str) -> None:
    if str(actual or "").strip() != expected:
        raise ValueError(f"{field} must be {expected}")


__all__ = [
    "SCHEMA_VERSION",
    "build_score_report_from_profile_report",
    "build_score_report_from_retrieval_tuning_report",
    "load_langfuse_score_report",
    "publish_langfuse_score_report",
    "validate_langfuse_score_report",
    "write_langfuse_score_report",
]
