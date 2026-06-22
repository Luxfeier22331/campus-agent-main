from __future__ import annotations

import argparse
import json
from pathlib import Path

SAMPLE_BATCH_SCHEMA_VERSION = "context_followup_sample_batch.v1"
SCORE_BATCH_SCHEMA_VERSION = "context_followup_score_batch.v1"

FORBIDDEN_METADATA_KEYS = {
    "raw_prompt",
    "raw_answer",
    "raw_transcript",
    "standalone_query",
    "retrieved_snippet",
    "raw_retrieved_snippet",
    "source_body",
    "source_body_text",
    "provider_raw_response",
}


def run_context_followup_score_batch(*, input_path: Path, output_path: Path) -> dict[str, object]:
    payload = _load_json_object(input_path)
    if payload.get("schema_version") != SAMPLE_BATCH_SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {SAMPLE_BATCH_SCHEMA_VERSION}")
    eval_run_id = _required_str(payload.get("eval_run_id"), "eval_run_id")
    dataset_version = _required_str(payload.get("dataset_version"), "dataset_version")
    variant_id = _required_str(payload.get("variant_id"), "variant_id")
    source_git_head = _required_str(payload.get("source_git_head"), "source_git_head")
    items = _required_list(payload.get("items"), "items")
    scored_items = [_score_item(item) for item in items]
    output = {
        "schema_version": SCORE_BATCH_SCHEMA_VERSION,
        "eval_run_id": eval_run_id,
        "dataset_version": dataset_version,
        "variant_id": variant_id,
        "source_git_head": source_git_head,
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
    summary = run_context_followup_score_batch(
        input_path=Path(args.input),
        output_path=Path(args.output),
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def _score_item(item: object) -> dict[str, object]:
    if not isinstance(item, dict):
        raise ValueError("items entries must be objects")
    case_id = _required_str(item.get("case_id"), "items[].case_id")
    trace_id = _required_str(item.get("trace_id"), f"{case_id}.trace_id")
    metadata = _metadata(item.get("metadata"))
    expected_refs = set(_optional_string_list(item.get("expected_reference_ids")))
    observed_refs = set(_optional_string_list(item.get("observed_reference_ids")))
    reference_overlap = len(expected_refs & observed_refs)
    recall = 1.0 if not expected_refs else reference_overlap / len(expected_refs)
    precision = 1.0 if not observed_refs else reference_overlap / len(observed_refs)
    resolution_state = _optional_str(item.get("resolution_state"))
    expected_reference_type = _optional_str(item.get("expected_followup_reference_type"))
    observed_reference_type = _optional_str(item.get("observed_followup_reference_type"))
    input_tokens = _non_negative_number(item.get("input_tokens"), f"{case_id}.input_tokens")
    output_tokens = _non_negative_number(item.get("output_tokens"), f"{case_id}.output_tokens")
    token_budget = _positive_number(item.get("token_budget"), f"{case_id}.token_budget")
    token_cost = input_tokens + output_tokens
    scores = {
        "context.pronoun_resolution": _bool_score(
            resolution_state == "resolved"
            and (
                expected_reference_type is None
                or expected_reference_type == observed_reference_type
            )
        ),
        "context.previous_evidence_reuse": _bool_score(
            expected_reference_type != "previous_evidence"
            or (
                observed_reference_type == "previous_evidence"
                and bool(expected_refs)
                and expected_refs.issubset(observed_refs)
            )
        ),
        "context.rag_followup_recall": recall,
        "context.rag_followup_precision": precision,
        "context.groundedness": _bool_score(item.get("grounded") is True),
        "context.hallucination_free": _bool_score(item.get("hallucination_detected") is not True),
        "context.pollution_free": _bool_score(item.get("context_pollution_detected") is not True),
        "context.concurrent_turn_order": _bool_score(item.get("turn_order_preserved") is True),
        "context.latency_ms": _non_negative_number(item.get("latency_ms"), f"{case_id}.latency_ms"),
        "context.token_cost": token_cost,
        "context.token_budget_ratio": token_cost / token_budget,
    }
    return {
        "case_id": case_id,
        "trace_id": trace_id,
        "observation_id": _optional_str(item.get("observation_id")),
        "dataset_item_id": _optional_str(item.get("dataset_item_id")),
        "dataset_run_id": _optional_str(item.get("dataset_run_id")),
        "scores": scores,
        "errors": [],
        "metadata": {
            **metadata,
            "case_family": metadata.get("case_family", "multi_turn_context_followup"),
        },
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


def _optional_string_list(value: object) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("expected a list of strings")
    return [_required_str(item, "list[]") for item in value]


def _metadata(value: object) -> dict[str, object]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("metadata must be an object")
    metadata: dict[str, object] = {}
    for key, raw_value in value.items():
        normalized = str(key).strip()
        if normalized.lower() in FORBIDDEN_METADATA_KEYS:
            raise ValueError(f"metadata.{normalized} is forbidden")
        metadata[normalized] = _scalar_or_none(raw_value)
    return metadata


def _scalar_or_none(value: object) -> object:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    raise ValueError("metadata values must be scalar or null")


def _non_negative_number(value: object, field: str) -> float:
    if not isinstance(value, int | float) or value < 0:
        raise ValueError(f"{field} must be a non-negative number")
    return value


def _positive_number(value: object, field: str) -> float:
    if not isinstance(value, int | float) or value <= 0:
        raise ValueError(f"{field} must be a positive number")
    return value


def _bool_score(value: bool) -> int:
    return 1 if value else 0


if __name__ == "__main__":
    raise SystemExit(main())
