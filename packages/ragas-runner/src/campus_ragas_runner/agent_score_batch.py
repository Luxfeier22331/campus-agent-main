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

from campus_ragas_runner.score_batch import (
    _assert_no_forbidden_fields,
    _load_runtime_config,
    _optional_mapping,
    _optional_str,
    _qualify_metric_name,
    _required_list,
    _required_str,
    _scalar_or_none,
)

AGENT_SAMPLE_BATCH_SCHEMA_VERSION = "ragas_agent_sample_batch.v1"
AGENT_SCORE_BATCH_SCHEMA_VERSION = "ragas_agent_score_batch.v1"
DEFAULT_AGENT_METRIC_NAMES = ("tool_call_accuracy", "tool_call_f1")
ARGUMENT_MODES = frozenset({"name_only", "eval_safe_args"})


@dataclass(frozen=True, slots=True)
class RagasAgentProjection:
    case_id: str
    query: str
    answer: str
    tool_calls: tuple[dict[str, object], ...]
    reference_tool_calls: tuple[dict[str, object], ...]
    argument_mode: str
    reference: str = ""
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RagasAgentResult:
    metric_name: str
    score: float | None = None
    rationale: str = ""
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RagasAgentRunnerSettings:
    llm_api_key: str | None
    llm_model: str | None
    llm_base_url: str | None
    timeout_seconds: int
    metric_names: tuple[str, ...] = DEFAULT_AGENT_METRIC_NAMES

    @classmethod
    def from_sources(
        cls,
        *,
        runtime_config_path: Path | None = None,
    ) -> RagasAgentRunnerSettings:
        config = _load_runtime_config(runtime_config_path)
        return cls(
            llm_api_key=_optional_setting(
                "llm_api_key",
                config=config,
            ),
            llm_model=_optional_setting(
                "llm_model",
                config=config,
            ),
            llm_base_url=_optional_setting(
                "llm_base_url",
                config=config,
            ),
            timeout_seconds=_positive_int_setting(
                "timeout_seconds",
                config=config,
                default=180,
            ),
            metric_names=_agent_metric_names_setting(config),
        )


RagasAgentScorer = Callable[[RagasAgentProjection], tuple[RagasAgentResult, ...]]
RagasAgentScorerFactory = Callable[[], RagasAgentScorer]


def run_ragas_agent_score_batch(
    *,
    input_path: Path,
    output_path: Path,
    runtime_config_path: Path | None = None,
    scorer_factory: RagasAgentScorerFactory | None = None,
) -> dict[str, object]:
    payload = _load_json_object(input_path)
    if payload.get("schema_version") != AGENT_SAMPLE_BATCH_SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {AGENT_SAMPLE_BATCH_SCHEMA_VERSION}")
    eval_run_id = _required_str(payload.get("eval_run_id"), "eval_run_id")
    items = _required_list(payload.get("items"), "items")
    scorer = (
        scorer_factory()
        if scorer_factory is not None
        else build_ragas_agent_scorer(
            RagasAgentRunnerSettings.from_sources(runtime_config_path=runtime_config_path)
        )
    )
    scored_items = [_score_agent_item(item, scorer=scorer) for item in items]
    output = {
        "schema_version": AGENT_SCORE_BATCH_SCHEMA_VERSION,
        "eval_run_id": eval_run_id,
        "items": scored_items,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return {"items": len(scored_items), "output_path": str(output_path)}


def build_ragas_agent_scorer(settings: RagasAgentRunnerSettings) -> RagasAgentScorer:
    metric_names = settings.metric_names

    def _score(projection: RagasAgentProjection) -> tuple[RagasAgentResult, ...]:
        async def _score_in_one_event_loop() -> tuple[RagasAgentResult, ...]:
            if not (settings.llm_api_key and settings.llm_model):
                return await _score_with_official_ragas_metrics(
                    projection,
                    metric_names=metric_names,
                    llm=None,
                )

            from openai import AsyncOpenAI
            from ragas.llms import llm_factory

            async with AsyncOpenAI(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
                max_retries=0,
                timeout=settings.timeout_seconds,
            ) as client:
                llm = llm_factory(settings.llm_model, client=client, temperature=0)
                return await _score_with_official_ragas_metrics(
                    projection,
                    metric_names=metric_names,
                    llm=llm,
                )

        return tuple(asyncio.run(_score_in_one_event_loop()))

    return _score


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--runtime-config", required=True)
    args = parser.parse_args(argv)
    summary = run_ragas_agent_score_batch(
        input_path=Path(args.input),
        output_path=Path(args.output),
        runtime_config_path=Path(args.runtime_config) if args.runtime_config else None,
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def _score_agent_item(item: object, *, scorer: RagasAgentScorer) -> dict[str, object]:
    if not isinstance(item, dict):
        raise ValueError("items entries must be objects")
    case_id = _required_str(item.get("case_id"), "items[].case_id")
    _assert_no_forbidden_fields(item, case_id)
    trace_id = _required_str(item.get("trace_id"), f"{case_id}.trace_id")
    observation_id = _optional_str(item.get("observation_id"))
    dataset_item_id = _optional_str(item.get("dataset_item_id"))
    dataset_run_id = _optional_str(item.get("dataset_run_id"))
    metadata = _optional_mapping(item.get("metadata"))
    argument_mode = _argument_mode(item.get("argument_mode"), case_id)
    tool_calls = tuple(_tool_call_list(item.get("tool_calls"), f"{case_id}.tool_calls"))
    reference_tool_calls = tuple(
        _tool_call_list(item.get("reference_tool_calls"), f"{case_id}.reference_tool_calls")
    )
    if argument_mode == "eval_safe_args":
        _require_eval_safe_args(tool_calls, f"{case_id}.tool_calls")
        _require_eval_safe_args(reference_tool_calls, f"{case_id}.reference_tool_calls")
    projection = RagasAgentProjection(
        case_id=case_id,
        query=_required_str(item.get("query"), f"{case_id}.query"),
        answer=_optional_str(item.get("answer")) or "",
        tool_calls=tool_calls,
        reference_tool_calls=reference_tool_calls,
        argument_mode=argument_mode,
        reference=_optional_str(item.get("reference")) or "",
        metadata={
            **metadata,
            "trace_id": trace_id,
            "observation_id": observation_id,
        },
    )
    scores: dict[str, float] = {}
    errors: list[dict[str, object]] = []
    for result in scorer(projection):
        metric_name = _qualify_metric_name(result.metric_name)
        if result.score is None:
            errors.append(
                {
                    "metric_name": metric_name,
                    "reason": result.rationale or "ragas agent score missing",
                }
            )
            continue
        score = float(result.score)
        if not math.isfinite(score):
            errors.append(
                {
                    "metric_name": metric_name,
                    "reason": result.rationale or "ragas agent score is not finite",
                }
            )
            continue
        scores[metric_name] = score
    return {
        "case_id": case_id,
        "dataset_item_id": dataset_item_id,
        "dataset_run_id": dataset_run_id,
        "trace_id": trace_id,
        "observation_id": observation_id,
        "scores": scores,
        "errors": errors,
        "metadata": {
            **metadata,
            "argument_mode": argument_mode,
        },
    }


async def _score_with_official_ragas_metrics(
    projection: RagasAgentProjection,
    *,
    metric_names: tuple[str, ...],
    llm: object | None,
) -> tuple[RagasAgentResult, ...]:
    from ragas.metrics.collections import (
        AgentGoalAccuracyWithReference,
        ToolCallAccuracy,
        ToolCallF1,
    )

    messages = _ragas_messages(projection)
    reference_tool_calls = list(_ragas_tool_calls(projection.reference_tool_calls))
    results: list[RagasAgentResult] = []
    suffix = "name_only" if projection.argument_mode == "name_only" else "args"
    for metric_name in metric_names:
        if metric_name == "tool_call_accuracy":
            metric = ToolCallAccuracy()
            score = await metric.ascore(messages, reference_tool_calls)
            results.append(
                RagasAgentResult(
                    metric_name=f"tool_call_accuracy.{suffix}",
                    score=_metric_value(score),
                    rationale=_metric_reason(score),
                )
            )
        elif metric_name == "tool_call_f1":
            metric = ToolCallF1()
            score = await metric.ascore(messages, reference_tool_calls)
            results.append(
                RagasAgentResult(
                    metric_name=f"tool_call_f1.{suffix}",
                    score=_metric_value(score),
                    rationale=_metric_reason(score),
                )
            )
        elif metric_name == "agent_goal_accuracy_with_reference" and projection.reference:
            if llm is None:
                results.append(
                    RagasAgentResult(
                        metric_name="agent_goal_accuracy.with_reference",
                        rationale="llm settings are required for agent goal accuracy",
                    )
                )
                continue
            metric = AgentGoalAccuracyWithReference(llm=llm)
            score = await metric.ascore(messages, projection.reference)
            results.append(
                RagasAgentResult(
                    metric_name="agent_goal_accuracy.with_reference",
                    score=_metric_value(score),
                    rationale=_metric_reason(score),
                )
            )
    return tuple(results)


def _ragas_messages(projection: RagasAgentProjection):
    from ragas.messages import AIMessage, HumanMessage

    return [
        HumanMessage(content=projection.query),
        AIMessage(
            content=projection.answer,
            tool_calls=list(_ragas_tool_calls(projection.tool_calls)),
        ),
    ]


def _ragas_tool_calls(tool_calls: tuple[dict[str, object], ...]):
    from ragas.messages import ToolCall

    return tuple(ToolCall(name=str(item["name"]), args=dict(item["args"])) for item in tool_calls)


def _metric_value(result: object) -> float | None:
    value = getattr(result, "value", None)
    if isinstance(value, int | float) and math.isfinite(float(value)):
        return float(value)
    return None


def _metric_reason(result: object) -> str:
    reason = getattr(result, "reason", None)
    return reason if isinstance(reason, str) else ""


def _tool_call_list(value: object, field: str) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    return [_tool_call(item, f"{field}[{index}]") for index, item in enumerate(value)]


def _tool_call(value: object, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    name = _required_str(value.get("name"), f"{field}.name")
    args = value.get("args", {})
    if not isinstance(args, dict):
        raise ValueError(f"{field}.args must be an object")
    return {
        "name": name,
        "args": {str(key): _scalar_or_none(raw_value) for key, raw_value in args.items()},
    }


def _argument_mode(value: object, case_id: str) -> str:
    mode = _optional_str(value) or "name_only"
    if mode not in ARGUMENT_MODES:
        raise ValueError(f"{case_id}.argument_mode must be name_only or eval_safe_args")
    return mode


def _require_eval_safe_args(tool_calls: tuple[dict[str, object], ...], field: str) -> None:
    for item in tool_calls:
        if item["name"] != "knowledge_query" and not item["args"]:
            raise ValueError(f"{field} eval_safe_args requires non-empty tool args")


def _agent_metric_names_setting(config: Mapping[str, object]) -> tuple[str, ...]:
    raw = config.get("agent_metric_names")
    if raw is None:
        raw = config.get("metric_names")
    if raw is None:
        return DEFAULT_AGENT_METRIC_NAMES
    if not isinstance(raw, list):
        raise ValueError("agent_metric_names must be a list")
    values = tuple(_required_str(item, "agent_metric_names[]") for item in raw)
    allowed = {
        "tool_call_accuracy",
        "tool_call_f1",
        "agent_goal_accuracy_with_reference",
    }
    unsupported = [item for item in values if item not in allowed]
    if unsupported:
        raise ValueError(f"unsupported Ragas agent metrics: {', '.join(unsupported)}")
    return values


def _optional_setting(
    key: str,
    *,
    config: Mapping[str, object],
) -> str | None:
    value = config.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _positive_int_setting(
    key: str,
    *,
    config: Mapping[str, object],
    default: int,
) -> int:
    raw = config.get(key)
    if raw is None:
        return default
    value = int(raw)
    if value <= 0:
        raise ValueError(f"{key} must be greater than zero")
    return value


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload
