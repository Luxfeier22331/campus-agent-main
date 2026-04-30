from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class RetrievalMonitoringCandidate:
    request_id: str
    query: str
    scope_key: str
    failure_class: str
    recommended_action: str


@dataclass(frozen=True, slots=True)
class RetrievalMonitoringBacklogReport:
    observation_count: int
    candidate_count: int
    candidates: tuple[RetrievalMonitoringCandidate, ...] = field(default_factory=tuple)
    counts_by_failure_class: dict[str, int] = field(default_factory=dict)


def build_retrieval_monitoring_backlog(
    *,
    observations: Iterable[Mapping[str, Any]],
    low_score_threshold: float,
    low_score_gap_threshold: float,
) -> RetrievalMonitoringBacklogReport:
    candidates: list[RetrievalMonitoringCandidate] = []
    observation_count = 0
    for observation in observations:
        observation_count += 1
        failure_class = _classify_observation(
            observation,
            low_score_threshold=low_score_threshold,
            low_score_gap_threshold=low_score_gap_threshold,
        )
        if failure_class is None:
            continue
        candidates.append(
            RetrievalMonitoringCandidate(
                request_id=_text(observation.get("request_id"))
                or f"observation-{observation_count}",
                query=_text(observation.get("query")) or "",
                scope_key=_scope_key(observation.get("scope")),
                failure_class=failure_class,
                recommended_action=_recommended_action(failure_class),
            )
        )
    counts: dict[str, int] = {}
    for candidate in candidates:
        counts[candidate.failure_class] = counts.get(candidate.failure_class, 0) + 1
    return RetrievalMonitoringBacklogReport(
        observation_count=observation_count,
        candidate_count=len(candidates),
        candidates=tuple(candidates),
        counts_by_failure_class=counts,
    )


def load_retrieval_runtime_observations_jsonl(path: str | Path) -> tuple[dict[str, Any], ...]:
    observations: list[dict[str, Any]] = []
    for line_number, line in enumerate(
        Path(path).read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError(f"runtime observation row {line_number} must be a JSON object")
        observations.append(payload)
    return tuple(observations)


def retrieval_monitoring_backlog_to_dict(
    report: RetrievalMonitoringBacklogReport,
) -> dict[str, object]:
    return {
        "observation_count": report.observation_count,
        "candidate_count": report.candidate_count,
        "counts_by_failure_class": report.counts_by_failure_class,
        "candidates": [
            {
                "request_id": candidate.request_id,
                "query": candidate.query,
                "scope_key": candidate.scope_key,
                "failure_class": candidate.failure_class,
                "recommended_action": candidate.recommended_action,
            }
            for candidate in report.candidates
        ],
    }


def _classify_observation(
    observation: Mapping[str, Any],
    *,
    low_score_threshold: float,
    low_score_gap_threshold: float,
) -> str | None:
    failure_kind = (_text(observation.get("failure_kind")) or "").lower()
    terminal_state = (_text(observation.get("terminal_state")) or "").lower()
    if "drift" in failure_kind or "release_metadata" in failure_kind:
        return "drift_guard_failure"
    if "forbidden" in failure_kind or bool(observation.get("forbidden_hit")):
        return "forbidden_hit"
    if "authz" in failure_kind or bool(observation.get("authz_filtered_all")):
        return "authz_filtered_all"
    if "version" in failure_kind or bool(observation.get("version_mismatch")):
        return "version_mismatch"
    candidate_count = _number(observation.get("candidate_count"))
    if candidate_count == 0:
        return "no_hit"
    top_score = _number(observation.get("top_score"))
    score_gap = _number(observation.get("score_gap"))
    if top_score is not None and top_score < low_score_threshold:
        return "low_confidence"
    if score_gap is not None and score_gap < low_score_gap_threshold:
        return "low_confidence"
    if terminal_state == "failed_closed" and failure_kind:
        return "runtime_fail_closed"
    return None


def _recommended_action(failure_class: str) -> str:
    return {
        "no_hit": "qrels_no_hit_candidate",
        "low_confidence": "qrels_positive_or_hard_negative_review",
        "forbidden_hit": "qrels_forbidden_source_candidate",
        "authz_filtered_all": "authz_projection_review",
        "version_mismatch": "version_qrels_candidate",
        "drift_guard_failure": "release_metadata_repair",
        "runtime_fail_closed": "runtime_failure_triage",
    }.get(failure_class, "operator_review")


def _scope_key(value: object) -> str:
    if not isinstance(value, Mapping):
        return "unknown/unknown"
    corpus = _text(value.get("corpus")) or "unknown"
    collection = _text(value.get("collection")) or "unknown"
    return f"{corpus}/{collection}"


def _text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _number(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


__all__ = [
    "RetrievalMonitoringBacklogReport",
    "RetrievalMonitoringCandidate",
    "build_retrieval_monitoring_backlog",
    "load_retrieval_runtime_observations_jsonl",
    "retrieval_monitoring_backlog_to_dict",
]
