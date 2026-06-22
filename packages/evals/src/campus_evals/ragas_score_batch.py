from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path

from campus_evals.models import SupplementalResult
from campus_evals.ragas_adapter import build_ragas_scorer
from campus_evals.ragas_adapter_projection import RagasProjection
from campus_evals.settings import RagasSettings

SAMPLE_BATCH_SCHEMA_VERSION = "ragas_sample_batch.v1"
SCORE_BATCH_SCHEMA_VERSION = "ragas_score_batch.v1"

RagasScorer = Callable[[RagasProjection], tuple[SupplementalResult, ...]]

FORBIDDEN_SAMPLE_FIELD_NAMES = frozenset(
    {
        "api_key",
        "authorization",
        "bucket",
        "cookie",
        "database_url",
        "jwt",
        "local_artifact_path",
        "object_key",
        "object_store_secret",
        "provider_raw_response",
        "raw_answer",
        "raw_chat_transcript",
        "raw_prompt",
        "raw_provider_response",
        "raw_retrieved_snippet",
        "raw_trace",
        "source_body",
        "transcript",
    }
)


def run_ragas_score_batch(
    *,
    input_path: Path,
    output_path: Path,
    scorer_factory: Callable[[], RagasScorer] | None = None,
) -> dict[str, object]:
    payload = _load_json_object(input_path)
    if payload.get("schema_version") != SAMPLE_BATCH_SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {SAMPLE_BATCH_SCHEMA_VERSION}")
    eval_run_id = _required_str(payload.get("eval_run_id"), "eval_run_id")
    items = _required_list(payload.get("items"), "items")
    scorer = (
        scorer_factory()
        if scorer_factory is not None
        else build_ragas_scorer(RagasSettings.from_env())
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    summary = run_ragas_score_batch(input_path=Path(args.input), output_path=Path(args.output))
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def _score_item(item: object, *, scorer: RagasScorer) -> dict[str, object]:
    if not isinstance(item, dict):
        raise ValueError("items entries must be objects")
    case_id = _required_str(item.get("case_id"), "items[].case_id")
    _assert_no_forbidden_fields(item, case_id)
    trace_id = _required_str(item.get("trace_id"), f"{case_id}.trace_id")
    observation_id = _optional_str(item.get("observation_id"))
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
            _optional_string_list(item.get("context_ids"), f"{case_id}.context_ids")
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
        scores[metric_name] = result.score
    return {
        "case_id": case_id,
        "trace_id": trace_id,
        "observation_id": observation_id,
        "scores": scores,
        "errors": errors,
        "metadata": metadata,
    }


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


if __name__ == "__main__":
    raise SystemExit(main())
