from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

os.environ.setdefault("RAGAS_DO_NOT_TRACK", "true")

SAMPLE_BATCH_SCHEMA_VERSION = "ragas_sample_batch.v1"
SCORE_BATCH_SCHEMA_VERSION = "ragas_score_batch.v1"
DEFAULT_RAGAS_METRIC_NAMES = (
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
)
OFFICIAL_RAGAS_METRIC_NAMES = (
    *DEFAULT_RAGAS_METRIC_NAMES,
    "context_precision_without_reference",
    "id_context_precision",
    "id_context_recall",
)

FORBIDDEN_SAMPLE_FIELD_NAMES = frozenset(
    {
        "api_key",
        "authorization",
        "bucket",
        "cookie",
        "database_url",
        "file",
        "file_path",
        "file_paths",
        "file_url",
        "file_urls",
        "files",
        "image",
        "image_path",
        "image_paths",
        "image_url",
        "image_urls",
        "images",
        "jwt",
        "local_artifact_path",
        "media",
        "media_path",
        "media_paths",
        "media_url",
        "media_urls",
        "object_key",
        "object_store_secret",
        "path",
        "paths",
        "provider_raw_response",
        "raw_answer",
        "raw_chat_transcript",
        "raw_prompt",
        "raw_provider_response",
        "raw_retrieved_snippet",
        "raw_trace",
        "raw_transcript",
        "source_url",
        "source_body",
        "transcript",
        "uri",
        "uris",
        "url",
        "urls",
    }
)
FORBIDDEN_RESOURCE_VALUE_PREFIXES = (
    "file://",
    "ftp://",
    "gs://",
    "http://",
    "https://",
    "s3://",
)
FORBIDDEN_LOCAL_PATH_PREFIXES = ("/", "./", "../", "~/")


@dataclass(frozen=True, slots=True)
class RagasProjection:
    case_id: str
    user_input: str
    response: str
    retrieved_contexts: tuple[str, ...]
    reference: str
    retrieved_context_ids: tuple[str, ...] = field(default_factory=tuple)
    reference_context_ids: tuple[str, ...] = field(default_factory=tuple)
    reference_contexts: tuple[str, ...] = field(default_factory=tuple)
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RagasResult:
    metric_name: str
    score: float | None = None
    rationale: str = ""
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RagasRunnerSettings:
    llm_api_key: str
    llm_model: str
    llm_base_url: str | None
    embedding_api_key: str
    embedding_model: str
    embedding_base_url: str | None
    embedding_dimensions: int | None
    timeout_seconds: int
    max_workers: int
    metric_names: tuple[str, ...] = DEFAULT_RAGAS_METRIC_NAMES

    @classmethod
    def from_sources(
        cls,
        *,
        env: Mapping[str, str] | None = None,
        runtime_config_path: Path | None = None,
    ) -> RagasRunnerSettings:
        source = env if env is not None else os.environ
        config = _load_runtime_config(runtime_config_path)
        llm_api_key = _required_setting(
            "llm_api_key",
            config=config,
            env=source,
            names=("RAGAS_LLM_API_KEY", "EVAL_RAGAS_LLM_API_KEY", "LLM_API_KEY"),
        )
        llm_model = _required_setting(
            "llm_model",
            config=config,
            env=source,
            names=("RAGAS_LLM_MODEL", "EVAL_RAGAS_MODEL", "LLM_MODEL"),
        )
        embedding_api_key = _required_setting(
            "embedding_api_key",
            config=config,
            env=source,
            names=(
                "RAGAS_EMBEDDING_API_KEY",
                "EVAL_RAGAS_EMBEDDING_API_KEY",
                "EMBEDDING_API_KEY",
            ),
        )
        embedding_model = _required_setting(
            "embedding_model",
            config=config,
            env=source,
            names=("RAGAS_EMBEDDING_MODEL", "EMBEDDING_MODEL"),
        )
        return cls(
            llm_api_key=llm_api_key,
            llm_model=llm_model,
            llm_base_url=_optional_setting(
                "llm_base_url",
                config=config,
                env=source,
                names=("RAGAS_LLM_BASE_URL", "EVAL_RAGAS_LLM_BASE_URL", "LLM_BASE_URL"),
            ),
            embedding_api_key=embedding_api_key,
            embedding_model=embedding_model,
            embedding_base_url=_optional_setting(
                "embedding_base_url",
                config=config,
                env=source,
                names=(
                    "RAGAS_EMBEDDING_BASE_URL",
                    "EVAL_RAGAS_EMBEDDING_BASE_URL",
                    "EMBEDDING_BASE_URL",
                ),
            ),
            embedding_dimensions=_optional_int_setting(
                "embedding_dimensions",
                config=config,
                env=source,
                names=("RAGAS_EMBEDDING_DIMENSIONS", "EMBEDDING_DIMENSIONS"),
            ),
            timeout_seconds=_positive_int_setting(
                "timeout_seconds",
                config=config,
                env=source,
                names=("RAGAS_TIMEOUT_SECONDS",),
                default=180,
            ),
            max_workers=_positive_int_setting(
                "max_workers",
                config=config,
                env=source,
                names=("RAGAS_MAX_WORKERS",),
                default=4,
            ),
            metric_names=_metric_names_setting(config),
        )


RagasScorer = Callable[[RagasProjection], tuple[RagasResult, ...]]
RagasScorerFactory = Callable[[], RagasScorer]


def run_ragas_score_batch(
    *,
    input_path: Path,
    output_path: Path,
    runtime_config_path: Path | None = None,
    scorer_factory: RagasScorerFactory | None = None,
) -> dict[str, object]:
    payload = _load_json_object(input_path)
    if payload.get("schema_version") != SAMPLE_BATCH_SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {SAMPLE_BATCH_SCHEMA_VERSION}")
    eval_run_id = _required_str(payload.get("eval_run_id"), "eval_run_id")
    items = _required_list(payload.get("items"), "items")
    scorer = (
        scorer_factory()
        if scorer_factory is not None
        else build_ragas_scorer(
            RagasRunnerSettings.from_sources(runtime_config_path=runtime_config_path)
        )
    )
    scored_items = [_score_item(item, scorer=scorer) for item in items]
    output = {
        "schema_version": SCORE_BATCH_SCHEMA_VERSION,
        "eval_run_id": eval_run_id,
        "items": scored_items,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return {"items": len(scored_items), "output_path": str(output_path)}


def build_ragas_scorer(settings: RagasRunnerSettings) -> RagasScorer:
    if settings.embedding_dimensions is not None:
        raise ValueError(
            "embedding_dimensions is not supported by the current RAGAS OpenAI embedding provider"
        )

    from openai import OpenAI
    from ragas import evaluate
    from ragas.embeddings.base import embedding_factory
    from ragas.llms import llm_factory
    from ragas.run_config import RunConfig

    llm_client = OpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        max_retries=0,
        timeout=settings.timeout_seconds,
    )
    embedding_client = OpenAI(
        api_key=settings.embedding_api_key,
        base_url=settings.embedding_base_url,
        max_retries=0,
        timeout=settings.timeout_seconds,
    )
    llm = llm_factory(
        settings.llm_model,
        client=llm_client,
        temperature=0,
    )
    embeddings = embedding_factory(
        provider="openai",
        model=settings.embedding_model,
        client=embedding_client,
        interface="modern",
    )
    run_config = RunConfig(
        timeout=settings.timeout_seconds,
        max_retries=0,
        max_workers=settings.max_workers,
    )

    def _score(projection: RagasProjection) -> tuple[RagasResult, ...]:
        results: list[RagasResult] = []
        metric_applicability = dict(projection.metadata.get("metric_applicability") or {})
        for requested_name, metric in _build_metrics(
            metric_names=settings.metric_names,
            llm=llm,
            embeddings=embeddings,
            projection=projection,
        ):
            if metric_applicability.get(requested_name) is False:
                continue
            dataset = _build_ragas_dataset(projection)
            score_row = evaluate(
                dataset=dataset,
                metrics=[metric],
                llm=llm,
                embeddings=embeddings,
                run_config=run_config,
                raise_exceptions=True,
                show_progress=False,
            ).scores[0]
            value = _extract_score_value(score_row, metric)
            results.append(RagasResult(metric_name=requested_name, score=value))
        return tuple(results)

    return _score


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--runtime-config")
    args = parser.parse_args(argv)
    summary = run_ragas_score_batch(
        input_path=Path(args.input),
        output_path=Path(args.output),
        runtime_config_path=Path(args.runtime_config) if args.runtime_config else None,
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def _score_item(item: object, *, scorer: RagasScorer) -> dict[str, object]:
    if not isinstance(item, dict):
        raise ValueError("items entries must be objects")
    case_id = _required_str(item.get("case_id"), "items[].case_id")
    _assert_no_forbidden_fields(item, case_id)
    trace_id = _required_str(item.get("trace_id"), f"{case_id}.trace_id")
    observation_id = _optional_str(item.get("observation_id"))
    dataset_item_id = _optional_str(item.get("dataset_item_id"))
    dataset_run_id = _optional_str(item.get("dataset_run_id"))
    metadata = _optional_mapping(item.get("metadata"))
    reference = _optional_str(item.get("reference")) or ""
    reference_contexts = tuple(
        _optional_string_list(item.get("reference_contexts"), f"{case_id}.reference_contexts")
    )
    reference_context_ids = tuple(
        _optional_string_list(item.get("reference_context_ids"), f"{case_id}.reference_context_ids")
    )
    metric_applicability = _metric_applicability(
        reference=reference,
        reference_contexts=reference_contexts,
        reference_context_ids=reference_context_ids,
    )
    projection = RagasProjection(
        case_id=case_id,
        user_input=_required_str(item.get("question"), f"{case_id}.question"),
        response=_required_str(item.get("answer"), f"{case_id}.answer"),
        retrieved_contexts=tuple(
            _required_string_list(item.get("contexts"), f"{case_id}.contexts")
        ),
        reference=reference,
        reference_contexts=reference_contexts,
        retrieved_context_ids=tuple(
            _optional_string_list(
                item.get("retrieved_context_ids", item.get("context_ids")),
                f"{case_id}.retrieved_context_ids",
            )
        ),
        reference_context_ids=reference_context_ids,
        metadata={
            **metadata,
            "trace_id": trace_id,
            "observation_id": observation_id,
            "metric_applicability": metric_applicability,
        },
    )
    scores: dict[str, float] = {}
    errors: list[dict[str, object]] = _preflight_errors(metric_applicability)
    for result in scorer(projection):
        metric_name = _qualify_metric_name(result.metric_name)
        if result.score is None:
            errors.append(
                {
                    "metric_name": metric_name,
                    "reason": result.rationale or "ragas score missing",
                }
            )
            continue
        scores[metric_name] = float(result.score)
    return {
        "case_id": case_id,
        "dataset_item_id": dataset_item_id,
        "dataset_run_id": dataset_run_id,
        "trace_id": trace_id,
        "observation_id": observation_id,
        "scores": scores,
        "errors": errors,
        "metadata": metadata,
    }


def _build_ragas_dataset(projection: RagasProjection):
    from ragas import EvaluationDataset, SingleTurnSample

    return EvaluationDataset(
        samples=[
            SingleTurnSample(
                user_input=projection.user_input,
                retrieved_contexts=list(projection.retrieved_contexts),
                reference_contexts=list(projection.reference_contexts),
                retrieved_context_ids=list(projection.retrieved_context_ids),
                reference_context_ids=list(projection.reference_context_ids),
                response=projection.response,
                reference=projection.reference,
            )
        ],
        name=projection.case_id,
    )


def _build_metrics(
    *,
    metric_names: tuple[str, ...],
    llm: object,
    embeddings: object,
    projection: RagasProjection,
) -> tuple[tuple[str, object], ...]:
    from ragas.metrics.collections import (
        AnswerRelevancy,
        ContextPrecision,
        ContextPrecisionWithoutReference,
        ContextRecall,
        Faithfulness,
    )

    use_id_metrics = bool(projection.retrieved_context_ids and projection.reference_context_ids)
    use_reference_metrics = bool(projection.reference or projection.reference_contexts)
    id_context_precision, id_context_recall = _load_public_id_metric_builders()
    builders: dict[str, Callable[[], object]] = {
        "faithfulness": lambda: Faithfulness(llm=llm),
        "answer_relevancy": lambda: AnswerRelevancy(llm=llm, embeddings=embeddings, strictness=1),
        "context_precision": (
            id_context_precision
            if use_id_metrics and id_context_precision is not None
            else (
                lambda: (
                    ContextPrecision(llm=llm)
                    if use_reference_metrics
                    else ContextPrecisionWithoutReference(llm=llm)
                )
            )
        ),
        "context_recall": (
            id_context_recall
            if use_id_metrics and id_context_recall is not None
            else lambda: ContextRecall(llm=llm)
        ),
        **(
            {"id_context_precision": id_context_precision}
            if id_context_precision is not None
            else {}
        ),
        **({"id_context_recall": id_context_recall} if id_context_recall is not None else {}),
        "context_precision_without_reference": lambda: ContextPrecisionWithoutReference(llm=llm),
    }
    entries: list[tuple[str, object]] = []
    for metric_name in metric_names:
        builder = builders.get(metric_name)
        if builder is not None:
            entries.append((metric_name, builder()))
    return tuple(entries)


def _load_public_id_metric_builders() -> tuple[
    Callable[[], object] | None, Callable[[], object] | None
]:
    import ragas.metrics.collections as collections

    precision = getattr(collections, "IDBasedContextPrecision", None)
    recall = getattr(collections, "IDBasedContextRecall", None)
    return (
        (lambda: precision()) if callable(precision) else None,
        (lambda: recall()) if callable(recall) else None,
    )


def _extract_score_value(score_row: Mapping[str, object], metric: object) -> float:
    candidate_keys = (
        str(getattr(metric, "name", "")).strip(),
        str(type(metric).__name__),
    )
    for key in candidate_keys:
        raw_value = score_row.get(key)
        if isinstance(raw_value, int | float):
            return float(raw_value)
    numeric_items = [float(value) for value in score_row.values() if isinstance(value, int | float)]
    if len(numeric_items) == 1:
        return numeric_items[0]
    raise ValueError(f"ragas score row did not include a single numeric value: {score_row}")


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _load_runtime_config(path: Path | None) -> dict[str, object]:
    if path is None:
        return {}
    payload = _load_json_object(path)
    if "schema_version" in payload and payload.get("schema_version") != "ragas_runner_config.v1":
        raise ValueError("runtime config schema_version must be ragas_runner_config.v1")
    return payload


def _required_str(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    return value.strip()


def _optional_str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _required_list(value: object, field: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    return value


def _required_string_list(value: object, field: str) -> list[str]:
    items = _optional_string_list(value, field)
    if not items:
        raise ValueError(f"{field} must include at least one string")
    return items


def _optional_string_list(value: object, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    return [_required_str(item, f"{field}[]") for item in value]


def _optional_mapping(value: object) -> dict[str, object]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("metadata must be an object")
    return {str(key): _scalar_or_none(raw_value) for key, raw_value in value.items()}


def _metric_applicability(
    *,
    reference: str,
    reference_contexts: tuple[str, ...],
    reference_context_ids: tuple[str, ...],
) -> dict[str, bool]:
    if reference or reference_contexts or reference_context_ids:
        return {}
    return {"context_recall": False}


def _preflight_errors(metric_applicability: dict[str, bool]) -> list[dict[str, object]]:
    if metric_applicability.get("context_recall") is False:
        return [
            {
                "metric_name": "ragas.context_recall",
                "reason": "missing reference for context_recall",
            }
        ]
    return []


def _scalar_or_none(value: object) -> object:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    raise ValueError("metadata values must be scalar or null")


def _qualify_metric_name(metric_name: str) -> str:
    normalized = metric_name.strip()
    if not normalized:
        raise ValueError("metric_name must not be empty")
    return normalized if normalized.startswith("ragas.") else f"ragas.{normalized}"


def _assert_no_forbidden_fields(value: object, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_string = str(key)
            child_path = f"{path}.{key_string}"
            if key_string in FORBIDDEN_SAMPLE_FIELD_NAMES:
                raise ValueError(f"{child_path} is forbidden")
            _assert_no_forbidden_fields(child, child_path)
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            _assert_no_forbidden_fields(child, f"{path}[{index}]")
        return
    if isinstance(value, str) and _is_forbidden_resource_reference(value):
        raise ValueError(f"{path} must not be a URL or file reference")


def _is_forbidden_resource_reference(value: str) -> bool:
    normalized = value.strip().lower()
    if not normalized:
        return False
    if normalized.startswith(FORBIDDEN_RESOURCE_VALUE_PREFIXES):
        return True
    if normalized.startswith(FORBIDDEN_LOCAL_PATH_PREFIXES):
        return True
    return len(normalized) >= 3 and normalized[1:3] in (":\\", ":/")


def _required_setting(
    key: str,
    *,
    config: Mapping[str, object],
    env: Mapping[str, str],
    names: tuple[str, ...],
) -> str:
    value = _optional_setting(key, config=config, env=env, names=names)
    if value is None:
        raise ValueError(f"{key} is required")
    return value


def _optional_setting(
    key: str,
    *,
    config: Mapping[str, object],
    env: Mapping[str, str],
    names: tuple[str, ...],
) -> str | None:
    raw_config_value = config.get(key)
    if isinstance(raw_config_value, str) and raw_config_value.strip():
        return raw_config_value.strip()
    for name in names:
        raw_env_value = env.get(name)
        if raw_env_value is not None and raw_env_value.strip():
            return raw_env_value.strip()
    return None


def _optional_int_setting(
    key: str,
    *,
    config: Mapping[str, object],
    env: Mapping[str, str],
    names: tuple[str, ...],
) -> int | None:
    raw_value = _optional_setting(key, config=config, env=env, names=names)
    if raw_value is None and isinstance(config.get(key), int):
        return int(config[key])
    if raw_value is None:
        return None
    value = int(raw_value)
    if value <= 0:
        raise ValueError(f"{key} must be greater than zero")
    return value


def _positive_int_setting(
    key: str,
    *,
    config: Mapping[str, object],
    env: Mapping[str, str],
    names: tuple[str, ...],
    default: int,
) -> int:
    value = _optional_int_setting(key, config=config, env=env, names=names)
    return value if value is not None else default


def _metric_names_setting(config: Mapping[str, object]) -> tuple[str, ...]:
    raw_metric_names = config.get("metric_names")
    if raw_metric_names is None:
        return DEFAULT_RAGAS_METRIC_NAMES
    if not isinstance(raw_metric_names, list):
        raise ValueError("metric_names must be a list")
    metric_names = tuple(
        _required_str(metric_name, "metric_names[]") for metric_name in raw_metric_names
    )
    unsupported = sorted(set(metric_names) - set(OFFICIAL_RAGAS_METRIC_NAMES))
    if unsupported:
        raise ValueError(f"unsupported metric_names: {', '.join(unsupported)}")
    return metric_names
