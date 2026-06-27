from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from datetime import UTC, datetime

from campus_evals.models import reject_forbidden_workflow_trace_keys

OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION = "operator_step_trajectory.v1"
OPERATOR_STEP_TRAJECTORY_RELEASE_FIXTURE_SCHEMA_VERSION = (
    "operator_step_trajectory_release_fixture.v1"
)

_LOCAL_ARTIFACT_KEY_TOKENS = (
    "artifactpath",
    "bucket",
    "localpath",
    "objectkey",
    "path",
    "rawanswer",
    "rawprompt",
    "temporalhistory",
    "transcript",
)


def normalize_operator_step_trajectory(operator_request_detail: Mapping[str, object]) -> dict:
    _assert_operator_safe_trajectory_source(operator_request_detail)
    runtime_run = _mapping_field(operator_request_detail.get("runtimeRun"), "runtimeRun")
    step_trajectory = _mapping_field(
        runtime_run.get("operatorStepTrajectory"),
        "runtimeRun.operatorStepTrajectory",
    )
    run = _mapping_field(runtime_run.get("run"), "runtimeRun.run")
    raw_steps = _list_field(
        step_trajectory.get("steps"),
        "runtimeRun.operatorStepTrajectory.steps",
    )
    schema_version = _required_string(
        step_trajectory.get("schemaVersion"),
        "runtimeRun.operatorStepTrajectory.schemaVersion",
    )
    if schema_version != OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION:
        raise ValueError("runtimeRun.operatorStepTrajectory.schemaVersion is unsupported")

    request_id = _required_string(run.get("requestId"), "runtimeRun.run.requestId")
    run_id = _required_string(run.get("runId"), "runtimeRun.run.runId")
    trace_id = _required_string(run.get("traceId"), "runtimeRun.run.traceId")
    conversation_id = _required_string(
        run.get("conversationId"),
        "runtimeRun.run.conversationId",
    )

    return {
        "schemaVersion": OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION,
        "requestId": request_id,
        "runId": run_id,
        "traceId": trace_id,
        "conversationId": conversation_id,
        "steps": [
            _normalize_step(item, f"runtimeRun.operatorStepTrajectory.steps[{index}]")
            for index, item in enumerate(raw_steps)
        ],
    }


def build_release_evidence_fixture(
    trajectory: Mapping[str, object],
    *,
    generated_at: str,
    source_git_head: str,
) -> dict:
    _assert_operator_safe_trajectory_source(trajectory)
    if trajectory.get("schemaVersion") != OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION:
        raise ValueError("trajectory.schemaVersion must be operator_step_trajectory.v1")
    steps = [
        _mapping_field(item, f"steps[{index}]") for index, item in enumerate(_steps(trajectory))
    ]
    timeout_counts = _outcome_counts(steps, "timeoutOutcome", default="not_timed_out")
    cancel_counts = _outcome_counts(steps, "cancelOutcome", default="not_requested")
    late_counts = _outcome_counts(steps, "lateCompletionOutcome", default="not_late")
    fail_close_counts = _outcome_counts(steps, "failCloseReason", default="")
    replan_counts = _outcome_counts(steps, "replanReason", default="")
    return {
        "schemaVersion": OPERATOR_STEP_TRAJECTORY_RELEASE_FIXTURE_SCHEMA_VERSION,
        "evidenceMode": "local_fixture",
        "stagingEvidence": False,
        "generatedAt": _iso_timestamp(generated_at, "generated_at"),
        "sourceGitHead": _required_string(source_git_head, "source_git_head"),
        "requestId": _required_string(trajectory.get("requestId"), "trajectory.requestId"),
        "runId": _required_string(trajectory.get("runId"), "trajectory.runId"),
        "traceId": _required_string(trajectory.get("traceId"), "trajectory.traceId"),
        "summary": {
            "stepCount": len(steps),
            "timeoutOutcomeCounts": timeout_counts,
            "cancelOutcomeCounts": cancel_counts,
            "lateCompletionOutcomeCounts": late_counts,
            "failCloseReasonCounts": fail_close_counts,
            "replanReasonCounts": replan_counts,
        },
        "trajectoryRefs": [
            {
                "stepId": _required_string(step.get("stepId"), f"steps[{index}].stepId"),
                "tool": _required_string(
                    step.get("tool"),
                    f"steps[{index}].tool",
                ),
                "stepKind": _required_string(step.get("stepKind"), f"steps[{index}].stepKind"),
                "status": _required_string(step.get("status"), f"steps[{index}].status"),
                "projectionRefs": _string_list_field(
                    step.get("projectionRefs") or [],
                    f"steps[{index}].projectionRefs",
                ),
            }
            for index, step in enumerate(steps)
        ],
    }


def trajectory_attribution_for_stage(
    trajectory: Mapping[str, object] | None,
    *,
    failure_stage: str,
) -> dict:
    if trajectory is None:
        return _missing_attribution("trajectory_missing")
    _assert_operator_safe_trajectory_source(trajectory)
    if trajectory.get("schemaVersion") != OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION:
        raise ValueError("operator_step_trajectory.schemaVersion is unsupported")
    steps = [
        _mapping_field(item, f"steps[{index}]") for index, item in enumerate(_steps(trajectory))
    ]
    matched = _match_step_for_stage(steps, failure_stage)
    if matched is None:
        return _missing_attribution("attribution_missing")
    return {
        "status": "attributed",
        "stepId": _optional_string(matched.get("stepId")),
        "stepKind": _optional_string(matched.get("stepKind")),
        "tool": _optional_string(matched.get("tool")),
        "toolName": _optional_string(matched.get("toolName")),
        "stepStatus": _optional_string(matched.get("status")),
        "outcome": _step_outcome(matched),
        "projectionRefs": _string_list_field(
            matched.get("projectionRefs") or [],
            "matched.projectionRefs",
        ),
    }


def _normalize_step(value: object, field_name: str) -> dict:
    step = _mapping_field(value, field_name)
    latest_ref = _optional_string(step.get("latestResultRef"))
    return {
        "stepId": _required_string(step.get("stepId"), f"{field_name}.stepId"),
        "stepKind": _required_string(step.get("stepKind"), f"{field_name}.stepKind"),
        "tool": _required_string(step.get("tool"), f"{field_name}.tool"),
        "toolName": _optional_string(step.get("toolName")),
        "status": _required_string(step.get("status"), f"{field_name}.status"),
        "attemptCount": _non_negative_int(step.get("attemptCount"), f"{field_name}.attemptCount"),
        "resultCount": _non_negative_int(step.get("resultCount"), f"{field_name}.resultCount"),
        "queueWaitMs": _optional_non_negative_int(
            step.get("queueWaitMs"), f"{field_name}.queueWaitMs"
        ),
        "durationMs": _optional_non_negative_int(
            step.get("durationMs"), f"{field_name}.durationMs"
        ),
        "taskQueue": _required_string(step.get("taskQueue"), f"{field_name}.taskQueue"),
        "workerId": _required_string(step.get("workerId"), f"{field_name}.workerId"),
        "modelProvider": _optional_string(step.get("modelProvider")),
        "modelName": _optional_string(step.get("modelName")),
        "inputTokens": _non_negative_int(
            step.get("inputTokens") or 0,
            f"{field_name}.inputTokens",
        ),
        "outputTokens": _non_negative_int(
            step.get("outputTokens") or 0,
            f"{field_name}.outputTokens",
        ),
        "estimatedCostMicrousd": _non_negative_int(
            step.get("estimatedCostMicrousd") or 0,
            f"{field_name}.estimatedCostMicrousd",
        ),
        "providerRequestRef": _optional_string(step.get("providerRequestRef")),
        "failCloseReason": _optional_string(step.get("failCloseReason")),
        "terminalReason": _optional_string(step.get("terminalReason")),
        "replanReason": _optional_string(step.get("replanReason")),
        "cancelOutcome": _optional_string(step.get("cancelOutcome")),
        "timeoutOutcome": _optional_string(step.get("timeoutOutcome")),
        "lateCompletionOutcome": _optional_string(step.get("lateCompletionOutcome")),
        "projectionRefs": _normalized_projection_refs(step, latest_ref, field_name),
    }


def _normalized_projection_refs(
    step: Mapping[str, object],
    latest_ref: str | None,
    field_name: str,
) -> list[str]:
    refs_value = step.get("projectionRefs")
    if refs_value is not None:
        return _string_list_field(refs_value, f"{field_name}.projectionRefs")
    return [latest_ref] if latest_ref else []


def _match_step_for_stage(
    steps: list[Mapping[str, object]], failure_stage: str
) -> Mapping[str, object] | None:
    normalized_stage = _required_string(failure_stage, "failure_stage")
    aliases = _stage_aliases(normalized_stage)
    for step in steps:
        if _optional_string(step.get("stepKind")) in aliases:
            return step
    for step in steps:
        step_id = _optional_string(step.get("stepId")) or ""
        normalized_step_id = step_id.replace("_", ".")
        if any(alias.replace("_", ".") in normalized_step_id for alias in aliases):
            return step
    return None


def _stage_aliases(stage: str) -> set[str]:
    normalized = stage.strip().lower().replace("-", "_").replace(".", "_")
    alias_map = {
        "routing": {"routing", "route", "planning", "plan.route", "plan_route"},
        "route": {"routing", "route", "planning", "plan.route", "plan_route"},
        "planning": {"routing", "route", "planning", "plan.route", "plan_route"},
        "primary_agent": {"agent", "primary_agent", "agent.primary", "agent_primary"},
        "agent": {"agent", "primary_agent", "agent.primary", "agent_primary"},
        "tool": {"tool", "typed_tool", "sdk_tool", "sdk_tool.execute", "tool_execution"},
        "typed_tool": {"tool", "typed_tool", "sdk_tool", "sdk_tool.execute", "tool_execution"},
        "retrieval": {"retrieval", "indexed_lookup", "retrieval.indexed_lookup"},
        "rerank": {"rerank", "retrieval.rerank", "retrieval_rerank"},
        "selection": {"selection", "evidence_selection", "evidence.selection"},
        "evidence_selection": {"selection", "evidence_selection", "evidence.selection"},
        "synthesis": {"synthesis", "answer_synthesis"},
        "grounding": {"grounding", "grounding.verify", "grounding_verify"},
        "finalization": {"finalization", "finalization.write", "finalization_write"},
        "clarification": {"finalization", "finalization.write", "finalization_write"},
        "needs_clarification": {"finalization", "finalization.write", "finalization_write"},
        "rejected": {"finalization", "finalization.write", "finalization_write"},
        "no_answer": {"finalization", "finalization.write", "finalization_write"},
        "replan": {"replan", "plan.replan", "plan_replan"},
    }
    aliases = {stage, normalized}
    aliases.update(alias_map.get(normalized, set()))
    return aliases


def _missing_attribution(status: str) -> dict:
    return {
        "status": status,
        "stepId": None,
        "stepKind": None,
        "tool": None,
        "toolName": None,
        "stepStatus": None,
        "outcome": {
            "failCloseReason": None,
            "terminalReason": None,
            "replanReason": None,
            "cancelOutcome": None,
            "timeoutOutcome": None,
            "lateCompletionOutcome": None,
        },
        "projectionRefs": [],
    }


def _step_outcome(step: Mapping[str, object]) -> dict:
    return {
        "failCloseReason": _optional_string(step.get("failCloseReason")),
        "terminalReason": _optional_string(step.get("terminalReason")),
        "replanReason": _optional_string(step.get("replanReason")),
        "cancelOutcome": _optional_string(step.get("cancelOutcome")),
        "timeoutOutcome": _optional_string(step.get("timeoutOutcome")),
        "lateCompletionOutcome": _optional_string(step.get("lateCompletionOutcome")),
    }


def _steps(trajectory: Mapping[str, object]) -> list[object]:
    return _list_field(trajectory.get("steps"), "trajectory.steps")


def _outcome_counts(
    steps: list[Mapping[str, object]],
    key: str,
    *,
    default: str,
) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for step in steps:
        value = _optional_string(step.get(key))
        if value is None or value == default:
            continue
        counts[value] += 1
    return dict(sorted(counts.items()))


def _assert_operator_safe_trajectory_source(value: object) -> None:
    reject_forbidden_workflow_trace_keys(value, "operator_step_trajectory")
    _reject_local_artifact_keys(value, "operator_step_trajectory")


def _reject_local_artifact_keys(value: object, path: str) -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            normalized_key = _normalize_key_token(str(key))
            child_path = f"{path}.{key}"
            if any(token in normalized_key for token in _LOCAL_ARTIFACT_KEY_TOKENS):
                raise ValueError(
                    f"operator_step_trajectory contains forbidden raw trajectory key: {child_path}"
                )
            _reject_local_artifact_keys(nested, child_path)
    elif isinstance(value, list | tuple):
        for index, nested in enumerate(value):
            _reject_local_artifact_keys(nested, f"{path}[{index}]")


def _normalize_key_token(value: str) -> str:
    return "".join(ch for ch in value.strip().lower() if ch.isalnum())


def _iso_timestamp(value: object, field_name: str) -> str:
    normalized = _required_string(value, field_name)
    parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    parsed = parsed.astimezone(UTC)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _mapping_field(value: object, field_name: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field_name} is required")
    return value


def _list_field(value: object, field_name: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} is required")
    return value


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None


def _string_list_field(value: object, field_name: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} is required")
    return [_required_string(item, f"{field_name}[{index}]") for index, item in enumerate(value)]


def _non_negative_int(value: object, field_name: str) -> int:
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"{field_name} must be a non-negative integer")
    return value


def _optional_non_negative_int(value: object, field_name: str) -> int | None:
    if value is None:
        return None
    return _non_negative_int(value, field_name)


__all__ = [
    "OPERATOR_STEP_TRAJECTORY_RELEASE_FIXTURE_SCHEMA_VERSION",
    "OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION",
    "build_release_evidence_fixture",
    "normalize_operator_step_trajectory",
    "trajectory_attribution_for_stage",
]
