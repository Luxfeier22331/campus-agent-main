from __future__ import annotations

import json
import subprocess
from collections.abc import Sequence
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from campus_evals.intent_models import IntentCase, IntentEvalReport, ObservedIntent
from campus_evals.intent_runner import (
    build_intent_eval_report,
    intent_case_result_from_observed,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
EXECUTION_CONTROL_DIR = REPO_ROOT / "apps" / "execution-control"
DEFAULT_GO_RUNNER_COMMAND = ("go", "run", "./cmd/intent-eval-runner")


def run_intent_cases_with_go(
    cases: tuple[IntentCase, ...],
    *,
    command: Sequence[str] = DEFAULT_GO_RUNNER_COMMAND,
) -> IntentEvalReport:
    output = _run_go_runner(cases, command=command)
    if output.get("runner") != "execution-control-go":
        raise RuntimeError(f"unexpected intent runner: {output.get('runner')}")
    raw_results = output.get("results")
    if not isinstance(raw_results, list):
        raise RuntimeError("go intent runner output.results must be a list")
    observed_by_case_id = {
        _required_string(item.get("case_id"), "case_id"): _observed_from_payload(
            _mapping(item.get("observed"), "observed")
        )
        for item in (_mapping(item, "results[]") for item in raw_results)
    }
    results = tuple(
        intent_case_result_from_observed(case, observed_by_case_id[case.case_id]) for case in cases
    )
    return build_intent_eval_report(cases, results)


def _run_go_runner(
    cases: tuple[IntentCase, ...],
    *,
    command: Sequence[str],
) -> dict[str, Any]:
    payload = {"cases": [_case_payload(case) for case in cases]}
    completed = subprocess.run(
        tuple(command),
        cwd=EXECUTION_CONTROL_DIR,
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "go intent runner failed: "
            f"exit={completed.returncode} stderr={completed.stderr.strip()}"
        )
    parsed = json.loads(completed.stdout)
    if not isinstance(parsed, dict):
        raise RuntimeError("go intent runner output must be an object")
    return parsed


def _case_payload(case: IntentCase) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "case_id": case.case_id,
        "user_goal": case.user_goal,
        "requested_capability": case.requested_capability,
        "context": _json_ready(case.context),
    }
    if case.requested_scope is not None:
        payload["requested_scope"] = _json_ready(case.requested_scope)
    if (
        case.version_query.mode != "current"
        or case.version_query.as_of
        or case.version_query.version_id
        or case.version_query.compare_to_version_id
    ):
        payload["version_query"] = _json_ready(case.version_query)
    return payload


def _observed_from_payload(payload: dict[str, Any]) -> ObservedIntent:
    return ObservedIntent(
        capability=_optional_string(payload.get("capability")),
        task_kind=_optional_string(payload.get("task_kind")),
        launch_state=_optional_string(payload.get("launch_state")),
        next_action=_optional_string(payload.get("next_action")),
        scope_class=_optional_string(payload.get("scope_class")),
        policy_reason=_optional_string(payload.get("policy_reason")),
        scope_reason=_optional_string(payload.get("scope_reason")),
        target=_optional_string(payload.get("selected_capability"))
        or _optional_string(payload.get("target"))
        or "none",
        allowed_tools=_string_tuple(payload.get("allowed_tools")),
        classifier_version=_optional_string(payload.get("classifier_version")),
        schema_version=_optional_string(payload.get("schema_version")),
        context_resolution_state=_optional_string(payload.get("context_resolution_state")),
        context_reference_type=_optional_string(payload.get("context_reference_type")),
        missing_slots=_string_tuple(payload.get("missing_slots")),
        planning_outcome=_optional_string(payload.get("planning_outcome")),
        terminal_status=_optional_string(payload.get("terminal_status")),
        error_code=_optional_string(payload.get("error_code")),
    )


def _json_ready(value: object) -> object:
    if is_dataclass(value):
        return _json_ready(asdict(value))
    if isinstance(value, dict):
        return {str(key): _json_ready(item) for key, item in value.items() if item is not None}
    if isinstance(value, list | tuple):
        return [_json_ready(item) for item in value]
    return value


def _mapping(value: object, field_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeError(f"{field_name} must be an object")
    return dict(value)


def _required_string(value: object, field_name: str) -> str:
    normalized = _optional_string(value)
    if not normalized:
        raise RuntimeError(f"{field_name} is required")
    return normalized


def _optional_string(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _string_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list | tuple):
        raise RuntimeError("string tuple field must be a list")
    return tuple(str(item).strip() for item in value if str(item).strip())


__all__ = [
    "DEFAULT_GO_RUNNER_COMMAND",
    "EXECUTION_CONTROL_DIR",
    "run_intent_cases_with_go",
]
