from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from pathlib import Path
from threading import Lock

from campus_retrieval_core.models import RetrievalExecutionResult, RetrievalStepResult


def build_jsonl_retrieval_observation_sink(path: str | Path):
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_lock = Lock()

    def sink(observation: dict[str, object]) -> None:
        line = json.dumps(
            observation,
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        )
        with write_lock, output_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    return sink


def build_retrieval_observation_event_sink(emit_event):
    def sink(observation: dict[str, object]) -> None:
        emit_event("retrieval.runtime_observation", dict(observation))

    return sink


def emit_retrieval_observations(
    *,
    execution: RetrievalExecutionResult,
    observation_sink,
    request_id: str,
    include_query_text: bool,
    logger,
) -> None:
    for index, result in enumerate(execution.step_results, start=1):
        if result.activity is None:
            continue
        observation = build_retrieval_observation(
            execution=execution,
            result=result,
            request_id=request_id or f"{execution.plan.plan_id}:step-{index}",
            include_query_text=include_query_text,
        )
        observation_sink(observation)


def build_retrieval_observation(
    *,
    execution: RetrievalExecutionResult,
    result: RetrievalStepResult,
    request_id: str,
    include_query_text: bool,
) -> dict[str, object]:
    activity = result.activity
    if activity is None:
        raise ValueError("retrieval step activity is required to build monitoring observation")
    scores = [float(source.score) for source in result.references if source.score is not None]
    top_score = scores[0] if scores else None
    observation: dict[str, object] = {
        "schema_version": "retrieval-runtime-observation-v1",
        "request_id": request_id,
        "plan_id": execution.plan.plan_id,
        "step_id": activity.step_id,
        "query_mode": execution.plan.query_mode,
        "retrieval_mode": observation_retrieval_mode(
            query_mode=execution.plan.query_mode,
            step_type=activity.step_type,
        ),
        "query_sha256": hashlib.sha256(activity.query_text.encode("utf-8")).hexdigest(),
        "scope": {"corpus": activity.corpus, "collection": activity.collection},
        "terminal_state": "failed_closed"
        if result.status in {"blocked", "failed"}
        else "completed",
        "failure_kind": activity.failure_kind or "",
        "candidate_count": activity.candidate_count,
        "reference_count": activity.reference_count,
        "top_score": top_score,
        "score_gap": score_gap(scores),
        "top_source_ids": tuple(source.doc_id for source in result.references[:5]),
        "target_document_ids": activity.target_document_ids,
        "target_version_ids": activity.target_version_ids,
        "need_ids": activity.need_ids,
        "latency_ms": activity.latency_ms,
    }
    observation["canonical_index_truth"] = True
    source_timestamps = tuple(
        str(source.anchor.get("source_timestamp") or "")
        for source in result.references
        if source.anchor.get("source_timestamp")
    )
    if source_timestamps:
        observation["source_timestamps"] = source_timestamps
    if execution.plan.version_query is not None and execution.plan.version_query.as_of:
        observation["as_of"] = execution.plan.version_query.as_of
    if include_query_text:
        observation["query"] = activity.query_text
    if activity.reranker_failure_kind:
        observation["reranker_failure_kind"] = activity.reranker_failure_kind
    if activity.contract_missing:
        observation["contract_missing"] = True
        observation["contract_issue_reason"] = activity.contract_issue_reason
        observation["missing_contract_fields"] = activity.missing_contract_fields
        observation["source_index_contract_version"] = activity.source_index_contract_version
    return observation


def score_gap(scores: Sequence[float]) -> float | None:
    if len(scores) < 2:
        return None
    return scores[0] - scores[1]


def observation_retrieval_mode(
    *,
    query_mode: str,
    step_type: str,
) -> str:
    return query_mode


__all__ = [
    "build_jsonl_retrieval_observation_sink",
    "build_retrieval_observation",
    "build_retrieval_observation_event_sink",
    "emit_retrieval_observations",
    "observation_retrieval_mode",
    "score_gap",
]
