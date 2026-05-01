from __future__ import annotations

from dataclasses import dataclass, field

from campus_evals.agents_sdk_pilot_parity import AgentsSdkPilotParityReport

AGENTS_SDK_POSTURE_DECISION_SCHEMA_VERSION = "agents-sdk-posture-decision-v1"
AGENTS_SDK_RUNTIME_POSTURES = (
    "promote_selected_adapter",
    "keep_experimental_lane",
    "defer_expansion",
    "reject_sdk_adapter",
)


@dataclass(frozen=True, slots=True)
class AgentsSdkPostureEvidence:
    parity_report: AgentsSdkPilotParityReport | None
    phase5_trace_projection_ready: bool
    boundary_checks_passed: bool
    readiness_gate_covered: bool
    rollback_path_documented: bool
    live_latency_cost_evidence_present: bool
    live_smoke_present: bool = False
    notes: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class AgentsSdkRuntimePostureDecision:
    schema_version: str
    selected_posture: str
    promotion_allowed: bool
    evidence_considered: tuple[str, ...]
    blockers: tuple[str, ...]
    promotion_criteria: tuple[str, ...]
    rejection_criteria: tuple[str, ...]
    rollout_notes: tuple[str, ...]
    residual_risks: tuple[str, ...]
    next_allowed_changes: tuple[str, ...]


def decide_agents_sdk_runtime_posture(
    evidence: AgentsSdkPostureEvidence,
) -> AgentsSdkRuntimePostureDecision:
    blockers = _blockers(evidence)
    evidence_considered = _evidence_considered(evidence)
    if "boundary_checks_failed" in blockers:
        selected_posture = "reject_sdk_adapter"
    elif "phase5_trace_projection_missing" in blockers or "readiness_gate_not_covered" in blockers:
        selected_posture = "defer_expansion"
    elif blockers:
        selected_posture = "keep_experimental_lane"
    else:
        selected_posture = "promote_selected_adapter"
    promotion_allowed = selected_posture == "promote_selected_adapter"
    return AgentsSdkRuntimePostureDecision(
        schema_version=AGENTS_SDK_POSTURE_DECISION_SCHEMA_VERSION,
        selected_posture=selected_posture,
        promotion_allowed=promotion_allowed,
        evidence_considered=tuple(evidence_considered),
        blockers=tuple(blockers),
        promotion_criteria=_promotion_criteria(),
        rejection_criteria=_rejection_criteria(),
        rollout_notes=_rollout_notes(selected_posture),
        residual_risks=_residual_risks(evidence, selected_posture),
        next_allowed_changes=_next_allowed_changes(selected_posture),
    )


def _blockers(evidence: AgentsSdkPostureEvidence) -> list[str]:
    blockers: list[str] = []
    if not evidence.boundary_checks_passed:
        blockers.append("boundary_checks_failed")
        return blockers
    if not evidence.phase5_trace_projection_ready:
        blockers.append("phase5_trace_projection_missing")
    if evidence.parity_report is None:
        blockers.append("parity_report_missing")
    elif not evidence.parity_report.passed:
        blockers.append("parity_failed")
    if not evidence.readiness_gate_covered:
        blockers.append("readiness_gate_not_covered")
    if not evidence.rollback_path_documented:
        blockers.append("rollback_path_missing")
    if not evidence.live_latency_cost_evidence_present:
        blockers.append("live_latency_cost_evidence_missing")
    return blockers


def _evidence_considered(evidence: AgentsSdkPostureEvidence) -> list[str]:
    considered: list[str] = []
    if evidence.phase5_trace_projection_ready:
        considered.append("phase5_trace_projection_ready")
    if evidence.parity_report is None:
        considered.append("parity_report_missing")
    elif evidence.parity_report.passed:
        considered.append("parity_passed")
    else:
        considered.append("parity_failed")
        considered.extend(
            sorted(
                result.failure_class
                for result in evidence.parity_report.results
                if result.failure_class
            )
        )
    considered.append(
        "boundary_checks_passed" if evidence.boundary_checks_passed else "boundary_checks_failed"
    )
    considered.append(
        "readiness_gate_covered"
        if evidence.readiness_gate_covered
        else "readiness_gate_not_covered"
    )
    considered.append(
        "rollback_path_documented" if evidence.rollback_path_documented else "rollback_path_missing"
    )
    considered.append(
        "live_latency_cost_evidence_present"
        if evidence.live_latency_cost_evidence_present
        else "live_latency_cost_evidence_missing"
    )
    if evidence.live_smoke_present:
        considered.append("live_smoke_present")
    considered.extend(evidence.notes)
    return _dedupe(considered)


def _promotion_criteria() -> tuple[str, ...]:
    return (
        "Phase 5 sanitized trace and lifecycle projections are present",
        "Phase 6 parity report passes required closed-posture and provider-facing denominator cases",
        "Boundary checks show no SDK type, raw trace, or raw provider payload crosses contracts",
        "Readiness gate covers disabled, missing dependency/config, mismatch, and admitted states",
        "Rollback path preserves existing provider tool loop",
        "Live latency/cost evidence is present before default-product promotion",
    )


def _rejection_criteria() -> tuple[str, ...]:
    return (
        "reject if raw SDK/provider payload crosses repo boundary",
        "reject if SDK tool surface bypasses ToolSpec or Go allowed_tools",
        "reject if SDK lane cannot fail closed for wrong tool, no tool, bad args, or drift",
        "reject if SDK complexity exceeds custom provider-loop maintainability benefits",
    )


def _rollout_notes(selected_posture: str) -> tuple[str, ...]:
    notes = [
        "passing parity does not change product defaults",
        "do not flip default environment values in this phase",
        "keep Go supervisor-api as deterministic admission and finalization owner",
    ]
    if selected_posture == "promote_selected_adapter":
        notes.append("promotion remains selected-tool and explicit-gate scoped")
        notes.append("rollback returns the selected adapter to the provider tool loop")
    if selected_posture == "keep_experimental_lane":
        notes.append("SDK stays default-off and can collect additional evidence")
    if selected_posture == "defer_expansion":
        notes.append("do not add more SDK tools until blockers are closed")
    if selected_posture == "reject_sdk_adapter":
        notes.append("quarantine or remove SDK runtime code in a follow-up cleanup")
    return tuple(notes)


def _residual_risks(
    evidence: AgentsSdkPostureEvidence,
    selected_posture: str,
) -> tuple[str, ...]:
    risks = [
        "SDK trace semantics remain external debug evidence, not repo contract truth",
        "only selected SDK adapter cases have closed/opening evidence",
    ]
    if not evidence.live_smoke_present:
        risks.append("no live SDK smoke evidence recorded in Phase 7")
    if selected_posture == "promote_selected_adapter":
        risks.append("promotion still requires separate product-runtime rollout admission")
    return tuple(risks)


def _next_allowed_changes(selected_posture: str) -> tuple[str, ...]:
    if selected_posture == "promote_selected_adapter":
        return (
            "open a separate product-runtime rollout phase if default behavior should change",
            "keep provider tool loop as rollback path until rollout evidence closes",
        )
    if selected_posture == "keep_experimental_lane":
        return (
            "collect live latency/cost evidence under explicit integration lane",
            "keep SDK runner default-off and selected-tool scoped",
        )
    if selected_posture == "defer_expansion":
        return (
            "close missing evidence before adding SDK tools",
            "do not expand beyond explicitly admitted provider-facing tools",
        )
    return (
        "create cleanup phase to remove or quarantine SDK adapter code",
        "retain custom provider function-call loop as the accepted denominator",
    )


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


__all__ = [
    "AGENTS_SDK_POSTURE_DECISION_SCHEMA_VERSION",
    "AGENTS_SDK_RUNTIME_POSTURES",
    "AgentsSdkPostureEvidence",
    "AgentsSdkRuntimePostureDecision",
    "decide_agents_sdk_runtime_posture",
]
