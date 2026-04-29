from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from campus_evals.models import reject_forbidden_workflow_trace_keys

OBSERVED_REGRESSION_REVIEW_ACTIONS = (
    "accept",
    "reject",
    "duplicate",
    "deprecated",
    "needs_info",
)

_REVIEW_STATUS_BY_ACTION = {
    "accept": "accepted",
    "reject": "rejected",
    "duplicate": "duplicate",
    "deprecated": "deprecated",
    "needs_info": "needs_info",
}


@dataclass(frozen=True, slots=True)
class ObservedRegressionReviewOutputs:
    reviewed_manifest: dict[str, object]
    accepted_fixture: dict[str, object]


def build_observed_regression_review_outputs(
    pending_manifest: dict[str, object],
    decisions: list[dict[str, object]] | tuple[dict[str, object], ...],
) -> ObservedRegressionReviewOutputs:
    _validate_pending_manifest(pending_manifest)
    decision_index = _build_decision_index(decisions)
    candidates = _candidate_list(pending_manifest)
    candidate_index = {
        _required_string(item.get("case_id"), "candidate.case_id"): item for item in candidates
    }
    unknown_decision_ids = sorted(set(decision_index) - set(candidate_index))
    if unknown_decision_ids:
        raise ValueError(
            "review decisions reference unknown candidate ids: " + ", ".join(unknown_decision_ids)
        )

    accepted_cases: list[dict[str, object]] = []
    reviewed_candidates: list[dict[str, object]] = []
    accepted_case_ids: set[str] = set()
    for candidate in candidates:
        case_id = _required_string(candidate.get("case_id"), "candidate.case_id")
        decision = decision_index.get(case_id)
        if decision is None:
            reviewed_candidates.append(
                _candidate_with_review(candidate, {"decision": "pending_review"})
            )
            continue

        action = _required_string(decision.get("decision"), "decision")
        if action not in OBSERVED_REGRESSION_REVIEW_ACTIONS:
            raise ValueError(f"unsupported observed regression review decision: {action}")

        review_payload = _review_payload_for_decision(decision, action)
        reviewed_candidates.append(_candidate_with_review(candidate, review_payload))
        if action != "accept":
            continue

        accepted_case = _accepted_case_from_decision(candidate, decision, review_payload)
        accepted_case_id = _required_string(accepted_case.get("case_id"), "accepted case_id")
        if accepted_case_id in accepted_case_ids:
            raise ValueError(f"duplicate accepted case_id: {accepted_case_id}")
        accepted_case_ids.add(accepted_case_id)
        accepted_cases.append(accepted_case)

    reviewed_manifest = {
        "schema_version": 1,
        "domain": _required_string(pending_manifest.get("domain"), "manifest.domain"),
        "target_suite": _required_string(
            pending_manifest.get("target_suite"), "manifest.target_suite"
        ),
        "generated_at": _required_string(
            pending_manifest.get("generated_at"), "manifest.generated_at"
        ),
        "reviewed_candidate_count": len(reviewed_candidates),
        "accepted_case_count": len(accepted_cases),
        "candidates": reviewed_candidates,
    }
    accepted_fixture = {
        "schema_version": 1,
        "cases": accepted_cases,
    }
    return ObservedRegressionReviewOutputs(
        reviewed_manifest=reviewed_manifest,
        accepted_fixture=accepted_fixture,
    )


def load_observed_regression_review_decisions(path: str | Path) -> tuple[dict[str, object], ...]:
    payload = _load_json(Path(path))
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("observed regression review decisions schema_version must be 1")
    raw_decisions = payload.get("decisions")
    if not isinstance(raw_decisions, list):
        raise ValueError("observed regression review decisions must be a list")
    decisions: list[dict[str, object]] = []
    for index, item in enumerate(raw_decisions):
        if not isinstance(item, dict):
            raise ValueError(
                f"observed regression review decision at index {index} must be an object"
            )
        decisions.append(dict(item))
    return tuple(decisions)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Apply eval-owned observed regression review decisions."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    apply_parser = subparsers.add_parser(
        "apply",
        help="Apply review decisions to a pending candidate manifest.",
    )
    apply_parser.add_argument(
        "--manifest", required=True, help="Pending review manifest JSON path."
    )
    apply_parser.add_argument("--decisions", required=True, help="Review decisions JSON path.")
    apply_parser.add_argument(
        "--reviewed-output",
        required=True,
        help="Reviewed manifest JSON output path.",
    )
    apply_parser.add_argument(
        "--accepted-output",
        required=True,
        help="Accepted observed regression fixture JSON output path.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command != "apply":
        raise ValueError(f"unsupported command: {args.command}")
    outputs = build_observed_regression_review_outputs(
        _load_json(Path(args.manifest)),
        list(load_observed_regression_review_decisions(Path(args.decisions))),
    )
    reviewed_output = Path(args.reviewed_output)
    accepted_output = Path(args.accepted_output)
    reviewed_output.parent.mkdir(parents=True, exist_ok=True)
    accepted_output.parent.mkdir(parents=True, exist_ok=True)
    _write_json(reviewed_output, outputs.reviewed_manifest)
    _write_json(accepted_output, outputs.accepted_fixture)
    print(
        "Observed regression review: "
        f"reviewed={outputs.reviewed_manifest['reviewed_candidate_count']} "
        f"accepted={outputs.reviewed_manifest['accepted_case_count']} "
        f"reviewed_output={reviewed_output} accepted_output={accepted_output}"
    )
    return 0


def _validate_pending_manifest(manifest: dict[str, object]) -> None:
    if int(manifest.get("schema_version") or 0) != 1:
        raise ValueError("pending review manifest schema_version must be 1")
    _required_string(manifest.get("domain"), "manifest.domain")
    _required_string(manifest.get("target_suite"), "manifest.target_suite")
    _required_string(manifest.get("generated_at"), "manifest.generated_at")
    _candidate_list(manifest)


def _candidate_list(manifest: dict[str, object]) -> list[dict[str, object]]:
    raw_candidates = manifest.get("candidates")
    if not isinstance(raw_candidates, list):
        raise ValueError("pending review manifest candidates must be a list")
    candidates: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(raw_candidates):
        if not isinstance(item, dict):
            raise ValueError(f"pending review candidate at index {index} must be an object")
        candidate = dict(item)
        case_id = _required_string(candidate.get("case_id"), "candidate.case_id")
        if case_id in seen_ids:
            raise ValueError(f"duplicate pending candidate case_id: {case_id}")
        seen_ids.add(case_id)
        candidates.append(candidate)
    return candidates


def _build_decision_index(
    decisions: list[dict[str, object]] | tuple[dict[str, object], ...],
) -> dict[str, dict[str, object]]:
    index: dict[str, dict[str, object]] = {}
    for decision in decisions:
        case_id = _required_string(decision.get("case_id"), "decision.case_id")
        if case_id in index:
            raise ValueError(f"duplicate review decision for case_id: {case_id}")
        index[case_id] = dict(decision)
    return index


def _review_payload_for_decision(
    decision: dict[str, object],
    action: str,
) -> dict[str, object]:
    review = {
        "decision": _REVIEW_STATUS_BY_ACTION[action],
        "reviewer": _required_string(decision.get("reviewer"), "reviewer"),
        "reviewed_at": _required_string(decision.get("reviewed_at"), "reviewed_at"),
        "reason": _required_string(decision.get("reason"), "reason"),
        "target_suite": _required_string(decision.get("target_suite"), "target_suite"),
    }
    if action == "accept":
        review["accepted_case_id"] = _required_string(
            decision.get("accepted_case_id"),
            "accepted_case_id",
        )
    if action == "duplicate":
        duplicate_of = _required_string(decision.get("duplicate_of"), "duplicate_of")
        if duplicate_of == _required_string(decision.get("case_id"), "decision.case_id"):
            raise ValueError("duplicate_of must not equal case_id")
        review["duplicate_of"] = duplicate_of
    return review


def _candidate_with_review(
    candidate: dict[str, object],
    review_payload: dict[str, object],
) -> dict[str, object]:
    return {
        **candidate,
        "review": {
            **dict(candidate.get("review") or {}),
            **review_payload,
        },
    }


def _accepted_case_from_decision(
    candidate: dict[str, object],
    decision: dict[str, object],
    review_payload: dict[str, object],
) -> dict[str, object]:
    accepted_domain = _required_string(decision.get("accepted_domain"), "accepted_domain")
    accepted_case_id = _required_string(decision.get("accepted_case_id"), "accepted_case_id")
    accepted_case_payload = _mapping(decision.get("accepted_case"), "accepted_case")
    reject_forbidden_workflow_trace_keys(accepted_case_payload, "accepted_case")

    source = _source_for_accepted_case(candidate, decision)
    review = {
        "decision": "accepted",
        "reviewer": review_payload["reviewer"],
        "reviewed_at": review_payload["reviewed_at"],
        "reason": review_payload["reason"],
        "target_suite": review_payload["target_suite"],
        "source_candidate_id": _required_string(candidate.get("case_id"), "candidate.case_id"),
    }
    return {
        "case_id": accepted_case_id,
        "domain": accepted_domain,
        "source": source,
        "review": review,
        f"{accepted_domain}_case": accepted_case_payload,
    }


def _source_for_accepted_case(
    candidate: dict[str, object],
    decision: dict[str, object],
) -> dict[str, object]:
    raw_source = _mapping(candidate.get("source"), "candidate.source")
    source = {
        key: value
        for key, value in raw_source.items()
        if key
        in {
            "source_type",
            "source_request_id",
            "trace_id",
            "sampled_at",
            "source_surface",
            "observed_failure_class",
            "feedback_id",
            "conversation_id",
            "assistant_message_id",
            "answer_kind",
            "citation_posture",
            "trace_link",
            "issue_link",
            "issue_fingerprint",
        }
    }
    for field_name in (
        "source_request_id",
        "trace_id",
        "sampled_at",
        "source_surface",
        "observed_failure_class",
    ):
        _required_string(source.get(field_name), f"source.{field_name}")
    source["expected_fix_reason"] = _required_string(
        raw_source.get("expected_fix_reason") or decision.get("reason"),
        "source.expected_fix_reason",
    )
    return source


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _mapping(value: object, field_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} is required")
    return dict(value)


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "OBSERVED_REGRESSION_REVIEW_ACTIONS",
    "ObservedRegressionReviewOutputs",
    "build_observed_regression_review_outputs",
    "build_parser",
    "load_observed_regression_review_decisions",
    "main",
]
