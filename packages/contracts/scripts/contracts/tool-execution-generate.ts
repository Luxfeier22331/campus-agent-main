import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isRecord, loadYaml, relativePath, repoPath } from "./common.ts";
import { goConstSuffix, goDecodeHelpers } from "./tool-execution-go-decode.ts";

const openApiPath = repoPath("docs/contracts/schemas/tool-execution.openapi.yaml");
const tsPath = repoPath(
	"apps/app-api/src/modules/integration/generated/tool-execution-contract.ts",
);
const goPath = repoPath("apps/execution-control/internal/contracts/tool_execution_contract.go");
const header = "AUTO-GENERATED FROM tool-execution.openapi.yaml";

export function generateToolExecutionContracts({ check = false }: { check?: boolean } = {}): void {
	const contract = loadContract();
	const outputs = new Map([
		[tsPath, generateTs(contract)],
		[goPath, generateGo(contract)],
	]);
	if (check) {
		const mismatches = [...outputs.entries()]
			.filter(([path, expected]) => !existsSync(path) || readFileSync(path, "utf8") !== expected)
			.map(([path]) => relativePath(path));
		if (mismatches.length > 0) {
			throw new Error(
				`generated tool execution contracts are out of sync: ${mismatches.join(", ")}`,
			);
		}
		return;
	}
	for (const [path, content] of outputs) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content, "utf8");
	}
}

function loadContract(): Record<string, unknown> {
	const openapi = loadYaml(openApiPath);
	if (!isRecord(openapi)) {
		throw new Error("tool execution OpenAPI document must be an object");
	}
	if (openapi.openapi !== "3.1.1") {
		throw new Error("tool execution OpenAPI document must use OpenAPI 3.1.1");
	}
	if (openapi.jsonSchemaDialect !== "https://json-schema.org/draft/2020-12/schema") {
		throw new Error("tool execution OpenAPI document must use JSON Schema 2020-12");
	}
	return openapi;
}

function schemas(contract: Record<string, unknown>): Record<string, unknown> {
	if (!(isRecord(contract.components) && isRecord(contract.components.schemas))) {
		throw new Error("OpenAPI components.schemas must be an object");
	}
	return contract.components.schemas;
}

function enumValues(contract: Record<string, unknown>, name: string): string[] {
	const schema = schemas(contract)[name];
	if (
		!(
			isRecord(schema) &&
			Array.isArray(schema.enum) &&
			schema.enum.every((item) => typeof item === "string")
		)
	) {
		throw new Error(`schema ${name} must define a string enum`);
	}
	return schema.enum;
}

function stageTimingFields(contract: Record<string, unknown>): string[] {
	const schema = schemas(contract).StageTiming;
	if (!isRecord(schema)) {
		throw new Error("missing schema: StageTiming");
	}
	if (schema.additionalProperties !== false) {
		throw new Error("StageTiming must reject additionalProperties");
	}
	if (!isRecord(schema.properties) || Object.keys(schema.properties).length === 0) {
		throw new Error("StageTiming must define allowlisted properties");
	}
	return Object.entries(schema.properties).map(([name, fieldSchema]) => {
		if (name === "" || !isRecord(fieldSchema)) {
			throw new Error(`StageTiming.${name} schema must be an object`);
		}
		if (fieldSchema.type !== "number" || fieldSchema.minimum !== 0) {
			throw new Error(`StageTiming.${name} must be a non-negative number`);
		}
		return name;
	});
}

function debugTraceSinks(contract: Record<string, unknown>): string[] {
	const schema = schemas(contract).DebugTraceRef;
	if (!(isRecord(schema) && isRecord(schema.properties) && isRecord(schema.properties.sink))) {
		throw new Error("DebugTraceRef.sink schema must be an object");
	}
	const values = schema.properties.sink.enum;
	if (!(Array.isArray(values) && values.every((item) => typeof item === "string" && item !== ""))) {
		throw new Error("DebugTraceRef.sink must define a string enum");
	}
	return values;
}

function contractMeta(contract: Record<string, unknown>): Record<string, string> {
	const meta = contract["x-campus-contract"];
	if (!isRecord(meta)) {
		throw new Error("x-campus-contract metadata is required");
	}
	const result: Record<string, string> = {};
	for (const key of [
		"execution_contract_version",
		"response_contract",
		"runtime_decisions_schema_version",
		"runtime_decision_summary_schema_version",
		"workflow_trace_summary_version",
	]) {
		const value = meta[key];
		if (typeof value !== "string" || value === "") {
			throw new Error(`x-campus-contract.${key} must be a non-empty string`);
		}
		result[key] = value;
	}
	return result;
}

function generateTs(contract: Record<string, unknown>): string {
	const meta = contractMeta(contract);
	return (
		`/* ${header}. Do not edit by hand. */\n\n` +
		"export const TOOL_EXECUTION_CONTRACT = {\n" +
		`\texecutionContractVersion: ${quote(meta.execution_contract_version)},\n` +
		`\tresponseContract: ${quote(meta.response_contract)},\n` +
		`\truntimeDecisionsSchemaVersion: ${quote(meta.runtime_decisions_schema_version)},\n` +
		`\truntimeDecisionSummarySchemaVersion: ${quote(meta.runtime_decision_summary_schema_version)},\n` +
		`\tworkflowTraceSummaryVersion: ${quote(meta.workflow_trace_summary_version)},\n` +
		"} as const;\n\n" +
		tsConstArray("TOOL_IDS", enumValues(contract, "ToolID")) +
		tsConstArray("MODEL_VISIBLE_TOOL_NAMES", enumValues(contract, "ModelVisibleToolName")) +
		tsConstArray("REQUESTED_TOOLS", enumValues(contract, "RequestedTool")) +
		tsConstArray("CONFIDENCE_LEVELS", enumValues(contract, "ConfidenceLevel")) +
		tsConstArray("DELEGATE_STATUSES", enumValues(contract, "DelegateStatus")) +
		tsConstArray("EXECUTION_STATUSES", enumValues(contract, "ExecutionStatus")) +
		tsConstArray("WORKFLOW_MODES", enumValues(contract, "WorkflowMode")) +
		tsConstArray("STEP_OUTPUT_PROJECTION_KINDS", enumValues(contract, "StepOutputProjectionKind")) +
		tsConstArray("STAGE_TIMING_FIELDS", stageTimingFields(contract)) +
		tsConstArray("DEBUG_TRACE_SINKS", debugTraceSinks(contract)) +
		tsWireTypes()
	);
}

function tsWireTypes(): string {
	return `
export type ToolID = (typeof TOOL_IDS)[number];
export type ModelVisibleToolName = (typeof MODEL_VISIBLE_TOOL_NAMES)[number];
export type RequestedTool = (typeof REQUESTED_TOOLS)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type DelegateStatus = (typeof DELEGATE_STATUSES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type WorkflowMode = (typeof WORKFLOW_MODES)[number];
export type StepOutputProjectionKind = (typeof STEP_OUTPUT_PROJECTION_KINDS)[number];

export type StageTimingField = (typeof STAGE_TIMING_FIELDS)[number];
export type StageTimingWire = Partial<Record<StageTimingField, number>>;
export type DebugTraceSink = (typeof DEBUG_TRACE_SINKS)[number];

export type SafeRecord = Record<string, unknown>;

export interface ConversationContextWire {
\tschema_version: "conversation_context.v1";
\tconversation_id: string;
\tuser_message_id: string;
\tparent_message_id?: string | null;
\tcurrent_user_message: { role: "user"; content: string; created_at: string };
\trecent_turns: SafeRecord[];
\tprevious_answer_summary?: string | null;
\tprevious_evidence_refs: SafeRecord[];
\tprevious_tool_results: SafeRecord[];
\tsession_state: SafeRecord;
\tvisibility: { model_visible: string[]; runtime_only: string[] };
\tmemory_recall: {
\t\tgate_field: "context.memory.enabled";
\t\towner: "execution-control";
\t\truntime: "hindsight";
\t};
\tsource_attribution: SafeRecord[];
\tcontext_summary: string | null;
\tbudget: { token_estimate: number; recent_turn_limit: number };
\ttruncation: SafeRecord | null;
}

export interface RuntimeDecisionSummaryWire {
\tschema_version: typeof TOOL_EXECUTION_CONTRACT.runtimeDecisionSummarySchemaVersion;
\tscope_gate_decision?: string;
\tpolicy_gate_decision?: string;
\tcontext_preflight_state?: string;
\trouting_next_action?: string;
\tplanning_outcome: string;
\tselected_tool?: string;
\ttask_queue?: string;
\tterminal_outcome?: string;
\tfail_close_reason?: string;
\truntime_versions?: SafeRecord;
\tpolicy_artifact_versions?: SafeRecord;
}

export interface WorkflowPlanStepWire {
\tstep_id: string;
\tstep_kind: string;
\ttool?: ToolID | string;
\ttask_queue?: string;
\tpayload_kind?: string;
\tallowed_tools?: string[];
\tselected_tool?: string;
}

export interface WorkflowPlanEdgeWire {
\tfrom_step_id: string;
\tto_step_id: string;
\tcondition: string;
\trequired_projection_kind?: StepOutputProjectionKind;
}

export interface ProjectionSafetySummaryWire {
\ttruncated: boolean;
\tredacted: boolean;
\tmax_chars: number;
\tfields_present: string[];
}

export interface StepOutputProjectionWire {
\tprojection_id: string;
\tsource_step_id: string;
\tprojection_kind: StepOutputProjectionKind;
\tcontent_hash: string;
\tpayload: SafeRecord;
\tsafety: ProjectionSafetySummaryWire;
}

export interface WorkflowContextProjectionWire {
\tprojection_id: string;
\tsource_step_id: string;
\tprojection_kind: StepOutputProjectionKind;
\tcontent_hash: string;
\tsafety: ProjectionSafetySummaryWire;
}

export interface WorkflowToolContextWire {
\tschema_version: "workflow-tool-context-v1";
\tvisibility: "tool_private";
\tworkflow_run_ref: string;
\tstep_id: string;
\ttool_id: ToolID;
\ttask_queue?: string;
\trequired_projection_kind?: StepOutputProjectionKind;
\texpected_output_artifacts: StepOutputProjectionKind[];
\tprojection_refs: WorkflowContextProjectionWire[];
}

export interface WorkflowPlanWire {
\tschema_version: "workflow-plan-v1";
\tplan_id: string;
\tworkflow_mode: WorkflowMode;
\tallowed_tools: ToolID[];
\tsteps: WorkflowPlanStepWire[];
\tedges: WorkflowPlanEdgeWire[];
\tterminal_policy: SafeRecord;
\tresume_policy: SafeRecord;
\tsemantic_retry_policy: SafeRecord;
}

export interface ToolInvocationWire {
\tinvocation_id: string;
\tparent_invocation_id?: string;
\tworkflow_run_ref: string;
\tstep_id: string;
\ttool_id: ToolID;
\tstatus: string;
\tallowed_tools: string[];
\tused_tools: string[];
\tprojection_ids: string[];
\tfail_close_reason?: string;
}

export interface RuntimeDecisionsWire {
\tschema_version: typeof TOOL_EXECUTION_CONTRACT.runtimeDecisionsSchemaVersion;
\teffective_tool: RequestedTool;
\ttask_queue: string;
\trouting_frame: SafeRecord;
\truntime_decision_summary: RuntimeDecisionSummaryWire;
\tscope_gate?: SafeRecord;
\tpolicy_gate?: SafeRecord;
\tcontext_preflight?: SafeRecord;
\ttool_policy?: SafeRecord;
\thandoff?: SafeRecord;
\tworkflow_plan?: WorkflowPlanWire;
\tterminal_envelope?: SafeRecord;
\t[key: string]: unknown;
}

export interface ToolResponseWire {
\ttool: ToolID;
\ttask_queue?: string;
\tstatus: DelegateStatus;
\tanswer_text?: string;
\tfollow_up_question?: string;
\tconfidence?: ConfidenceLevel;
\tresult?: SafeRecord | null;
\terror?: { code: string; message: string; retryable?: boolean } | null;
\ttool_observability?: SafeRecord | null;
}

export interface ToolExecutionRequestWire {
\texecution_contract_version: typeof TOOL_EXECUTION_CONTRACT.executionContractVersion;
\tresponse_contract: typeof TOOL_EXECUTION_CONTRACT.responseContract;
\tuser_goal: string;
\tconversation_id?: string;
\ttenant_id?: string;
\trequest_id: string;
\tsafety_identifier?: string | null;
\teffective_tool: RequestedTool;
\ttask_queue: string;
\trequested_tool: RequestedTool;
\trequested_scope?: { corpus: string; collection: string } | null;
\ttrace: { trace_id: string };
\tactor: SafeRecord;
\tcontext: SafeRecord;
\tversion_query: SafeRecord;
\truntime_decisions?: RuntimeDecisionsWire;
}

export interface ToolRequestWire {
\ttool: ToolID;
\ttask_queue?: string;
\tuser_goal: string;
\tconversation_id?: string;
\trequest_id?: string;
\tsafety_identifier?: string | null;
\ttrace?: { trace_id: string };
\tactor?: SafeRecord;
\tcontext?: SafeRecord;
\tworkflow_context?: WorkflowToolContextWire;
\tpayload: { kind: string; payload: SafeRecord };
\tallowed_tools: ModelVisibleToolName[];
}

export interface ToolExecutionWorkflowTraceSummaryWire {
\trouting_frame: SafeRecord;
\tcontext_resolution: SafeRecord;
\tplanning_outcome: string;
\tdirect_vs_delegate_branch: string;
\tworkflow_mode: WorkflowMode;
\thandoff: SafeRecord;
\thandoff_chain: SafeRecord[];
\ttool_invocations: ToolInvocationWire[];
\tselected_tool: ToolID | string | null;
\tselected_tools: string[];
\tcontext_projections: WorkflowContextProjectionWire[];
\tanswer_artifact_projection_ids: string[];
\tanswer_artifact_kinds: StepOutputProjectionKind[];
\ttool_argument_summary: SafeRecord;
\ttrace_steps?: SafeRecord[];
\ttool_call_summaries?: SafeRecord[];
\tguardrail_outcomes: SafeRecord;
\tfail_close_reason: string;
\truntime_versions: SafeRecord;
\tpolicy_artifact_versions: SafeRecord;
}

export interface DebugTraceRefWire {
\tsink: DebugTraceSink;
\ttrace_id?: string | null;
\ttrace_ref: string;
\turl?: string;
}

export interface ToolExecutionResponseWire {
\tselected_tool: ToolID | null;
\tstatus: ExecutionStatus;
\tanswer_text: string;
\tfollow_up_question: string;
\tconfidence: ConfidenceLevel;
\tresult: SafeRecord | null;
\terror: { code: string; message: string; retryable: boolean } | null;
\tobservability?: SafeRecord | null;
\tworkflow_trace_summary?: ToolExecutionWorkflowTraceSummaryWire | null;
\tstage_timing?: StageTimingWire | null;
\tdebug_trace_refs?: DebugTraceRefWire[] | null;
\ttrace_id: string;
}
`;
}

function generateGo(contract: Record<string, unknown>): string {
	const meta = contractMeta(contract);
	const toolIds = enumValues(contract, "ToolID");
	const requestedTools = enumValues(contract, "RequestedTool");
	const workflowModes = enumValues(contract, "WorkflowMode");
	const projectionKinds = enumValues(contract, "StepOutputProjectionKind");
	const stageFields = stageTimingFields(contract);
	const traceSinks = debugTraceSinks(contract);
	return gofmt(
		`// ${header}. Do not edit by hand.\n\n` +
			"package contracts\n\n" +
			"import (\n" +
			'\t"bytes"\n' +
			'\t"encoding/json"\n' +
			'\t"fmt"\n' +
			'\t"io"\n' +
			'\t"math"\n' +
			")\n\n" +
			"const (\n" +
			`\tExecutionContractVersion = ${quote(meta.execution_contract_version)}\n` +
			`\tResponseContract = ${quote(meta.response_contract)}\n` +
			`\tRuntimeDecisionsSchemaVersion = ${quote(meta.runtime_decisions_schema_version)}\n` +
			`\tRuntimeDecisionSummarySchemaVersion = ${quote(meta.runtime_decision_summary_schema_version)}\n` +
			`\tWorkflowTraceSummaryVersion = ${quote(meta.workflow_trace_summary_version)}\n` +
			")\n\n" +
			goStringType("ToolID", toolIds) +
			goStringType("ModelVisibleToolName", enumValues(contract, "ModelVisibleToolName")) +
			goStringType("RequestedTool", requestedTools) +
			goStringType("ConfidenceLevel", enumValues(contract, "ConfidenceLevel")) +
			goStringType("DelegateStatus", enumValues(contract, "DelegateStatus")) +
			goStringType("ExecutionStatus", enumValues(contract, "ExecutionStatus")) +
			goStringType("WorkflowMode", workflowModes) +
			goStringType("StepOutputProjectionKind", projectionKinds) +
			goStringType("StageTimingField", stageFields) +
			goStringType("DebugTraceSink", traceSinks) +
			goWireTypes() +
			goDecodeHelpers({
				toolIds,
				requestedTools,
				workflowModes,
				projectionKinds,
				stageTimingFields: stageFields,
				debugTraceSinks: traceSinks,
			}),
	);
}

function goWireTypes(): string {
	return `
type ConversationContextWire struct {
\tSchemaVersion string \`json:"schema_version"\`
\tConversationID string \`json:"conversation_id"\`
\tUserMessageID string \`json:"user_message_id"\`
\tParentMessageID *string \`json:"parent_message_id,omitempty"\`
\tCurrentUserMessage map[string]any \`json:"current_user_message"\`
\tRecentTurns []map[string]any \`json:"recent_turns"\`
\tPreviousAnswerSummary *string \`json:"previous_answer_summary,omitempty"\`
\tPreviousEvidenceRefs []map[string]any \`json:"previous_evidence_refs"\`
\tPreviousToolResults []map[string]any \`json:"previous_tool_results"\`
\tSessionState map[string]any \`json:"session_state"\`
\tVisibility map[string]any \`json:"visibility"\`
\tMemoryRecall map[string]any \`json:"memory_recall"\`
\tSourceAttribution []map[string]any \`json:"source_attribution"\`
\tContextSummary *string \`json:"context_summary"\`
\tBudget map[string]any \`json:"budget"\`
\tTruncation map[string]any \`json:"truncation"\`
}

type RuntimeDecisionSummaryWire struct {
\tSchemaVersion string \`json:"schema_version"\`
\tScopeGateDecision string \`json:"scope_gate_decision,omitempty"\`
\tPolicyGateDecision string \`json:"policy_gate_decision,omitempty"\`
\tContextPreflightState string \`json:"context_preflight_state,omitempty"\`
\tRoutingNextAction string \`json:"routing_next_action,omitempty"\`
\tPlanningOutcome string \`json:"planning_outcome"\`
\tSelectedTool string \`json:"selected_tool,omitempty"\`
\tTaskQueue string \`json:"task_queue,omitempty"\`
\tTerminalOutcome string \`json:"terminal_outcome,omitempty"\`
\tFailCloseReason string \`json:"fail_close_reason,omitempty"\`
\tRuntimeVersions map[string]any \`json:"runtime_versions,omitempty"\`
\tPolicyArtifactVersions map[string]any \`json:"policy_artifact_versions,omitempty"\`
}

type WorkflowPlanStepWire struct {
\tStepID string \`json:"step_id"\`
\tStepKind string \`json:"step_kind"\`
\tTool string \`json:"tool,omitempty"\`
\tTaskQueue string \`json:"task_queue,omitempty"\`
\tPayloadKind string \`json:"payload_kind,omitempty"\`
\tAllowedTools []string \`json:"allowed_tools,omitempty"\`
\tSelectedTool string \`json:"selected_tool,omitempty"\`
}

type WorkflowPlanEdgeWire struct {
\tFromStepID string \`json:"from_step_id"\`
\tToStepID string \`json:"to_step_id"\`
\tCondition string \`json:"condition"\`
\tRequiredProjectionKind string \`json:"required_projection_kind,omitempty"\`
}

type ProjectionSafetySummaryWire struct {
\tTruncated bool \`json:"truncated"\`
\tRedacted bool \`json:"redacted"\`
\tMaxChars int \`json:"max_chars"\`
\tFieldsPresent []string \`json:"fields_present"\`
}

type StepOutputProjectionWire struct {
\tProjectionID string \`json:"projection_id"\`
\tSourceStepID string \`json:"source_step_id"\`
\tProjectionKind string \`json:"projection_kind"\`
\tContentHash string \`json:"content_hash"\`
\tPayload map[string]any \`json:"payload"\`
\tSafety ProjectionSafetySummaryWire \`json:"safety"\`
}

type WorkflowContextProjectionWire struct {
\tProjectionID string \`json:"projection_id"\`
\tSourceStepID string \`json:"source_step_id"\`
\tProjectionKind StepOutputProjectionKind \`json:"projection_kind"\`
\tContentHash string \`json:"content_hash"\`
\tSafety ProjectionSafetySummaryWire \`json:"safety"\`
}

type WorkflowToolContextWire struct {
\tSchemaVersion string \`json:"schema_version"\`
\tVisibility string \`json:"visibility"\`
\tWorkflowRunRef string \`json:"workflow_run_ref"\`
\tStepID string \`json:"step_id"\`
\tToolID ToolID \`json:"tool_id"\`
\tTaskQueue string \`json:"task_queue,omitempty"\`
\tRequiredProjectionKind StepOutputProjectionKind \`json:"required_projection_kind,omitempty"\`
\tExpectedOutputArtifacts []StepOutputProjectionKind \`json:"expected_output_artifacts"\`
\tProjectionRefs []WorkflowContextProjectionWire \`json:"projection_refs"\`
}

type WorkflowPlanWire struct {
\tSchemaVersion string \`json:"schema_version"\`
\tPlanID string \`json:"plan_id"\`
\tWorkflowMode WorkflowMode \`json:"workflow_mode"\`
\tAllowedTools []ToolID \`json:"allowed_tools"\`
\tSteps []WorkflowPlanStepWire \`json:"steps"\`
\tEdges []WorkflowPlanEdgeWire \`json:"edges"\`
\tTerminalPolicy map[string]any \`json:"terminal_policy"\`
\tResumePolicy map[string]any \`json:"resume_policy"\`
\tSemanticRetryPolicy map[string]any \`json:"semantic_retry_policy"\`
}

type ToolInvocationWire struct {
\tInvocationID string \`json:"invocation_id"\`
\tParentInvocationID string \`json:"parent_invocation_id,omitempty"\`
\tWorkflowRunRef string \`json:"workflow_run_ref"\`
\tStepID string \`json:"step_id"\`
\tToolID ToolID \`json:"tool_id"\`
\tStatus string \`json:"status"\`
\tAllowedTools []string \`json:"allowed_tools"\`
\tUsedTools []string \`json:"used_tools"\`
\tProjectionIDs []string \`json:"projection_ids"\`
\tFailCloseReason string \`json:"fail_close_reason,omitempty"\`
}

type RuntimeDecisionsWire struct {
\tSchemaVersion string \`json:"schema_version"\`
\tEffectiveTool RequestedTool \`json:"effective_tool"\`
\tTaskQueue string \`json:"task_queue"\`
\tRoutingFrame map[string]any \`json:"routing_frame"\`
\tRuntimeDecisionSummary RuntimeDecisionSummaryWire \`json:"runtime_decision_summary"\`
\tScopeGate map[string]any \`json:"scope_gate,omitempty"\`
\tPolicyGate map[string]any \`json:"policy_gate,omitempty"\`
\tContextPreflight map[string]any \`json:"context_preflight,omitempty"\`
\tToolPolicy map[string]any \`json:"tool_policy,omitempty"\`
\tHandoff map[string]any \`json:"handoff,omitempty"\`
\tWorkflowPlan *WorkflowPlanWire \`json:"workflow_plan,omitempty"\`
\tTerminalEnvelope map[string]any \`json:"terminal_envelope,omitempty"\`
}

type ToolExecutionRequestWire struct {
\tExecutionContractVersion string \`json:"execution_contract_version"\`
\tResponseContract string \`json:"response_contract"\`
\tUserGoal string \`json:"user_goal"\`
\tConversationID string \`json:"conversation_id,omitempty"\`
\tTenantID string \`json:"tenant_id,omitempty"\`
\tRequestID string \`json:"request_id"\`
\tSafetyIdentifier *string \`json:"safety_identifier,omitempty"\`
\tEffectiveTool RequestedTool \`json:"effective_tool"\`
\tTaskQueue string \`json:"task_queue"\`
\tRequestedTool RequestedTool \`json:"requested_tool"\`
\tRequestedScope map[string]any \`json:"requested_scope,omitempty"\`
\tTrace map[string]any \`json:"trace"\`
\tActor map[string]any \`json:"actor"\`
\tContext map[string]any \`json:"context"\`
\tVersionQuery map[string]any \`json:"version_query"\`
\tRuntimeDecisions *RuntimeDecisionsWire \`json:"runtime_decisions,omitempty"\`
}

type ToolRequestWire struct {
\tTool ToolID \`json:"tool"\`
\tTaskQueue string \`json:"task_queue,omitempty"\`
\tUserGoal string \`json:"user_goal"\`
\tConversationID string \`json:"conversation_id,omitempty"\`
\tRequestID string \`json:"request_id,omitempty"\`
\tSafetyIdentifier *string \`json:"safety_identifier,omitempty"\`
\tTrace map[string]any \`json:"trace,omitempty"\`
\tActor map[string]any \`json:"actor,omitempty"\`
\tContext map[string]any \`json:"context,omitempty"\`
\tWorkflowContext *WorkflowToolContextWire \`json:"workflow_context,omitempty"\`
\tPayload map[string]any \`json:"payload"\`
\tAllowedTools []ModelVisibleToolName \`json:"allowed_tools"\`
}

type WorkflowTraceSummaryWire struct {
\tRoutingFrame map[string]any \`json:"routing_frame"\`
\tContextResolution map[string]any \`json:"context_resolution"\`
\tPlanningOutcome string \`json:"planning_outcome"\`
\tDirectVsDelegateBranch string \`json:"direct_vs_delegate_branch"\`
\tWorkflowMode WorkflowMode \`json:"workflow_mode"\`
\tHandoff map[string]any \`json:"handoff"\`
\tHandoffChain []map[string]any \`json:"handoff_chain"\`
\tToolInvocations []ToolInvocationWire \`json:"tool_invocations"\`
\tSelectedTool *string \`json:"selected_tool"\`
\tSelectedTools []string \`json:"selected_tools"\`
\tContextProjections []WorkflowContextProjectionWire \`json:"context_projections"\`
\tAnswerArtifactProjectionIDs []string \`json:"answer_artifact_projection_ids"\`
\tAnswerArtifactKinds []StepOutputProjectionKind \`json:"answer_artifact_kinds"\`
\tToolArgumentSummary map[string]any \`json:"tool_argument_summary"\`
\tTraceSteps []map[string]any \`json:"trace_steps,omitempty"\`
\tToolCallSummaries []map[string]any \`json:"tool_call_summaries,omitempty"\`
\tGuardrailOutcomes map[string]any \`json:"guardrail_outcomes"\`
\tFailCloseReason string \`json:"fail_close_reason"\`
\tRuntimeVersions map[string]any \`json:"runtime_versions"\`
\tPolicyArtifactVersions map[string]any \`json:"policy_artifact_versions"\`
}

type StageTimingWire map[StageTimingField]float64

type DebugTraceRefWire struct {
\tSink DebugTraceSink \`json:"sink"\`
\tTraceID *string \`json:"trace_id,omitempty"\`
\tTraceRef string \`json:"trace_ref"\`
\tURL string \`json:"url,omitempty"\`
}

type ToolExecutionResponseWire struct {
\tSelectedTool *ToolID \`json:"selected_tool"\`
\tStatus ExecutionStatus \`json:"status"\`
\tAnswerText string \`json:"answer_text"\`
\tFollowUpQuestion string \`json:"follow_up_question"\`
\tConfidence ConfidenceLevel \`json:"confidence"\`
\tResult map[string]any \`json:"result"\`
\tError map[string]any \`json:"error"\`
\tObservability map[string]any \`json:"observability,omitempty"\`
\tWorkflowTraceSummary *WorkflowTraceSummaryWire \`json:"workflow_trace_summary,omitempty"\`
\tStageTiming StageTimingWire \`json:"stage_timing,omitempty"\`
\tDebugTraceRefs []DebugTraceRefWire \`json:"debug_trace_refs,omitempty"\`
\tTraceID string \`json:"trace_id"\`
}
`;
}

function tsConstArray(name: string, values: string[]): string {
	const inlineArray = `[${values.map((value) => quote(value)).join(", ")}]`;
	const inlineLine = `export const ${name} = ${inlineArray} as const;`;
	if (inlineLine.length <= 100) {
		return `${inlineLine}\n`;
	}
	return `export const ${name} = [\n${values.map((value) => `\t${quote(value)},\n`).join("")}] as const;\n`;
}

function goStringType(name: string, values: string[]): string {
	const constants = values
		.map((value) => `\t${name}${goConstSuffix(value)} ${name} = ${quote(value)}\n`)
		.join("");
	return `type ${name} string\n\nconst (\n${constants})\n\n`;
}

const quote = JSON.stringify;

function gofmt(source: string): string {
	const completed = spawnSync("gofmt", { input: source, encoding: "utf8" });
	if (completed.status !== 0) {
		throw new Error(`gofmt failed: ${completed.stderr}`);
	}
	return completed.stdout;
}
