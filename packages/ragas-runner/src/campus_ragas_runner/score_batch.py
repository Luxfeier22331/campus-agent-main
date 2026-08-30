from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

os.environ.setdefault("RAGAS_DO_NOT_TRACK", "true")

from campus_ragas_runner.provider_config import load_provider_profiles

SAMPLE_BATCH_SCHEMA_VERSION = "ragas_sample_batch.v3"
SCORE_BATCH_SCHEMA_VERSION = "ragas_score_batch.v3"
RAGAS_METRIC_NAMES = (
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
)


@dataclass(frozen=True, slots=True)
class RagasProjection:
    case_id: str
    user_input: str
    response: str
    retrieved_contexts: tuple[str, ...]
    cited_contexts: tuple[str, ...]
    reference: str = ""
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RagasResult:
    metric_name: str
    score: float | None = None
    rationale: str = ""


@dataclass(frozen=True, slots=True)
class RagasRunnerSettings:
    llm_api_key: str
    llm_model: str
    llm_base_url: str | None
    embedding_api_key: str
    embedding_model: str
    embedding_base_url: str | None
    timeout_seconds: int

    @classmethod
    def from_sources(
        cls,
        *,
        provider_config_path: Path,
    ) -> RagasRunnerSettings:
        profiles = load_provider_profiles(
            provider_config_path,
            required_roles=("eval_ragas_llm", "eval_ragas_embedding"),
        )
        llm = profiles["eval_ragas_llm"]
        embedding = profiles["eval_ragas_embedding"]
        return cls(
            llm_api_key=llm.api_key,
            llm_model=llm.model,
            llm_base_url=llm.base_url,
            embedding_api_key=embedding.api_key,
            embedding_model=embedding.model,
            embedding_base_url=embedding.base_url,
            timeout_seconds=max(llm.timeout_seconds, embedding.timeout_seconds),
        )


RagasScorer = Callable[[RagasProjection], tuple[RagasResult, ...]]
RagasScorerFactory = Callable[[], RagasScorer]


def run_ragas_score_batch(
    *,
    input_path: Path,
    output_path: Path | None = None,
    provider_config_path: Path | None = None,
    scorer_factory: RagasScorerFactory | None = None,
) -> dict[str, object]:
    payload = _load_json_object(input_path)
    if payload.get("schema_version") != SAMPLE_BATCH_SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {SAMPLE_BATCH_SCHEMA_VERSION}")
    unknown_batch_fields = sorted(set(payload) - {"items", "schema_version"})
    if unknown_batch_fields:
        raise ValueError(f"batch contains unsupported fields: {', '.join(unknown_batch_fields)}")
    items = _required_list(payload.get("items"), "items")
    seen_case_ids: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("items entries must be objects")
        case_id = _required_str(item.get("case_id"), "items[].case_id")
        if case_id in seen_case_ids:
            raise ValueError(f"case_id is duplicated: {case_id}")
        seen_case_ids.add(case_id)
    scorer = (
        scorer_factory()
        if scorer_factory is not None
        else build_ragas_scorer(
            RagasRunnerSettings.from_sources(
                provider_config_path=_required_path(provider_config_path, "provider_config")
            )
        )
    )
    output = {
        "schema_version": SCORE_BATCH_SCHEMA_VERSION,
        "items": [_score_item(item, scorer=scorer) for item in items],
    }
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )
    return output


def build_ragas_scorer(settings: RagasRunnerSettings) -> RagasScorer:
    from openai import AsyncOpenAI, OpenAI
    from ragas.embeddings.base import embedding_factory

    from campus_ragas_runner.responses_llm import RAGAS_USER_AGENT, ResponsesRagasLLM

    def _score(projection: RagasProjection) -> tuple[RagasResult, ...]:
        async def _score_in_one_event_loop() -> tuple[RagasResult, ...]:
            with OpenAI(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
                default_headers={"User-Agent": RAGAS_USER_AGENT},
                max_retries=0,
                timeout=settings.timeout_seconds,
            ) as llm_sync_client:
                async with (
                    AsyncOpenAI(
                        api_key=settings.llm_api_key,
                        base_url=settings.llm_base_url,
                        default_headers={"User-Agent": RAGAS_USER_AGENT},
                        max_retries=0,
                        timeout=settings.timeout_seconds,
                    ) as llm_client,
                    AsyncOpenAI(
                        api_key=settings.embedding_api_key,
                        base_url=settings.embedding_base_url,
                        default_headers={"User-Agent": RAGAS_USER_AGENT},
                        max_retries=0,
                        timeout=settings.timeout_seconds,
                    ) as embedding_client,
                ):
                    llm = ResponsesRagasLLM(
                        client=llm_sync_client,
                        async_client=llm_client,
                        model=settings.llm_model,
                    )
                    embeddings = embedding_factory(
                        provider="openai",
                        model=settings.embedding_model,
                        client=embedding_client,
                        interface="modern",
                    )
                    return await _score_with_official_ragas_metrics(
                        projection,
                        metric_names=RAGAS_METRIC_NAMES,
                        llm=llm,
                        embeddings=embeddings,
                    )

        return tuple(asyncio.run(_score_in_one_event_loop()))

    return _score


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="-")
    parser.add_argument("--provider-config", required=True)
    args = parser.parse_args(argv)
    output_path = None if args.output == "-" else Path(args.output)
    output = run_ragas_score_batch(
        input_path=Path(args.input),
        output_path=output_path,
        provider_config_path=Path(args.provider_config),
    )
    if output_path is None:
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(
            json.dumps(
                {"items": len(output["items"]), "output_path": str(output_path)},
                ensure_ascii=False,
            )
        )
    return 0


def _score_item(item: object, *, scorer: RagasScorer) -> dict[str, object]:
    if not isinstance(item, dict):
        raise ValueError("items entries must be objects")
    case_id = _required_str(item.get("case_id"), "items[].case_id")
    _assert_allowed_sample_fields(item, case_id)
    reference = _optional_str(item.get("reference")) or ""
    metadata = _optional_mapping(item.get("metadata"))
    projection = RagasProjection(
        case_id=case_id,
        user_input=_required_str(item.get("user_input"), f"{case_id}.user_input"),
        response=_required_str(item.get("response"), f"{case_id}.response"),
        retrieved_contexts=tuple(
            _required_string_list(item.get("retrieved_contexts"), f"{case_id}.retrieved_contexts")
        ),
        cited_contexts=tuple(
            _required_string_list(item.get("cited_contexts"), f"{case_id}.cited_contexts")
        ),
        reference=reference,
        metadata=metadata,
    )
    scores: dict[str, float] = {}
    errors: list[dict[str, str]] = []
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
        score = float(result.score)
        if not math.isfinite(score):
            errors.append(
                {
                    "metric_name": metric_name,
                    "reason": result.rationale or "ragas score is not finite",
                }
            )
            continue
        scores[metric_name] = score
    return {
        "case_id": case_id,
        "scores": scores,
        "errors": errors,
        **({"metadata": metadata} if metadata else {}),
    }


async def _score_with_official_ragas_metrics(
    projection: RagasProjection,
    *,
    metric_names: tuple[str, ...],
    llm: object,
    embeddings: object,
) -> tuple[RagasResult, ...]:
    from ragas.metrics.collections import (
        AnswerRelevancy,
        ContextPrecision,
        ContextRecall,
        Faithfulness,
    )

    retrieved_contexts = list(projection.retrieved_contexts)
    cited_contexts = list(projection.cited_contexts)
    results: list[RagasResult] = []
    for metric_name in metric_names:
        if metric_name in {"context_precision", "context_recall"} and not projection.reference:
            continue
        contexts = cited_contexts if metric_name == "faithfulness" else retrieved_contexts
        if metric_name in {"faithfulness", "context_precision", "context_recall"} and not contexts:
            results.append(
                RagasResult(
                    metric_name=metric_name,
                    rationale=(
                        "cited_contexts is empty"
                        if metric_name == "faithfulness"
                        else "retrieved_contexts is empty"
                    ),
                )
            )
            continue
        if metric_name == "faithfulness":
            score = await Faithfulness(llm=llm).ascore(
                projection.user_input, projection.response, contexts
            )
        elif metric_name == "answer_relevancy":
            score = await AnswerRelevancy(llm=llm, embeddings=embeddings, strictness=1).ascore(
                projection.user_input, projection.response
            )
        elif metric_name == "context_precision":
            score = await ContextPrecision(llm=llm).ascore(
                projection.user_input, projection.reference, contexts
            )
        elif metric_name == "context_recall":
            score = await ContextRecall(llm=llm).ascore(
                projection.user_input, contexts, projection.reference
            )
        else:
            raise ValueError(f"unsupported metric: {metric_name}")
        results.append(
            RagasResult(
                metric_name=metric_name,
                score=_metric_value(score),
                rationale=_metric_reason(score),
            )
        )
    return tuple(results)


def _metric_value(result: object) -> float | None:
    value = getattr(result, "value", result)
    if isinstance(value, int | float) and math.isfinite(float(value)):
        return float(value)
    return None


def _metric_reason(result: object) -> str:
    reason = getattr(result, "reason", None)
    return reason.strip() if isinstance(reason, str) else ""


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
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
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    return [_required_str(item, f"{field}[]") for item in value]


def _optional_mapping(value: object) -> dict[str, object]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("metadata must be an object")
    return {str(key): _scalar_or_none(raw_value) for key, raw_value in value.items()}


def _scalar_or_none(value: object) -> object:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    raise ValueError("metadata values must be scalar or null")


def _qualify_metric_name(metric_name: str) -> str:
    normalized = metric_name.strip()
    if not normalized:
        raise ValueError("metric_name must not be empty")
    return normalized if normalized.startswith("ragas.") else f"ragas.{normalized}"


def _assert_allowed_sample_fields(value: Mapping[str, object], case_id: str) -> None:
    allowed = {
        "case_id",
        "cited_contexts",
        "metadata",
        "reference",
        "response",
        "retrieved_contexts",
        "user_input",
    }
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ValueError(f"{case_id} contains unsupported fields: {', '.join(unknown)}")


def _required_path(value: Path | None, field: str) -> Path:
    if value is None:
        raise ValueError(f"{field} is required")
    return value
