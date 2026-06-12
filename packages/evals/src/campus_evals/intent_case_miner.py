from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Mapping
from dataclasses import asdict
from pathlib import Path

from campus_evals.intent_models import IntentCase

_REVIEW_LAUNCH_STATES = {"candidate_only", "closed"}
_REVIEW_NEXT_ACTIONS = {"out_of_scope", "approval_required", "rejected"}
_REVIEW_VERDICTS = {"incorrect", "needs_review"}
_FOLLOW_UP_CONTEXT_STATES = {"resolved", "ambiguous", "missing_context"}


def mine_intent_case_candidates(
    records: Iterable[Mapping[str, object]],
) -> tuple[IntentCase, ...]:
    seen_goals: set[str] = set()
    cases: list[IntentCase] = []
    for record in records:
        user_goal = _string_field(record, "user_goal")
        if not user_goal:
            continue
        normalized_goal = _normalize_user_goal(user_goal)
        if normalized_goal in seen_goals:
            continue
        if not _requires_review(record):
            continue
        seen_goals.add(normalized_goal)
        cases.append(_case_from_record(record, user_goal=user_goal))
    return tuple(cases)


def _requires_review(record: Mapping[str, object]) -> bool:
    return (
        _string_field(record, "intent_launch_state") in _REVIEW_LAUNCH_STATES
        or _string_field(record, "intent_next_action") in _REVIEW_NEXT_ACTIONS
        or _string_field(record, "intent_review_verdict") in _REVIEW_VERDICTS
        or _string_field(record, "intent_context_resolution_state") in _FOLLOW_UP_CONTEXT_STATES
    )


def _case_from_record(record: Mapping[str, object], *, user_goal: str) -> IntentCase:
    request_id = _string_field(record, "request_id") or _normalize_user_goal(user_goal)
    launch_state = _string_field(record, "intent_launch_state")
    selected_capability = _string_field(record, "selected_capability") or "none"
    tags = ["mined", "needs_review"]
    if launch_state:
        tags.append(launch_state)
    context_state = _string_field(record, "intent_context_resolution_state")
    if context_state:
        tags.extend(("follow_up", context_state))
    review_verdict = _string_field(record, "intent_review_verdict")
    if review_verdict:
        tags.append(f"reviewed_{review_verdict}")
    return IntentCase(
        case_id=f"mined-{request_id}",
        user_goal=user_goal,
        expected_capability=_string_field(record, "intent_capability"),
        expected_task_kind=_string_field(record, "intent_task_kind"),
        expected_launch_state=launch_state,
        expected_next_action=_string_field(record, "intent_next_action"),
        expected_scope_class=_string_field(record, "intent_scope_class"),
        expected_scope_reason=_string_field(record, "intent_scope_reason"),
        expected_policy_reason=_string_field(record, "intent_policy_reason"),
        expected_context_resolution_state=context_state,
        expected_context_reference_type=_string_field(record, "intent_context_reference_type"),
        expected_target=selected_capability,
        critical=True,
        tags=tuple(tags),
    )


def _normalize_user_goal(user_goal: str) -> str:
    return "".join(user_goal.split()).casefold()


def _string_field(record: Mapping[str, object], key: str) -> str:
    value = record.get(key)
    if value is None:
        return ""
    return str(value).strip()


def _load_jsonl(path: Path) -> tuple[Mapping[str, object], ...]:
    records: list[Mapping[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            records.append(payload)
    return tuple(records)


def _write_jsonl(path: Path, cases: tuple[IntentCase, ...]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(asdict(case), ensure_ascii=False, default=str) + "\n" for case in cases),
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Mine low-confidence intent eval cases.")
    parser.add_argument("--input", required=True, help="Audit JSONL input path.")
    parser.add_argument("--output", required=True, help="Mined IntentCase JSONL output path.")
    args = parser.parse_args(argv)

    cases = mine_intent_case_candidates(_load_jsonl(Path(args.input)))
    _write_jsonl(Path(args.output), cases)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["main", "mine_intent_case_candidates"]
