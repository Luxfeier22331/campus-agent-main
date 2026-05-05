from __future__ import annotations

from dataclasses import dataclass

from campus_evals.agents_sdk_pilot_parity import (
    AgentsSdkPilotParityObservation,
    AgentsSdkPilotParityReport,
)

AGENTS_SDK_PROMOTION_GATE_SCHEMA_VERSION = "agents-sdk-promotion-gate-v1"
AGENTS_SDK_CAMPUS_SERVICES_ADOPTION_MATRIX = {
    "service_status_lookup": "direct_runtime_preferred",
    "transport_schedule_lookup": "direct_runtime_preferred",
    "service_guide_lookup": "sdk_adapter_admitted",
    "contact_directory_lookup": "sdk_adapter_admitted",
}


@dataclass(frozen=True, slots=True)
class AgentsSdkPromotionGateEvidence:
    target: str
    tool: str
    sdk_observation: AgentsSdkPilotParityObservation
    direct_observation: AgentsSdkPilotParityObservation
    parity_report: AgentsSdkPilotParityReport
    boundary_checks_passed: bool
    redaction_checks_passed: bool
    rollback_path_documented: bool
    live_latency_cost_evidence_present: bool = False


@dataclass(frozen=True, slots=True)
class AgentsSdkPromotionGateResult:
    schema_version: str
    target: str
    tool: str
    adapter_admitted: bool
    default_on_allowed: bool
    decision: str
    blockers: tuple[str, ...]
    adoption_matrix: dict[str, str]


def evaluate_agents_sdk_promotion_gate(
    evidence: AgentsSdkPromotionGateEvidence,
) -> AgentsSdkPromotionGateResult:
    blockers: list[str] = []
    if evidence.target != "notice-agent" or evidence.tool != "campus_notice_discover":
        blockers.append("unsupported_target_tool")
    if not evidence.parity_report.passed:
        blockers.append("parity_failed")
    if evidence.sdk_observation.status != evidence.direct_observation.status:
        blockers.append("status_parity_failed")
    if evidence.sdk_observation.selected_tool != "campus_notice_discover":
        blockers.append("sdk_selected_tool_mismatch")
    if evidence.sdk_observation.tool_execution_count != 1:
        blockers.append("sdk_tool_execution_missing")
    if evidence.sdk_observation.source_ref_count <= 0:
        blockers.append("sdk_source_ref_missing")
    if not evidence.boundary_checks_passed:
        blockers.append("boundary_checks_failed")
    if not evidence.redaction_checks_passed:
        blockers.append("redaction_checks_failed")
    if not evidence.rollback_path_documented:
        blockers.append("rollback_path_missing")

    adapter_admitted = not blockers
    default_on_blockers = list(blockers)
    if not evidence.live_latency_cost_evidence_present:
        default_on_blockers.append("live_latency_cost_evidence_missing")

    return AgentsSdkPromotionGateResult(
        schema_version=AGENTS_SDK_PROMOTION_GATE_SCHEMA_VERSION,
        target=evidence.target,
        tool=evidence.tool,
        adapter_admitted=adapter_admitted,
        default_on_allowed=not default_on_blockers,
        decision="keep_explicit_runtime_gate" if adapter_admitted else "keep_closed",
        blockers=tuple(default_on_blockers),
        adoption_matrix=dict(AGENTS_SDK_CAMPUS_SERVICES_ADOPTION_MATRIX),
    )


__all__ = [
    "AGENTS_SDK_CAMPUS_SERVICES_ADOPTION_MATRIX",
    "AGENTS_SDK_PROMOTION_GATE_SCHEMA_VERSION",
    "AgentsSdkPromotionGateEvidence",
    "AgentsSdkPromotionGateResult",
    "evaluate_agents_sdk_promotion_gate",
]
