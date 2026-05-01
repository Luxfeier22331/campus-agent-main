from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping
from pathlib import Path
from threading import Lock

_LOGGER = logging.getLogger(__name__)

RetrievalObservationSink = Callable[[dict[str, object]], None]
RuntimeEventEmitter = Callable[[str, dict[str, object]], None]

_ALLOWED_SCALAR_FIELDS = frozenset(
    {
        "schema_version",
        "request_id",
        "plan_id",
        "step_id",
        "query_mode",
        "retrieval_mode",
        "terminal_state",
        "failure_kind",
        "candidate_count",
        "reference_count",
        "latency_ms",
        "query_sha256",
        "canonical_index_truth",
        "top_score",
        "score_gap",
        "as_of",
        "reranker_degraded",
        "reranker_failure_kind",
    }
)


def sanitize_retrieval_observation(observation: Mapping[str, object]) -> dict[str, object]:
    sanitized: dict[str, object] = {}
    for field in _ALLOWED_SCALAR_FIELDS:
        if field in observation:
            sanitized[field] = _sanitize_scalar(observation[field])

    scope = observation.get("scope")
    if isinstance(scope, Mapping):
        corpus = _sanitize_scalar(scope.get("corpus"))
        collection = _sanitize_scalar(scope.get("collection"))
        if corpus:
            sanitized["scope.corpus"] = corpus
        if collection:
            sanitized["scope.collection"] = collection

    for source_field, count_field in (
        ("target_document_ids", "target_document_ids_count"),
        ("target_version_ids", "target_version_ids_count"),
        ("top_source_ids", "top_source_ids_count"),
        ("source_timestamps", "source_timestamps_count"),
    ):
        if source_field in observation:
            sanitized[count_field] = _bounded_count(observation[source_field])

    has_reference_count = "reference_count" in sanitized
    reference_count = _as_int(sanitized.get("reference_count"))
    terminal_state = str(sanitized.get("terminal_state") or "")
    failure_kind = str(sanitized.get("failure_kind") or "")
    reranker_degraded = bool(sanitized.get("reranker_degraded"))
    sanitized["no_hit"] = has_reference_count and reference_count == 0
    sanitized["low_confidence"] = (
        has_reference_count and terminal_state == "completed" and reference_count == 0
    )
    sanitized["release_metadata_drift"] = failure_kind == "release_metadata_drift"
    sanitized["reranker_degraded"] = reranker_degraded

    return {key: value for key, value in sanitized.items() if value is not None}


def build_retrieval_runtime_event_sink(
    emit_event: RuntimeEventEmitter,
) -> RetrievalObservationSink:
    def sink(observation: dict[str, object]) -> None:
        try:
            emit_event(
                "retrieval.runtime_observation",
                sanitize_retrieval_observation(observation),
            )
        except Exception:
            _LOGGER.warning(
                "retrieval runtime event sink failed for request_id=%s step_id=%s",
                observation.get("request_id"),
                observation.get("step_id"),
                exc_info=True,
            )

    return sink


def build_runtime_event_jsonl_emitter(path: str | Path) -> RuntimeEventEmitter:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_lock = Lock()

    def emit_event(event_name: str, attributes: dict[str, object]) -> None:
        record = {"event_name": event_name, "attributes": dict(attributes)}
        line = json.dumps(record, ensure_ascii=False, sort_keys=True, default=str)
        with write_lock, output_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    return emit_event


def compose_retrieval_observation_sinks(
    *sinks: RetrievalObservationSink | None,
) -> RetrievalObservationSink | None:
    active_sinks = tuple(sink for sink in sinks if sink is not None)
    if not active_sinks:
        return None

    def sink(observation: dict[str, object]) -> None:
        for active_sink in active_sinks:
            try:
                active_sink(observation)
            except Exception:
                _LOGGER.warning(
                    "retrieval observation sink failed for request_id=%s step_id=%s",
                    observation.get("request_id"),
                    observation.get("step_id"),
                    exc_info=True,
                )

    return sink


def _sanitize_scalar(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, bool | int | float):
        return value
    return str(value)


def _bounded_count(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, str | bytes):
        return 1 if value else 0
    try:
        return len(value)  # type: ignore[arg-type]
    except TypeError:
        return 1


def _as_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0
