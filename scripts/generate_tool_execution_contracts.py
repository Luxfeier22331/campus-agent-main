from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

import yaml

from scripts.tool_execution_go_decode_helpers import go_decode_helpers

REPO_ROOT = Path(__file__).resolve().parents[1]
OPENAPI_PATH = REPO_ROOT / "docs/contracts/schemas/tool-execution.openapi.yaml"
TS_PATH = REPO_ROOT / "apps/app-api/src/modules/integration/generated/tool-execution-contract.ts"
GO_PATH = REPO_ROOT / "apps/execution-control/internal/contracts/tool_execution_contract.go"

HEADER = "AUTO-GENERATED FROM tool-execution.openapi.yaml"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate cross-language tool execution contract artifacts."
    )
    parser.add_argument("--check", action="store_true", help="Fail if generated files differ.")
    args = parser.parse_args()

    contract = _load_contract()
    outputs = {
        TS_PATH: _generate_ts(contract),
        GO_PATH: _generate_go(contract),
    }
    if args.check:
        mismatches = [
            _relative(path)
            for path, expected in outputs.items()
            if not path.exists() or path.read_text(encoding="utf-8") != expected
        ]
        if mismatches:
            raise SystemExit(
                "generated tool execution contracts are out of sync: " + ", ".join(mismatches)
            )
        return

    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def _load_contract() -> dict[str, Any]:
    openapi = yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))
    if not isinstance(openapi, dict):
        raise ValueError("tool execution OpenAPI document must be an object")
    if openapi.get("openapi") != "3.1.1":
        raise ValueError("tool execution OpenAPI document must use OpenAPI 3.1.1")
    if openapi.get("jsonSchemaDialect") != "https://json-schema.org/draft/2020-12/schema":
        raise ValueError("tool execution OpenAPI document must use JSON Schema 2020-12")
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
        "execution_contract_version",
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
    tool_ids = _enum(contract, "ToolID")
    model_visible_tool_names = _enum(contract, "ModelVisibleToolName")
    requested_tools = _enum(contract, "RequestedTool")
    confidence_levels = _enum(contract, "ConfidenceLevel")
    delegate_statuses = _enum(contract, "DelegateStatus")
    execution_statuses = _enum(contract, "ExecutionStatus")
    workflow_modes = _enum(contract, "WorkflowMode")
    projection_kinds = _enum(contract, "StepOutputProjectionKind")
    return (
        f"/* {HEADER}. Do not edit by hand. */\n\n"
        "export const TOOL_EXECUTION_CONTRACT = {\n"
        f"\texecutionContractVersion: {_ts_quote(meta['execution_contract_version'])},\n"
        f"\tresponseContract: {_ts_quote(meta['response_contract'])},\n"
        f"\truntimeDecisionsSchemaVersion: {_ts_quote(meta['runtime_decisions_schema_version'])},\n"
        f"\truntimeDecisionSummarySchemaVersion: "
        f"{_ts_quote(meta['runtime_decision_summary_schema_version'])},\n"
        f"\tworkflowTraceSummaryVersion: {_ts_quote(meta['workflow_trace_summary_version'])},\n"
        "} as const;\n\n"
        + _ts_const_array("TOOL_IDS", tool_ids)
        + _ts_const_array("MODEL_VISIBLE_TOOL_NAMES", model_visible_tool_names)
        + _ts_const_array("REQUESTED_TOOLS", requested_tools)
        + _ts_const_array("CONFIDENCE_LEVELS", confidence_levels)
        + _ts_const_array("DELEGATE_STATUSES", delegate_statuses)
        + _ts_const_array("EXECUTION_STATUSES", execution_statuses)
        + _ts_const_array("WORKFLOW_MODES", workflow_modes)
        + _ts_const_array("STEP_OUTPUT_PROJECTION_KINDS", projection_kinds)
        + "\n"
        "export type ToolID = (typeof TOOL_IDS)[number];\n"
        "export type ModelVisibleToolName = (typeof MODEL_VISIBLE_TOOL_NAMES)[number];\n"
        "export type RequestedTool = (typeof REQUESTED_TOOLS)[number];\n"
        "export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];\n"
        "export type DelegateStatus = (typeof DELEGATE_STATUSES)[number];\n"
        "export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];\n\n"
        "export type WorkflowMode = (typeof WORKFLOW_MODES)[number];\n"
        "export type StepOutputProjectionKind = (typeof STEP_OUTPUT_PROJECTION_KINDS)[number];\n\n"
        "export type SafeRecord = Record<string, unknown>;\n\n"
        "export interface ConversationContextWire {\n"
        '\tschema_version: "conversation_context.v1";\n'
        "\tconversation_id: string;\n"
        "\tuser_message_id: string;\n"
        "\tparent_message_id?: string | null;\n"
        '\tcurrent_user_message: { role: "user"; content: string; created_at: string };\n'
        "\trecent_turns: SafeRecord[];\n"
        "\tprevious_answer_summary?: string | null;\n"
        "\tprevious_evidence_refs: SafeRecord[];\n"
        "\tprevious_tool_results: SafeRecord[];\n"
        "\tsession_state: SafeRecord;\n"
        "\tvisibility: { model_visible: string[]; runtime_only: string[] };\n"
        "\tmemory_recall: {\n"
        '\t\tgate_field: "context.memory.enabled";\n'
        '\t\towner: "execution-control";\n'
        '\t\truntime: "hindsight";\n'
        "\t};\n"
        "\tsource_attribution: SafeRecord[];\n"
        "\tcontext_summary: string | null;\n"
        "\tbudget: { token_estimate: number; recent_turn_limit: number };\n"
        "\ttruncation: SafeRecord | null;\n"
        "}\n\n"
        "export interface RuntimeDecisionSummaryWire {\n"
        "\tschema_version: typeof TOOL_EXECUTION_CONTRACT.runtimeDecisionSummarySchemaVersion;\n"
        "\tscope_gate_decision?: string;\n"
        "\tpolicy_gate_decision?: string;\n"
        "\tcontext_preflight_state?: string;\n"
        "\trouting_next_action?: string;\n"
        "\tplanning_outcome: string;\n"
        "\tselected_tool?: string;\n"
        "\ttask_queue?: string;\n"
        "\tterminal_outcome?: string;\n"
        "\tfail_close_reason?: string;\n"
        "\truntime_versions?: SafeRecord;\n"
        "\tpolicy_artifact_versions?: SafeRecord;\n"
        "}\n\n"
        "export interface WorkflowPlanStepWire {\n"
        "\tstep_id: string;\n"
        "\tstep_kind: string;\n"
        "\ttool?: ToolID | string;\n"
        "\ttask_queue?: string;\n"
        "\tpayload_kind?: string;\n"
        "\tallowed_tools?: string[];\n"
        "\tselected_tool?: string;\n"
        "}\n\n"
        "export interface WorkflowPlanEdgeWire {\n"
        "\tfrom_step_id: string;\n"
        "\tto_step_id: string;\n"
        "\tcondition: string;\n"
        "\trequired_projection_kind?: StepOutputProjectionKind;\n"
        "}\n\n"
        "export interface ProjectionSafetySummaryWire {\n"
        "\ttruncated: boolean;\n"
        "\tredacted: boolean;\n"
        "\tmax_chars: number;\n"
        "\tfields_present: string[];\n"
        "}\n\n"
        "export interface StepOutputProjectionWire {\n"
        "\tprojection_id: string;\n"
        "\tsource_step_id: string;\n"
        "\tprojection_kind: StepOutputProjectionKind;\n"
        "\tcontent_hash: string;\n"
        "\tpayload: SafeRecord;\n"
        "\tsafety: ProjectionSafetySummaryWire;\n"
        "}\n\n"
        "export interface WorkflowContextProjectionWire {\n"
        "\tprojection_id: string;\n"
        "\tsource_step_id: string;\n"
        "\tprojection_kind: StepOutputProjectionKind;\n"
        "\tcontent_hash: string;\n"
        "\tsafety: ProjectionSafetySummaryWire;\n"
        "}\n\n"
        "export interface WorkflowToolContextWire {\n"
        '\tschema_version: "workflow-tool-context-v1";\n'
        '\tvisibility: "tool_private";\n'
        "\tworkflow_run_ref: string;\n"
        "\tstep_id: string;\n"
        "\ttool_id: ToolID;\n"
        "\ttask_queue?: string;\n"
        "\trequired_projection_kind?: StepOutputProjectionKind;\n"
        "\texpected_output_artifacts: StepOutputProjectionKind[];\n"
        "\tprojection_refs: WorkflowContextProjectionWire[];\n"
        "}\n\n"
        "export interface WorkflowPlanWire {\n"
        '\tschema_version: "workflow-plan-v1";\n'
        "\tplan_id: string;\n"
        "\tworkflow_mode: WorkflowMode;\n"
        "\tallowed_tools: ToolID[];\n"
        "\tsteps: WorkflowPlanStepWire[];\n"
        "\tedges: WorkflowPlanEdgeWire[];\n"
        "\tterminal_policy: SafeRecord;\n"
        "\tresume_policy: SafeRecord;\n"
        "\tsemantic_retry_policy: SafeRecord;\n"
        "}\n\n"
        "export interface ToolInvocationWire {\n"
        "\tinvocation_id: string;\n"
        "\tparent_invocation_id?: string;\n"
        "\tworkflow_run_ref: string;\n"
        "\tstep_id: string;\n"
        "\ttool_id: ToolID;\n"
        "\tstatus: string;\n"
        "\tallowed_tools: string[];\n"
        "\tused_tools: string[];\n"
        "\tprojection_ids: string[];\n"
        "\tfail_close_reason?: string;\n"
        "}\n\n"
        "export interface RuntimeDecisionsWire {\n"
        "\tschema_version: typeof TOOL_EXECUTION_CONTRACT.runtimeDecisionsSchemaVersion;\n"
        "\teffective_tool: RequestedTool;\n"
        "\ttask_queue: string;\n"
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
        "export interface ToolResponseWire {\n"
        "\ttool: ToolID;\n"
        "\ttask_queue?: string;\n"
        "\tstatus: DelegateStatus;\n"
        "\tanswer_text?: string;\n"
        "\tfollow_up_question?: string;\n"
        "\tconfidence?: ConfidenceLevel;\n"
        "\tresult?: SafeRecord | null;\n"
        "\terror?: { code: string; message: string; retryable?: boolean } | null;\n"
        "\ttool_observability?: SafeRecord | null;\n"
        "}\n\n"
        "export interface ToolExecutionRequestWire {\n"
        "\texecution_contract_version: typeof TOOL_EXECUTION_CONTRACT.executionContractVersion;\n"
        "\tresponse_contract: typeof TOOL_EXECUTION_CONTRACT.responseContract;\n"
        "\tuser_goal: string;\n"
        "\tconversation_id?: string;\n"
        "\ttenant_id?: string;\n"
        "\trequest_id: string;\n"
        "\tsafety_identifier?: string | null;\n"
        "\teffective_tool: RequestedTool;\n"
        "\ttask_queue: string;\n"
        "\trequested_tool: RequestedTool;\n"
        "\trequested_scope?: { corpus: string; collection: string } | null;\n"
        "\ttrace: { trace_id: string };\n"
        "\tactor: SafeRecord;\n"
        "\tcontext: SafeRecord;\n"
        "\tversion_query: SafeRecord;\n"
        "\truntime_decisions?: RuntimeDecisionsWire;\n"
        "}\n\n"
        "export interface ToolRequestWire {\n"
        "\ttool: ToolID;\n"
        "\ttask_queue?: string;\n"
        "\tuser_goal: string;\n"
        "\tconversation_id?: string;\n"
        "\trequest_id?: string;\n"
        "\tsafety_identifier?: string | null;\n"
        "\ttrace?: { trace_id: string };\n"
        "\tactor?: SafeRecord;\n"
        "\tcontext?: SafeRecord;\n"
        "\tworkflow_context?: WorkflowToolContextWire;\n"
        "\tpayload: { kind: string; payload: SafeRecord };\n"
        "\tallowed_tools: ModelVisibleToolName[];\n"
        "}\n\n"
        "export interface ToolExecutionWorkflowTraceSummaryWire {\n"
        "\trouting_frame: SafeRecord;\n"
        "\tcontext_resolution: SafeRecord;\n"
        "\tplanning_outcome: string;\n"
        "\tdirect_vs_delegate_branch: string;\n"
        "\tworkflow_mode: WorkflowMode;\n"
        "\thandoff: SafeRecord;\n"
        "\thandoff_chain: SafeRecord[];\n"
        "\ttool_invocations: ToolInvocationWire[];\n"
        "\tselected_tool: ToolID | string | null;\n"
        "\tselected_tools: string[];\n"
        "\tcontext_projections: WorkflowContextProjectionWire[];\n"
        "\tanswer_artifact_projection_ids: string[];\n"
        "\tanswer_artifact_kinds: StepOutputProjectionKind[];\n"
        "\ttool_argument_summary: SafeRecord;\n"
        "\ttrace_steps?: SafeRecord[];\n"
        "\ttool_call_summaries?: SafeRecord[];\n"
        "\tguardrail_outcomes: SafeRecord;\n"
        "\tfail_close_reason: string;\n"
        "\truntime_versions: SafeRecord;\n"
        "\tpolicy_artifact_versions: SafeRecord;\n"
        "}\n\n"
        "export interface ToolExecutionResponseWire {\n"
        "\tselected_tool: ToolID | null;\n"
        "\tstatus: ExecutionStatus;\n"
        "\tanswer_text: string;\n"
        "\tfollow_up_question: string;\n"
        "\tconfidence: ConfidenceLevel;\n"
        "\tresult: SafeRecord | null;\n"
        "\terror: { code: string; message: string; retryable: boolean } | null;\n"
        "\tobservability?: SafeRecord | null;\n"
        "\tworkflow_trace_summary?: ToolExecutionWorkflowTraceSummaryWire | null;\n"
        "\ttrace_id: string;\n"
        "}\n"
    )


def _generate_go(contract: dict[str, Any]) -> str:
    meta = _contract_meta(contract)
    tool_ids = _enum(contract, "ToolID")
    model_visible_tool_names = _enum(contract, "ModelVisibleToolName")
    requested_tools = _enum(contract, "RequestedTool")
    confidence_levels = _enum(contract, "ConfidenceLevel")
    delegate_statuses = _enum(contract, "DelegateStatus")
    execution_statuses = _enum(contract, "ExecutionStatus")
    workflow_modes = _enum(contract, "WorkflowMode")
    projection_kinds = _enum(contract, "StepOutputProjectionKind")
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
        f"\tExecutionContractVersion = {_go_quote(meta['execution_contract_version'])}\n"
        f"\tResponseContract = {_go_quote(meta['response_contract'])}\n"
        f"\tRuntimeDecisionsSchemaVersion = "
        f"{_go_quote(meta['runtime_decisions_schema_version'])}\n"
        f"\tRuntimeDecisionSummarySchemaVersion = "
        f"{_go_quote(meta['runtime_decision_summary_schema_version'])}\n"
        f"\tWorkflowTraceSummaryVersion = {_go_quote(meta['workflow_trace_summary_version'])}\n"
        ")\n\n"
        + _go_string_type("ToolID", tool_ids)
        + _go_string_type("ModelVisibleToolName", model_visible_tool_names)
        + _go_string_type("RequestedTool", requested_tools)
        + _go_string_type("ConfidenceLevel", confidence_levels)
        + _go_string_type("DelegateStatus", delegate_statuses)
        + _go_string_type("ExecutionStatus", execution_statuses)
        + _go_string_type("WorkflowMode", workflow_modes)
        + _go_string_type("StepOutputProjectionKind", projection_kinds)
        + """
type ConversationContextWire struct {
\tSchemaVersion string `json:"schema_version"`
\tConversationID string `json:"conversation_id"`
\tUserMessageID string `json:"user_message_id"`
\tParentMessageID *string `json:"parent_message_id,omitempty"`
\tCurrentUserMessage map[string]any `json:"current_user_message"`
\tRecentTurns []map[string]any `json:"recent_turns"`
\tPreviousAnswerSummary *string `json:"previous_answer_summary,omitempty"`
\tPreviousEvidenceRefs []map[string]any `json:"previous_evidence_refs"`
\tPreviousToolResults []map[string]any `json:"previous_tool_results"`
\tSessionState map[string]any `json:"session_state"`
\tVisibility map[string]any `json:"visibility"`
\tMemoryRecall map[string]any `json:"memory_recall"`
\tSourceAttribution []map[string]any `json:"source_attribution"`
\tContextSummary *string `json:"context_summary"`
\tBudget map[string]any `json:"budget"`
\tTruncation map[string]any `json:"truncation"`
}

type RuntimeDecisionSummaryWire struct {
\tSchemaVersion string `json:"schema_version"`
\tScopeGateDecision string `json:"scope_gate_decision,omitempty"`
\tPolicyGateDecision string `json:"policy_gate_decision,omitempty"`
\tContextPreflightState string `json:"context_preflight_state,omitempty"`
\tRoutingNextAction string `json:"routing_next_action,omitempty"`
\tPlanningOutcome string `json:"planning_outcome"`
\tSelectedTool string `json:"selected_tool,omitempty"`
\tTaskQueue string `json:"task_queue,omitempty"`
\tTerminalOutcome string `json:"terminal_outcome,omitempty"`
\tFailCloseReason string `json:"fail_close_reason,omitempty"`
\tRuntimeVersions map[string]any `json:"runtime_versions,omitempty"`
\tPolicyArtifactVersions map[string]any `json:"policy_artifact_versions,omitempty"`
}

type WorkflowPlanStepWire struct {
\tStepID string `json:"step_id"`
\tStepKind string `json:"step_kind"`
\tTool string `json:"tool,omitempty"`
\tTaskQueue string `json:"task_queue,omitempty"`
\tPayloadKind string `json:"payload_kind,omitempty"`
\tAllowedTools []string `json:"allowed_tools,omitempty"`
\tSelectedTool string `json:"selected_tool,omitempty"`
}

type WorkflowPlanEdgeWire struct {
\tFromStepID string `json:"from_step_id"`
\tToStepID string `json:"to_step_id"`
\tCondition string `json:"condition"`
\tRequiredProjectionKind string `json:"required_projection_kind,omitempty"`
}

type ProjectionSafetySummaryWire struct {
\tTruncated bool `json:"truncated"`
\tRedacted bool `json:"redacted"`
\tMaxChars int `json:"max_chars"`
\tFieldsPresent []string `json:"fields_present"`
}

type StepOutputProjectionWire struct {
\tProjectionID string `json:"projection_id"`
\tSourceStepID string `json:"source_step_id"`
\tProjectionKind string `json:"projection_kind"`
\tContentHash string `json:"content_hash"`
\tPayload map[string]any `json:"payload"`
\tSafety ProjectionSafetySummaryWire `json:"safety"`
}

type WorkflowContextProjectionWire struct {
\tProjectionID string `json:"projection_id"`
\tSourceStepID string `json:"source_step_id"`
\tProjectionKind StepOutputProjectionKind `json:"projection_kind"`
\tContentHash string `json:"content_hash"`
\tSafety ProjectionSafetySummaryWire `json:"safety"`
}

type WorkflowToolContextWire struct {
\tSchemaVersion string `json:"schema_version"`
\tVisibility string `json:"visibility"`
\tWorkflowRunRef string `json:"workflow_run_ref"`
\tStepID string `json:"step_id"`
\tToolID ToolID `json:"tool_id"`
\tTaskQueue string `json:"task_queue,omitempty"`
\tRequiredProjectionKind StepOutputProjectionKind `json:"required_projection_kind,omitempty"`
\tExpectedOutputArtifacts []StepOutputProjectionKind `json:"expected_output_artifacts"`
\tProjectionRefs []WorkflowContextProjectionWire `json:"projection_refs"`
}

type WorkflowPlanWire struct {
\tSchemaVersion string `json:"schema_version"`
\tPlanID string `json:"plan_id"`
\tWorkflowMode WorkflowMode `json:"workflow_mode"`
\tAllowedTools []ToolID `json:"allowed_tools"`
\tSteps []WorkflowPlanStepWire `json:"steps"`
\tEdges []WorkflowPlanEdgeWire `json:"edges"`
\tTerminalPolicy map[string]any `json:"terminal_policy"`
\tResumePolicy map[string]any `json:"resume_policy"`
\tSemanticRetryPolicy map[string]any `json:"semantic_retry_policy"`
}

type ToolInvocationWire struct {
\tInvocationID string `json:"invocation_id"`
\tParentInvocationID string `json:"parent_invocation_id,omitempty"`
\tWorkflowRunRef string `json:"workflow_run_ref"`
\tStepID string `json:"step_id"`
\tToolID ToolID `json:"tool_id"`
\tStatus string `json:"status"`
\tAllowedTools []string `json:"allowed_tools"`
\tUsedTools []string `json:"used_tools"`
\tProjectionIDs []string `json:"projection_ids"`
\tFailCloseReason string `json:"fail_close_reason,omitempty"`
}

type RuntimeDecisionsWire struct {
\tSchemaVersion string `json:"schema_version"`
\tEffectiveTool RequestedTool `json:"effective_tool"`
\tTaskQueue string `json:"task_queue"`
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

type ToolExecutionRequestWire struct {
\tExecutionContractVersion string `json:"execution_contract_version"`
\tResponseContract string `json:"response_contract"`
\tUserGoal string `json:"user_goal"`
\tConversationID string `json:"conversation_id,omitempty"`
\tTenantID string `json:"tenant_id,omitempty"`
\tRequestID string `json:"request_id"`
\tSafetyIdentifier *string `json:"safety_identifier,omitempty"`
\tEffectiveTool RequestedTool `json:"effective_tool"`
\tTaskQueue string `json:"task_queue"`
\tRequestedTool RequestedTool `json:"requested_tool"`
\tRequestedScope map[string]any `json:"requested_scope,omitempty"`
\tTrace map[string]any `json:"trace"`
\tActor map[string]any `json:"actor"`
\tContext map[string]any `json:"context"`
\tVersionQuery map[string]any `json:"version_query"`
\tRuntimeDecisions *RuntimeDecisionsWire `json:"runtime_decisions,omitempty"`
}

type ToolRequestWire struct {
\tTool ToolID `json:"tool"`
\tTaskQueue string `json:"task_queue,omitempty"`
\tUserGoal string `json:"user_goal"`
\tConversationID string `json:"conversation_id,omitempty"`
\tRequestID string `json:"request_id,omitempty"`
\tSafetyIdentifier *string `json:"safety_identifier,omitempty"`
\tTrace map[string]any `json:"trace,omitempty"`
\tActor map[string]any `json:"actor,omitempty"`
\tContext map[string]any `json:"context,omitempty"`
\tWorkflowContext *WorkflowToolContextWire `json:"workflow_context,omitempty"`
\tPayload map[string]any `json:"payload"`
\tAllowedTools []ModelVisibleToolName `json:"allowed_tools"`
}

type WorkflowTraceSummaryWire struct {
\tRoutingFrame map[string]any `json:"routing_frame"`
\tContextResolution map[string]any `json:"context_resolution"`
\tPlanningOutcome string `json:"planning_outcome"`
\tDirectVsDelegateBranch string `json:"direct_vs_delegate_branch"`
\tWorkflowMode WorkflowMode `json:"workflow_mode"`
\tHandoff map[string]any `json:"handoff"`
\tHandoffChain []map[string]any `json:"handoff_chain"`
\tToolInvocations []ToolInvocationWire `json:"tool_invocations"`
\tSelectedTool *string `json:"selected_tool"`
\tSelectedTools []string `json:"selected_tools"`
\tContextProjections []WorkflowContextProjectionWire `json:"context_projections"`
\tAnswerArtifactProjectionIDs []string `json:"answer_artifact_projection_ids"`
\tAnswerArtifactKinds []StepOutputProjectionKind `json:"answer_artifact_kinds"`
\tToolArgumentSummary map[string]any `json:"tool_argument_summary"`
\tTraceSteps []map[string]any `json:"trace_steps,omitempty"`
\tToolCallSummaries []map[string]any `json:"tool_call_summaries,omitempty"`
\tGuardrailOutcomes map[string]any `json:"guardrail_outcomes"`
\tFailCloseReason string `json:"fail_close_reason"`
\tRuntimeVersions map[string]any `json:"runtime_versions"`
\tPolicyArtifactVersions map[string]any `json:"policy_artifact_versions"`
}

type ToolExecutionResponseWire struct {
\tSelectedTool *ToolID `json:"selected_tool"`
\tStatus ExecutionStatus `json:"status"`
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
        + go_decode_helpers(tool_ids, requested_tools, workflow_modes, projection_kinds)
    )


def _ts_const_array(name: str, values: tuple[str, ...]) -> str:
    inline_array = "[" + ", ".join(_ts_quote(value) for value in values) + "]"
    inline_line = f"export const {name} = {inline_array} as const;"
    if len(inline_line) <= 100:
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


_ts_quote = json.dumps
_go_quote = json.dumps


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
