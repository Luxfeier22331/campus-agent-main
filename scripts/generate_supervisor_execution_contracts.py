from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
OPENAPI_PATH = REPO_ROOT / "docs/contracts/schemas/supervisor-execution.openapi.yaml"
TS_PATH = (
    REPO_ROOT / "apps/app-api/src/modules/integration/generated/supervisor-execution-contract.ts"
)
GO_PATH = REPO_ROOT / "apps/supervisor-api/internal/contracts/supervisor_execution_contract.go"
PY_PACKAGE_INIT_PATH = (
    REPO_ROOT
    / "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/generated/__init__.py"
)
PY_PATH = (
    REPO_ROOT / "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/generated/"
    "supervisor_execution_contract.py"
)

HEADER = "AUTO-GENERATED FROM supervisor-execution.openapi.yaml"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate cross-language supervisor execution contract artifacts."
    )
    parser.add_argument("--check", action="store_true", help="Fail if generated files differ.")
    args = parser.parse_args()

    contract = _load_contract()
    outputs = {
        TS_PATH: _generate_ts(contract),
        GO_PATH: _generate_go(contract),
        PY_PACKAGE_INIT_PATH: _generate_py_init(),
        PY_PATH: _generate_py(contract),
    }
    if args.check:
        mismatches = [
            _relative(path)
            for path, expected in outputs.items()
            if not path.exists() or path.read_text(encoding="utf-8") != expected
        ]
        if mismatches:
            raise SystemExit(
                "generated supervisor execution contracts are out of sync: " + ", ".join(mismatches)
            )
        return

    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def _load_contract() -> dict[str, Any]:
    openapi = yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))
    if not isinstance(openapi, dict):
        raise ValueError("supervisor execution OpenAPI document must be an object")
    if openapi.get("openapi") != "3.1.1":
        raise ValueError("supervisor execution OpenAPI document must use OpenAPI 3.1.1")
    if openapi.get("jsonSchemaDialect") != "https://json-schema.org/draft/2020-12/schema":
        raise ValueError("supervisor execution OpenAPI document must use JSON Schema 2020-12")
    return openapi


def _schemas(contract: dict[str, Any]) -> dict[str, Any]:
    components = contract.get("components")
    if not isinstance(components, dict):
        raise ValueError("OpenAPI components must be an object")
    schemas = components.get("schemas")
    if not isinstance(schemas, dict):
        raise ValueError("OpenAPI components.schemas must be an object")
    return schemas


def _enum(contract: dict[str, Any], name: str) -> tuple[str, ...]:
    schema = _schemas(contract).get(name)
    if not isinstance(schema, dict):
        raise ValueError(f"missing schema: {name}")
    values = schema.get("enum")
    if not isinstance(values, list) or not all(isinstance(item, str) for item in values):
        raise ValueError(f"schema {name} must define a string enum")
    return tuple(values)


def _contract_meta(contract: dict[str, Any]) -> dict[str, str]:
    meta = contract.get("x-campus-contract")
    if not isinstance(meta, dict):
        raise ValueError("x-campus-contract metadata is required")
    required = (
        "bridge_version",
        "response_contract",
        "runtime_decisions_schema_version",
        "runtime_decision_summary_schema_version",
        "workflow_trace_summary_version",
    )
    result: dict[str, str] = {}
    for key in required:
        value = meta.get(key)
        if not isinstance(value, str) or not value:
            raise ValueError(f"x-campus-contract.{key} must be a non-empty string")
        result[key] = value
    return result


def _generate_ts(contract: dict[str, Any]) -> str:
    meta = _contract_meta(contract)
    agent_targets = _enum(contract, "AgentTarget")
    requested_capabilities = _enum(contract, "RequestedCapability")
    confidence_levels = _enum(contract, "ConfidenceLevel")
    delegate_statuses = _enum(contract, "DelegateStatus")
    supervisor_statuses = _enum(contract, "SupervisorStatus")
    workflow_modes = _enum(contract, "WorkflowMode")
    return (
        f"/* {HEADER}. Do not edit by hand. */\n\n"
        "export const SUPERVISOR_EXECUTION_CONTRACT = {\n"
        f"\tbridgeVersion: {_ts_quote(meta['bridge_version'])},\n"
        f"\tresponseContract: {_ts_quote(meta['response_contract'])},\n"
        f"\truntimeDecisionsSchemaVersion: {_ts_quote(meta['runtime_decisions_schema_version'])},\n"
        f"\truntimeDecisionSummarySchemaVersion: "
        f"{_ts_quote(meta['runtime_decision_summary_schema_version'])},\n"
        f"\tworkflowTraceSummaryVersion: {_ts_quote(meta['workflow_trace_summary_version'])},\n"
        "} as const;\n\n"
        + _ts_const_array("AGENT_TARGETS", agent_targets)
        + _ts_const_array("REQUESTED_CAPABILITIES", requested_capabilities)
        + _ts_const_array("CONFIDENCE_LEVELS", confidence_levels)
        + _ts_const_array("DELEGATE_STATUSES", delegate_statuses)
        + _ts_const_array("SUPERVISOR_STATUSES", supervisor_statuses)
        + _ts_const_array("WORKFLOW_MODES", workflow_modes)
        + "\n"
        "export type AgentTarget = (typeof AGENT_TARGETS)[number];\n"
        "export type RequestedCapability = (typeof REQUESTED_CAPABILITIES)[number];\n"
        "export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];\n"
        "export type DelegateStatus = (typeof DELEGATE_STATUSES)[number];\n"
        "export type SupervisorStatus = (typeof SUPERVISOR_STATUSES)[number];\n\n"
        "export type WorkflowMode = (typeof WORKFLOW_MODES)[number];\n\n"
        "export type SafeRecord = Record<string, unknown>;\n\n"
        "export interface RuntimeDecisionSummaryWire {\n"
        "\tschema_version: typeof SUPERVISOR_EXECUTION_CONTRACT.runtimeDecisionSummarySchemaVersion;\n"
        "\tscope_gate_decision?: string;\n"
        "\tpolicy_gate_decision?: string;\n"
        "\tcontext_preflight_state?: string;\n"
        "\trouting_next_action?: string;\n"
        "\tplanning_outcome: string;\n"
        "\tselected_target?: string;\n"
        "\tselected_tool?: string;\n"
        "\tterminal_outcome?: string;\n"
        "\tfail_close_reason?: string;\n"
        "\truntime_versions?: SafeRecord;\n"
        "\tpolicy_artifact_versions?: SafeRecord;\n"
        "}\n\n"
        "export interface WorkflowPlanStepWire {\n"
        "\tstep_id: string;\n"
        "\tstep_kind: string;\n"
        "\ttarget?: string;\n"
        "\tpayload_kind?: string;\n"
        "\tallowed_tools?: string[];\n"
        "\tselected_tool?: string;\n"
        "}\n\n"
        "export interface WorkflowPlanEdgeWire {\n"
        "\tfrom_step_id: string;\n"
        "\tto_step_id: string;\n"
        "\tcondition: string;\n"
        "}\n\n"
        "export interface WorkflowPlanWire {\n"
        '\tschema_version: "workflow-plan-v1";\n'
        "\tplan_id: string;\n"
        "\tworkflow_mode: WorkflowMode;\n"
        "\tsteps: WorkflowPlanStepWire[];\n"
        "\tedges: WorkflowPlanEdgeWire[];\n"
        "\tterminal_policy: SafeRecord;\n"
        "\tresume_policy: SafeRecord;\n"
        "\tsemantic_retry_policy: SafeRecord;\n"
        "}\n\n"
        "export interface RuntimeDecisionsWire {\n"
        "\tschema_version: typeof SUPERVISOR_EXECUTION_CONTRACT.runtimeDecisionsSchemaVersion;\n"
        "\teffective_capability: RequestedCapability;\n"
        "\tlane: string;\n"
        "\trouting_frame: SafeRecord;\n"
        "\truntime_decision_summary: RuntimeDecisionSummaryWire;\n"
        "\tscope_gate?: SafeRecord;\n"
        "\tpolicy_gate?: SafeRecord;\n"
        "\tcontext_preflight?: SafeRecord;\n"
        "\ttool_policy?: SafeRecord;\n"
        "\thandoff?: SafeRecord;\n"
        "\tworkflow_plan?: WorkflowPlanWire;\n"
        "\tterminal_envelope?: SafeRecord;\n"
        "\t[key: string]: unknown;\n"
        "}\n\n"
        "export interface AgentResponseWire {\n"
        "\ttarget: AgentTarget;\n"
        "\tstatus: DelegateStatus;\n"
        "\tanswer_text?: string;\n"
        "\tfollow_up_question?: string;\n"
        "\tconfidence?: ConfidenceLevel;\n"
        "\tresult?: SafeRecord | null;\n"
        "\terror?: { code: string; message: string; retryable?: boolean } | null;\n"
        "\tagent_observability?: SafeRecord | null;\n"
        "}\n\n"
        "export interface BridgeV6RequestWire {\n"
        "\tbridge_version: typeof SUPERVISOR_EXECUTION_CONTRACT.bridgeVersion;\n"
        "\tresponse_contract: typeof SUPERVISOR_EXECUTION_CONTRACT.responseContract;\n"
        "\tuser_goal: string;\n"
        "\tconversation_id?: string;\n"
        "\trequest_id: string;\n"
        "\tsafety_identifier?: string | null;\n"
        "\teffective_capability: RequestedCapability;\n"
        "\tlane: string;\n"
        "\trequested_capability: RequestedCapability;\n"
        "\trequested_scope?: { corpus: string; collection: string } | null;\n"
        "\ttrace: { trace_id: string };\n"
        "\tactor: SafeRecord;\n"
        "\tcontext: SafeRecord;\n"
        "\tversion_query: SafeRecord;\n"
        "\truntime_decisions: RuntimeDecisionsWire;\n"
        "}\n\n"
        "export interface SupervisorExecutionWorkflowTraceSummaryWire {\n"
        "\trouting_frame: SafeRecord;\n"
        "\tcontext_resolution: SafeRecord;\n"
        "\tplanning_outcome: string;\n"
        "\tdirect_vs_delegate_branch: string;\n"
        "\tworkflow_mode: WorkflowMode;\n"
        "\thandoff: SafeRecord;\n"
        "\thandoff_chain: SafeRecord[];\n"
        "\tselected_target: AgentTarget | string | null;\n"
        "\tselected_tools: string[];\n"
        "\ttool_argument_summary: SafeRecord;\n"
        "\ttrace_steps?: SafeRecord[];\n"
        "\ttool_call_summaries?: SafeRecord[];\n"
        "\tguardrail_outcomes: SafeRecord;\n"
        "\tfail_close_reason: string;\n"
        "\truntime_versions: SafeRecord;\n"
        "\tpolicy_artifact_versions: SafeRecord;\n"
        "}\n\n"
        "export interface SupervisorExecutionResponseWire {\n"
        "\tselected_target: AgentTarget | null;\n"
        "\tstatus: SupervisorStatus;\n"
        "\tanswer_text: string;\n"
        "\tfollow_up_question: string;\n"
        "\tconfidence: ConfidenceLevel;\n"
        "\tresult: SafeRecord | null;\n"
        "\terror: { code: string; message: string; retryable?: boolean } | null;\n"
        "\tobservability?: SafeRecord | null;\n"
        "\tworkflow_trace_summary?: SupervisorExecutionWorkflowTraceSummaryWire | null;\n"
        "\ttrace_id: string;\n"
        "}\n"
    )


def _generate_go(contract: dict[str, Any]) -> str:
    meta = _contract_meta(contract)
    agent_targets = _enum(contract, "AgentTarget")
    requested_capabilities = _enum(contract, "RequestedCapability")
    confidence_levels = _enum(contract, "ConfidenceLevel")
    delegate_statuses = _enum(contract, "DelegateStatus")
    supervisor_statuses = _enum(contract, "SupervisorStatus")
    workflow_modes = _enum(contract, "WorkflowMode")
    return _gofmt(
        f"// {HEADER}. Do not edit by hand.\n\n"
        "package contracts\n\n"
        "import (\n"
        '\t"bytes"\n'
        '\t"encoding/json"\n'
        '\t"fmt"\n'
        '\t"io"\n'
        ")\n\n"
        "const (\n"
        f"\tBridgeVersion = {_go_quote(meta['bridge_version'])}\n"
        f"\tResponseContract = {_go_quote(meta['response_contract'])}\n"
        f"\tRuntimeDecisionsSchemaVersion = "
        f"{_go_quote(meta['runtime_decisions_schema_version'])}\n"
        f"\tRuntimeDecisionSummarySchemaVersion = "
        f"{_go_quote(meta['runtime_decision_summary_schema_version'])}\n"
        f"\tWorkflowTraceSummaryVersion = {_go_quote(meta['workflow_trace_summary_version'])}\n"
        ")\n\n"
        + _go_string_type("AgentTarget", agent_targets)
        + _go_string_type("RequestedCapability", requested_capabilities)
        + _go_string_type("ConfidenceLevel", confidence_levels)
        + _go_string_type("DelegateStatus", delegate_statuses)
        + _go_string_type("SupervisorStatus", supervisor_statuses)
        + _go_string_type("WorkflowMode", workflow_modes)
        + """
type RuntimeDecisionSummaryWire struct {
\tSchemaVersion string `json:"schema_version"`
\tScopeGateDecision string `json:"scope_gate_decision,omitempty"`
\tPolicyGateDecision string `json:"policy_gate_decision,omitempty"`
\tContextPreflightState string `json:"context_preflight_state,omitempty"`
\tRoutingNextAction string `json:"routing_next_action,omitempty"`
\tPlanningOutcome string `json:"planning_outcome"`
\tSelectedTarget string `json:"selected_target,omitempty"`
\tSelectedTool string `json:"selected_tool,omitempty"`
\tTerminalOutcome string `json:"terminal_outcome,omitempty"`
\tFailCloseReason string `json:"fail_close_reason,omitempty"`
\tRuntimeVersions map[string]any `json:"runtime_versions,omitempty"`
\tPolicyArtifactVersions map[string]any `json:"policy_artifact_versions,omitempty"`
}

type WorkflowPlanStepWire struct {
\tStepID string `json:"step_id"`
\tStepKind string `json:"step_kind"`
\tTarget string `json:"target,omitempty"`
\tPayloadKind string `json:"payload_kind,omitempty"`
\tAllowedTools []string `json:"allowed_tools,omitempty"`
\tSelectedTool string `json:"selected_tool,omitempty"`
}

type WorkflowPlanEdgeWire struct {
\tFromStepID string `json:"from_step_id"`
\tToStepID string `json:"to_step_id"`
\tCondition string `json:"condition"`
}

type WorkflowPlanWire struct {
\tSchemaVersion string `json:"schema_version"`
\tPlanID string `json:"plan_id"`
\tWorkflowMode WorkflowMode `json:"workflow_mode"`
\tSteps []WorkflowPlanStepWire `json:"steps"`
\tEdges []WorkflowPlanEdgeWire `json:"edges"`
\tTerminalPolicy map[string]any `json:"terminal_policy"`
\tResumePolicy map[string]any `json:"resume_policy"`
\tSemanticRetryPolicy map[string]any `json:"semantic_retry_policy"`
}

type RuntimeDecisionsWire struct {
\tSchemaVersion string `json:"schema_version"`
\tEffectiveCapability RequestedCapability `json:"effective_capability"`
\tLane string `json:"lane"`
\tRoutingFrame map[string]any `json:"routing_frame"`
\tRuntimeDecisionSummary RuntimeDecisionSummaryWire `json:"runtime_decision_summary"`
\tScopeGate map[string]any `json:"scope_gate,omitempty"`
\tPolicyGate map[string]any `json:"policy_gate,omitempty"`
\tContextPreflight map[string]any `json:"context_preflight,omitempty"`
\tToolPolicy map[string]any `json:"tool_policy,omitempty"`
\tHandoff map[string]any `json:"handoff,omitempty"`
\tWorkflowPlan *WorkflowPlanWire `json:"workflow_plan,omitempty"`
\tTerminalEnvelope map[string]any `json:"terminal_envelope,omitempty"`
}

type BridgeV6RequestWire struct {
\tBridgeVersion string `json:"bridge_version"`
\tResponseContract string `json:"response_contract"`
\tUserGoal string `json:"user_goal"`
\tConversationID string `json:"conversation_id,omitempty"`
\tRequestID string `json:"request_id"`
\tSafetyIdentifier *string `json:"safety_identifier,omitempty"`
\tEffectiveCapability RequestedCapability `json:"effective_capability"`
\tLane string `json:"lane"`
\tRequestedCapability RequestedCapability `json:"requested_capability"`
\tRequestedScope map[string]any `json:"requested_scope,omitempty"`
\tTrace map[string]any `json:"trace"`
\tActor map[string]any `json:"actor"`
\tContext map[string]any `json:"context"`
\tVersionQuery map[string]any `json:"version_query"`
\tRuntimeDecisions RuntimeDecisionsWire `json:"runtime_decisions"`
}

type WorkflowTraceSummaryWire struct {
\tRoutingFrame map[string]any `json:"routing_frame"`
\tContextResolution map[string]any `json:"context_resolution"`
\tPlanningOutcome string `json:"planning_outcome"`
\tDirectVsDelegateBranch string `json:"direct_vs_delegate_branch"`
\tWorkflowMode WorkflowMode `json:"workflow_mode"`
\tHandoff map[string]any `json:"handoff"`
\tHandoffChain []map[string]any `json:"handoff_chain"`
\tSelectedTarget *string `json:"selected_target"`
\tSelectedTools []string `json:"selected_tools"`
\tToolArgumentSummary map[string]any `json:"tool_argument_summary"`
\tTraceSteps []map[string]any `json:"trace_steps,omitempty"`
\tToolCallSummaries []map[string]any `json:"tool_call_summaries,omitempty"`
\tGuardrailOutcomes map[string]any `json:"guardrail_outcomes"`
\tFailCloseReason string `json:"fail_close_reason"`
\tRuntimeVersions map[string]any `json:"runtime_versions"`
\tPolicyArtifactVersions map[string]any `json:"policy_artifact_versions"`
}

type SupervisorResponseWire struct {
\tSelectedTarget *AgentTarget `json:"selected_target"`
\tStatus SupervisorStatus `json:"status"`
\tAnswerText string `json:"answer_text"`
\tFollowUpQuestion string `json:"follow_up_question"`
\tConfidence ConfidenceLevel `json:"confidence"`
\tResult map[string]any `json:"result"`
\tError map[string]any `json:"error"`
\tObservability map[string]any `json:"observability,omitempty"`
\tWorkflowTraceSummary *WorkflowTraceSummaryWire `json:"workflow_trace_summary,omitempty"`
\tTraceID string `json:"trace_id"`
}
"""
        + _go_decode_helpers()
    )


def _go_decode_helpers() -> str:
    return """
func DecodeBridgeV6RequestWireJSON(data []byte) (BridgeV6RequestWire, error) {
\tvar wire BridgeV6RequestWire
\tif err := decodeStrictJSON(data, &wire); err != nil {
\t\treturn wire, err
\t}
\tif err := wire.Validate(); err != nil {
\t\treturn wire, err
\t}
\treturn wire, nil
}

func DecodeSupervisorResponseWireJSON(data []byte) (SupervisorResponseWire, error) {
\tvar wire SupervisorResponseWire
\tif err := decodeStrictJSON(data, &wire); err != nil {
\t\treturn wire, err
\t}
\tif err := wire.Validate(); err != nil {
\t\treturn wire, err
\t}
\treturn wire, nil
}

func decodeStrictJSON(data []byte, target any) error {
\tdecoder := json.NewDecoder(bytes.NewReader(data))
\tdecoder.DisallowUnknownFields()
\tif err := decoder.Decode(target); err != nil {
\t\treturn err
\t}
\tvar trailing any
\tif err := decoder.Decode(&trailing); err != io.EOF {
\t\treturn fmt.Errorf("unexpected trailing JSON content")
\t}
\treturn nil
}

func (wire BridgeV6RequestWire) Validate() error {
\tif wire.BridgeVersion != BridgeVersion {
\t\treturn fmt.Errorf("bridge_version must be %s", BridgeVersion)
\t}
\tif wire.ResponseContract != ResponseContract {
\t\treturn fmt.Errorf("response_contract must be %s", ResponseContract)
\t}
\tif wire.UserGoal == "" {
\t\treturn fmt.Errorf("user_goal is required")
\t}
\tif wire.RequestID == "" {
\t\treturn fmt.Errorf("request_id is required")
\t}
\tif !wire.EffectiveCapability.Valid() {
\t\treturn fmt.Errorf("effective_capability is invalid")
\t}
\tif !wire.RequestedCapability.Valid() {
\t\treturn fmt.Errorf("requested_capability is invalid")
\t}
\tif wire.Lane == "" {
\t\treturn fmt.Errorf("lane is required")
\t}
\tif len(wire.Trace) == 0 {
\t\treturn fmt.Errorf("trace is required")
\t}
\tif wire.Actor == nil {
\t\treturn fmt.Errorf("actor is required")
\t}
\tif wire.Context == nil {
\t\treturn fmt.Errorf("context is required")
\t}
\tif wire.VersionQuery == nil {
\t\treturn fmt.Errorf("version_query is required")
\t}
\tif err := wire.RuntimeDecisions.Validate(); err != nil {
\t\treturn fmt.Errorf("runtime_decisions: %w", err)
\t}
\treturn nil
}

func (wire RuntimeDecisionsWire) Validate() error {
\tif wire.SchemaVersion != RuntimeDecisionsSchemaVersion {
\t\treturn fmt.Errorf("schema_version must be %s", RuntimeDecisionsSchemaVersion)
\t}
\tif !wire.EffectiveCapability.Valid() {
\t\treturn fmt.Errorf("effective_capability is invalid")
\t}
\tif wire.Lane == "" {
\t\treturn fmt.Errorf("lane is required")
\t}
\tif wire.RoutingFrame == nil {
\t\treturn fmt.Errorf("routing_frame is required")
\t}
\tif err := wire.RuntimeDecisionSummary.Validate(); err != nil {
\t\treturn fmt.Errorf("runtime_decision_summary: %w", err)
\t}
\tif wire.WorkflowPlan != nil {
\t\tif err := wire.WorkflowPlan.Validate(); err != nil {
\t\t\treturn fmt.Errorf("workflow_plan: %w", err)
\t\t}
\t}
\treturn nil
}

func (wire RuntimeDecisionSummaryWire) Validate() error {
\tif wire.SchemaVersion != RuntimeDecisionSummarySchemaVersion {
\t\treturn fmt.Errorf("schema_version must be %s", RuntimeDecisionSummarySchemaVersion)
\t}
\tif wire.PlanningOutcome == "" {
\t\treturn fmt.Errorf("planning_outcome is required")
\t}
\treturn nil
}

func (wire WorkflowPlanWire) Validate() error {
\tif wire.SchemaVersion != "workflow-plan-v1" {
\t\treturn fmt.Errorf("schema_version must be workflow-plan-v1")
\t}
\tif wire.PlanID == "" {
\t\treturn fmt.Errorf("plan_id is required")
\t}
\tif !wire.WorkflowMode.Valid() {
\t\treturn fmt.Errorf("workflow_mode is invalid")
\t}
\tif wire.Steps == nil {
\t\treturn fmt.Errorf("steps is required")
\t}
\tif wire.Edges == nil {
\t\treturn fmt.Errorf("edges is required")
\t}
\tif wire.TerminalPolicy == nil {
\t\treturn fmt.Errorf("terminal_policy is required")
\t}
\tif wire.ResumePolicy == nil {
\t\treturn fmt.Errorf("resume_policy is required")
\t}
\tif wire.SemanticRetryPolicy == nil {
\t\treturn fmt.Errorf("semantic_retry_policy is required")
\t}
\tfor index, step := range wire.Steps {
\t\tif step.StepID == "" {
\t\t\treturn fmt.Errorf("steps[%d].step_id is required", index)
\t\t}
\t\tif step.StepKind == "" {
\t\t\treturn fmt.Errorf("steps[%d].step_kind is required", index)
\t\t}
\t}
\tfor index, edge := range wire.Edges {
\t\tif edge.FromStepID == "" {
\t\t\treturn fmt.Errorf("edges[%d].from_step_id is required", index)
\t\t}
\t\tif edge.ToStepID == "" {
\t\t\treturn fmt.Errorf("edges[%d].to_step_id is required", index)
\t\t}
\t\tif edge.Condition == "" {
\t\t\treturn fmt.Errorf("edges[%d].condition is required", index)
\t\t}
\t}
\treturn nil
}

func (wire WorkflowTraceSummaryWire) Validate() error {
\tif wire.RoutingFrame == nil {
\t\treturn fmt.Errorf("routing_frame is required")
\t}
\tif wire.ContextResolution == nil {
\t\treturn fmt.Errorf("context_resolution is required")
\t}
\tif wire.PlanningOutcome == "" {
\t\treturn fmt.Errorf("planning_outcome is required")
\t}
\tif wire.DirectVsDelegateBranch == "" {
\t\treturn fmt.Errorf("direct_vs_delegate_branch is required")
\t}
\tif wire.WorkflowMode == "" {
\t\treturn fmt.Errorf("workflow_mode is required")
\t}
\tif !wire.WorkflowMode.Valid() {
\t\treturn fmt.Errorf("workflow_mode is invalid")
\t}
\tif wire.Handoff == nil {
\t\treturn fmt.Errorf("handoff is required")
\t}
\tif wire.HandoffChain == nil {
\t\treturn fmt.Errorf("handoff_chain is required")
\t}
\tif wire.SelectedTarget == nil || *wire.SelectedTarget == "" {
\t\treturn fmt.Errorf("selected_target is required")
\t}
\tif wire.SelectedTools == nil {
\t\treturn fmt.Errorf("selected_tools is required")
\t}
\tif wire.ToolArgumentSummary == nil {
\t\treturn fmt.Errorf("tool_argument_summary is required")
\t}
\tif wire.GuardrailOutcomes == nil {
\t\treturn fmt.Errorf("guardrail_outcomes is required")
\t}
\tif wire.RuntimeVersions == nil {
\t\treturn fmt.Errorf("runtime_versions is required")
\t}
\tif wire.PolicyArtifactVersions == nil {
\t\treturn fmt.Errorf("policy_artifact_versions is required")
\t}
\treturn nil
}

func (wire SupervisorResponseWire) Validate() error {
\tif wire.SelectedTarget != nil && !wire.SelectedTarget.Valid() {
\t\treturn fmt.Errorf("selected_target is invalid")
\t}
\tif !wire.Status.Valid() {
\t\treturn fmt.Errorf("status is invalid")
\t}
\tif !wire.Confidence.Valid() {
\t\treturn fmt.Errorf("confidence is invalid")
\t}
\tif wire.TraceID == "" {
\t\treturn fmt.Errorf("trace_id is required")
\t}
\tif wire.Error != nil {
\t\tif _, ok := wire.Error["code"].(string); !ok {
\t\t\treturn fmt.Errorf("error.code is required")
\t\t}
\t\tif _, ok := wire.Error["message"].(string); !ok {
\t\t\treturn fmt.Errorf("error.message is required")
\t\t}
\t}
\tif wire.WorkflowTraceSummary != nil {
\t\tif err := wire.WorkflowTraceSummary.Validate(); err != nil {
\t\t\treturn fmt.Errorf("workflow_trace_summary: %w", err)
\t\t}
\t}
\treturn nil
}

func (value AgentTarget) Valid() bool {
\tswitch value {
\tcase AgentTargetRagAgent, AgentTargetNavigationAgent, AgentTargetCampusServicesAgent, AgentTargetNoticeAgent:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value RequestedCapability) Valid() bool {
\tswitch value {
\tcase RequestedCapabilityKnowledge, RequestedCapabilityPlaceLookup, RequestedCapabilityCampusServices, RequestedCapabilityNotice:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value ConfidenceLevel) Valid() bool {
\tswitch value {
\tcase ConfidenceLevelHigh, ConfidenceLevelMedium, ConfidenceLevelLow:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value DelegateStatus) Valid() bool {
\tswitch value {
\tcase DelegateStatusCompleted, DelegateStatusNeedsClarification, DelegateStatusNoAnswer, DelegateStatusError:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value SupervisorStatus) Valid() bool {
\tswitch value {
\tcase SupervisorStatusCompleted, SupervisorStatusNeedsClarification, SupervisorStatusNoAnswer, SupervisorStatusError, SupervisorStatusRejected, SupervisorStatusApprovalRequired, SupervisorStatusCancelled:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value WorkflowMode) Valid() bool {
\tswitch value {
\tcase WorkflowModeTerminal, WorkflowModeDirectRuntime, WorkflowModeSingleHandoff, WorkflowModeMultiStep:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}
"""


def _generate_py_init() -> str:
    return '"""Generated supervisor execution contract package."""\n'


def _generate_py(contract: dict[str, Any]) -> str:
    meta = _contract_meta(contract)
    agent_targets = _enum(contract, "AgentTarget")
    requested_capabilities = _enum(contract, "RequestedCapability")
    confidence_levels = _enum(contract, "ConfidenceLevel")
    delegate_statuses = _enum(contract, "DelegateStatus")
    supervisor_statuses = _enum(contract, "SupervisorStatus")
    workflow_modes = _enum(contract, "WorkflowMode")
    return (
        f"# {HEADER}. Do not edit by hand.\n\n"
        "from __future__ import annotations\n\n"
        "from typing import Any, Literal\n\n"
        "from pydantic import BaseModel, ConfigDict, Field\n\n"
        f"BRIDGE_VERSION = {_py_quote(meta['bridge_version'])}\n"
        f"RESPONSE_CONTRACT = {_py_quote(meta['response_contract'])}\n"
        f"RUNTIME_DECISIONS_SCHEMA_VERSION = {_py_quote(meta['runtime_decisions_schema_version'])}\n"
        f"RUNTIME_DECISION_SUMMARY_SCHEMA_VERSION = "
        f"{_py_quote(meta['runtime_decision_summary_schema_version'])}\n"
        f"WORKFLOW_TRACE_SUMMARY_VERSION = {_py_quote(meta['workflow_trace_summary_version'])}\n\n"
        f"AgentTarget = {_py_literal(agent_targets)}\n"
        f"RequestedCapability = {_py_literal(requested_capabilities)}\n"
        f"ConfidenceLevel = {_py_literal(confidence_levels)}\n"
        f"DelegateStatus = {_py_literal(delegate_statuses)}\n"
        f"SupervisorStatus = {_py_literal(supervisor_statuses)}\n\n\n"
        f"WorkflowMode = {_py_literal(workflow_modes)}\n\n\n"
        "class RuntimeDecisionSummaryWire(BaseModel):\n"
        '    model_config = ConfigDict(extra="forbid")\n\n'
        "    schema_version: Literal[RUNTIME_DECISION_SUMMARY_SCHEMA_VERSION]\n"
        "    planning_outcome: str\n"
        '    scope_gate_decision: str = ""\n'
        '    policy_gate_decision: str = ""\n'
        '    context_preflight_state: str = ""\n'
        '    routing_next_action: str = ""\n'
        '    selected_target: str = ""\n'
        '    selected_tool: str = ""\n'
        '    terminal_outcome: str = ""\n'
        '    fail_close_reason: str = ""\n'
        "    runtime_versions: dict[str, Any] = Field(default_factory=dict)\n"
        "    policy_artifact_versions: dict[str, Any] = Field(default_factory=dict)\n\n\n"
        "class WorkflowPlanStepWire(BaseModel):\n"
        '    model_config = ConfigDict(extra="forbid")\n\n'
        "    step_id: str\n"
        "    step_kind: str\n"
        '    target: str = ""\n'
        '    payload_kind: str = ""\n'
        "    allowed_tools: list[str] = Field(default_factory=list)\n"
        '    selected_tool: str = ""\n\n\n'
        "class WorkflowPlanEdgeWire(BaseModel):\n"
        '    model_config = ConfigDict(extra="forbid")\n\n'
        "    from_step_id: str\n"
        "    to_step_id: str\n"
        "    condition: str\n\n\n"
        "class WorkflowPlanWire(BaseModel):\n"
        '    model_config = ConfigDict(extra="forbid")\n\n'
        '    schema_version: Literal["workflow-plan-v1"]\n'
        "    plan_id: str\n"
        "    workflow_mode: WorkflowMode\n"
        "    steps: list[WorkflowPlanStepWire]\n"
        "    edges: list[WorkflowPlanEdgeWire]\n"
        "    terminal_policy: dict[str, Any]\n"
        "    resume_policy: dict[str, Any]\n"
        "    semantic_retry_policy: dict[str, Any]\n\n\n"
        "class RuntimeDecisionsWire(BaseModel):\n"
        '    model_config = ConfigDict(extra="allow")\n\n'
        "    schema_version: Literal[RUNTIME_DECISIONS_SCHEMA_VERSION]\n"
        "    effective_capability: RequestedCapability\n"
        "    lane: str\n"
        "    routing_frame: dict[str, Any]\n"
        "    runtime_decision_summary: RuntimeDecisionSummaryWire\n"
        "    scope_gate: dict[str, Any] = Field(default_factory=dict)\n"
        "    policy_gate: dict[str, Any] = Field(default_factory=dict)\n"
        "    context_preflight: dict[str, Any] = Field(default_factory=dict)\n"
        "    tool_policy: dict[str, Any] = Field(default_factory=dict)\n"
        "    handoff: dict[str, Any] | None = None\n"
        "    workflow_plan: WorkflowPlanWire | None = None\n"
        "    terminal_envelope: dict[str, Any] | None = None\n\n\n"
        "class BridgeV6RequestWire(BaseModel):\n"
        '    model_config = ConfigDict(extra="forbid")\n\n'
        "    bridge_version: Literal[BRIDGE_VERSION]\n"
        "    response_contract: Literal[RESPONSE_CONTRACT]\n"
        "    user_goal: str\n"
        "    request_id: str\n"
        "    effective_capability: RequestedCapability\n"
        "    lane: str\n"
        "    requested_capability: RequestedCapability\n"
        "    trace: dict[str, Any]\n"
        "    actor: dict[str, Any]\n"
        "    context: dict[str, Any]\n"
        "    version_query: dict[str, Any]\n"
        "    runtime_decisions: RuntimeDecisionsWire\n"
        '    conversation_id: str = ""\n'
        "    safety_identifier: str | None = None\n"
        "    requested_scope: dict[str, Any] | None = None\n\n\n"
        "class AgentResponseWire(BaseModel):\n"
        '    model_config = ConfigDict(extra="forbid")\n\n'
        "    target: AgentTarget\n"
        "    status: DelegateStatus\n"
        '    answer_text: str = ""\n'
        '    follow_up_question: str = ""\n'
        '    confidence: ConfidenceLevel = "low"\n'
        "    result: dict[str, Any] | None = None\n"
        "    error: dict[str, Any] | None = None\n"
        "    agent_observability: dict[str, Any] | None = None\n\n\n"
        "class WorkflowTraceSummaryWire(BaseModel):\n"
        '    model_config = ConfigDict(extra="forbid")\n\n'
        "    routing_frame: dict[str, Any]\n"
        "    context_resolution: dict[str, Any]\n"
        "    planning_outcome: str\n"
        "    direct_vs_delegate_branch: str\n"
        "    workflow_mode: WorkflowMode\n"
        "    handoff: dict[str, Any]\n"
        "    handoff_chain: list[dict[str, Any]]\n"
        "    selected_target: str | None\n"
        "    selected_tools: list[str]\n"
        "    tool_argument_summary: dict[str, Any]\n"
        "    guardrail_outcomes: dict[str, Any]\n"
        "    fail_close_reason: str\n"
        "    runtime_versions: dict[str, Any]\n"
        "    policy_artifact_versions: dict[str, Any]\n"
        "    trace_steps: list[dict[str, Any]] = Field(default_factory=list)\n"
        "    tool_call_summaries: list[dict[str, Any]] = Field(default_factory=list)\n\n\n"
        "class SupervisorResponseWire(BaseModel):\n"
        '    model_config = ConfigDict(extra="forbid")\n\n'
        "    selected_target: AgentTarget | None\n"
        "    status: SupervisorStatus\n"
        "    answer_text: str\n"
        "    follow_up_question: str\n"
        "    confidence: ConfidenceLevel\n"
        "    result: dict[str, Any] | None\n"
        "    error: dict[str, Any] | None\n"
        "    trace_id: str\n"
        "    observability: dict[str, Any] | None = None\n"
        "    workflow_trace_summary: WorkflowTraceSummaryWire | None = None\n"
    )


def _ts_const_array(name: str, values: tuple[str, ...]) -> str:
    inline_array = "[" + ", ".join(_ts_quote(value) for value in values) + "]"
    inline_line = f"export const {name} = {inline_array} as const;"
    if len(values) <= 3 and len(inline_line) <= 100:
        return inline_line + "\n"
    rendered_values = "".join(f"\t{_ts_quote(value)},\n" for value in values)
    return f"export const {name} = [\n{rendered_values}] as const;\n"


def _go_string_type(name: str, values: tuple[str, ...]) -> str:
    constants = "".join(
        f"\t{name}{_go_const_suffix(value)} {name} = {_go_quote(value)}\n" for value in values
    )
    return f"type {name} string\n\nconst (\n{constants})\n\n"


def _go_const_suffix(value: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in value.replace("_", "-").split("-"))


def _ts_quote(value: str) -> str:
    return json.dumps(value)


def _go_quote(value: str) -> str:
    return json.dumps(value)


def _py_quote(value: str) -> str:
    return json.dumps(value)


def _py_literal(values: tuple[str, ...]) -> str:
    rendered = ",\n    ".join(_py_quote(value) for value in values)
    return "Literal[\n    " + rendered + ",\n]"


def _gofmt(source: str) -> str:
    completed = subprocess.run(
        ["gofmt"],
        input=source,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise ValueError("gofmt failed: " + completed.stderr)
    return completed.stdout


def _relative(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))


if __name__ == "__main__":
    main()
