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

function contractMeta(contract: Record<string, unknown>): Record<string, string> {
	const meta = contract["x-campus-contract"];
	if (!isRecord(meta)) {
		throw new Error("x-campus-contract metadata is required");
	}
	const result: Record<string, string> = {};
	for (const key of [
		"execution_contract_version",
		"response_contract",
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
		`\tworkflowTraceSummaryVersion: ${quote(meta.workflow_trace_summary_version)},\n` +
		"} as const;\n\n" +
		tsConstArray("TOOL_IDS", enumValues(contract, "ToolID")) +
		tsConstArray("MODEL_VISIBLE_TOOL_NAMES", enumValues(contract, "ModelVisibleToolName")) +
		tsConstArray("REQUESTED_TOOLS", enumValues(contract, "RequestedTool")) +
		tsConstArray("CONFIDENCE_LEVELS", enumValues(contract, "ConfidenceLevel")) +
		tsConstArray("EXECUTION_STATUSES", enumValues(contract, "ExecutionStatus")) +
		tsConstArray("WORKFLOW_MODES", enumValues(contract, "WorkflowMode")) +
		tsConstArray("ANSWER_ARTIFACT_KINDS", enumValues(contract, "AnswerArtifactKind")) +
		tsConstArray("STAGE_TIMING_FIELDS", stageTimingFields(contract)) +
		tsWireTypes()
	);
}

function tsWireTypes(): string {
	return `
export type ToolID = (typeof TOOL_IDS)[number];
export type ModelVisibleToolName = (typeof MODEL_VISIBLE_TOOL_NAMES)[number];
export type RequestedTool = (typeof REQUESTED_TOOLS)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type WorkflowMode = (typeof WORKFLOW_MODES)[number];
export type AnswerArtifactKind = (typeof ANSWER_ARTIFACT_KINDS)[number];

export type StageTimingField = (typeof STAGE_TIMING_FIELDS)[number];
export type StageTimingWire = Partial<Record<StageTimingField, number>>;
export type SafeRecord = Record<string, unknown>;

export interface ConversationContextWire {
\tschema_version: "conversation_context.v1";
\tconversation_id: string;
\tuser_message_id: string;
\tparent_message_id?: string | null;
\tcurrent_user_message: { role: "user"; content: string; created_at: string };
\trecent_turns: SafeRecord[];
\tprevious_evidence_refs: SafeRecord[];
\tprevious_tool_results: SafeRecord[];
\tsession_state: SafeRecord;
}

export interface TraceContextWire {
\ttrace_id: string;
}

export interface ExecutionPayloadWire {
\texecution_contract_version: typeof TOOL_EXECUTION_CONTRACT.executionContractVersion;
\tresponse_contract: typeof TOOL_EXECUTION_CONTRACT.responseContract;
\tuser_goal: string;
\tconversation_id: string;
\ttenant_id?: string;
\trequest_id: string;
\tsafety_identifier?: string | null;
\trequested_tool?: RequestedTool;
\ttrace: TraceContextWire;
\tcontext: SafeRecord;
}

export interface ExecutionRunMetadataWire {
\texecution_payload: ExecutionPayloadWire;
}

export interface ExecutionRunCreateRequestWire {
\trun_id: string;
\tconversation_id: string;
\tturn_id: string;
\trequest_id: string;
\ttrace_id?: string;
\towner_user_id: string;
\tsurface: string;
\truntime_versions?: SafeRecord;
\tmetadata: ExecutionRunMetadataWire;
}

export interface ToolExecutionWorkflowTraceSummaryWire {
\tworkflow_mode: WorkflowMode;
\tselected_tool: ToolID | null;
\tselected_tools: string[];
\tfirst_decision_actor: string;
\tplanning_outcome: string;
\tdirect_vs_delegate_branch: string;
\tterminal_reason: string;
\tanswer_artifact_kinds: AnswerArtifactKind[];
\tanswer_artifact_refs: string[];
\ttrace_steps: SafeRecord[];
\ttool_call_summaries: SafeRecord[];
\truntime_versions: SafeRecord;
}

export interface SessionUpdateSlotWire {
\tconfirmed: true;
\tname: "curriculum_program" | "curriculum_program_family" | "curriculum_semester";
\tvalue: string;
}

export interface SessionUpdateWire {
\tupsert_slots: SessionUpdateSlotWire[];
}

export interface ToolExecutionResponseWire {
\tselected_tool: ToolID | null;
\tstatus: ExecutionStatus;
\tanswer_text: string;
\tfollow_up_question: string;
\tconfidence: ConfidenceLevel;
\tresolved_targets: string[];
\tsession_update: SessionUpdateWire | null;
\tresult: SafeRecord | null;
\terror: { code: string; message: string; retryable: boolean } | null;
\tobservability?: SafeRecord | null;
\tworkflow_trace_summary?: ToolExecutionWorkflowTraceSummaryWire | null;
\tstage_timing?: StageTimingWire | null;
\ttrace_id: string;
}
`;
}

function generateGo(contract: Record<string, unknown>): string {
	const meta = contractMeta(contract);
	const toolIds = enumValues(contract, "ToolID");
	const requestedTools = enumValues(contract, "RequestedTool");
	const workflowModes = enumValues(contract, "WorkflowMode");
	const answerArtifactKinds = enumValues(contract, "AnswerArtifactKind");
	const stageFields = stageTimingFields(contract);
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
			`\tWorkflowTraceSummaryVersion = ${quote(meta.workflow_trace_summary_version)}\n` +
			")\n\n" +
			goStringType("ToolID", toolIds) +
			goStringType("ModelVisibleToolName", enumValues(contract, "ModelVisibleToolName")) +
			goStringType("RequestedTool", requestedTools) +
			goStringType("ConfidenceLevel", enumValues(contract, "ConfidenceLevel")) +
			goStringType("ExecutionStatus", enumValues(contract, "ExecutionStatus")) +
			goStringType("WorkflowMode", workflowModes) +
			goStringType("AnswerArtifactKind", answerArtifactKinds) +
			goStringType("StageTimingField", stageFields) +
			goWireTypes() +
			goDecodeHelpers({
				answerArtifactKinds,
				toolIds,
				requestedTools,
				workflowModes,
				stageTimingFields: stageFields,
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
\tPreviousEvidenceRefs []map[string]any \`json:"previous_evidence_refs"\`
\tPreviousToolResults []map[string]any \`json:"previous_tool_results"\`
\tSessionState map[string]any \`json:"session_state"\`
}

type TraceContextWire struct {
\tTraceID string \`json:"trace_id"\`
}

type ExecutionPayloadWire struct {
\tExecutionContractVersion string \`json:"execution_contract_version"\`
\tResponseContract string \`json:"response_contract"\`
\tUserGoal string \`json:"user_goal"\`
\tConversationID string \`json:"conversation_id"\`
\tTenantID string \`json:"tenant_id,omitempty"\`
\tRequestID string \`json:"request_id"\`
\tSafetyIdentifier *string \`json:"safety_identifier,omitempty"\`
\tRequestedTool RequestedTool \`json:"requested_tool,omitempty"\`
\tTrace TraceContextWire \`json:"trace"\`
\tContext map[string]any \`json:"context"\`
}

type ExecutionRunMetadataWire struct {
\tExecutionPayload ExecutionPayloadWire \`json:"execution_payload"\`
}

type ExecutionRunCreateRequestWire struct {
\tRunID string \`json:"run_id"\`
\tConversationID string \`json:"conversation_id"\`
\tTurnID string \`json:"turn_id"\`
\tRequestID string \`json:"request_id"\`
\tTraceID string \`json:"trace_id,omitempty"\`
\tOwnerUserID string \`json:"owner_user_id"\`
\tSurface string \`json:"surface"\`
\tRuntimeVersions map[string]any \`json:"runtime_versions,omitempty"\`
\tMetadata ExecutionRunMetadataWire \`json:"metadata"\`
}

type WorkflowTraceSummaryWire struct {
\tWorkflowMode WorkflowMode \`json:"workflow_mode"\`
\tSelectedTool *string \`json:"selected_tool"\`
\tSelectedTools []string \`json:"selected_tools"\`
\tFirstDecisionActor string \`json:"first_decision_actor"\`
\tPlanningOutcome string \`json:"planning_outcome"\`
\tDirectVsDelegateBranch string \`json:"direct_vs_delegate_branch"\`
\tTerminalReason string \`json:"terminal_reason"\`
\tAnswerArtifactKinds []AnswerArtifactKind \`json:"answer_artifact_kinds"\`
\tAnswerArtifactRefs []string \`json:"answer_artifact_refs"\`
\tTraceSteps []map[string]any \`json:"trace_steps"\`
\tToolCallSummaries []map[string]any \`json:"tool_call_summaries"\`
\tRuntimeVersions map[string]any \`json:"runtime_versions"\`
}

type StageTimingWire map[StageTimingField]float64

type SessionUpdateSlotWire struct {
\tConfirmed bool \`json:"confirmed"\`
\tName string \`json:"name"\`
\tValue string \`json:"value"\`
}

type SessionUpdateWire struct {
\tUpsertSlots []SessionUpdateSlotWire \`json:"upsert_slots"\`
}

type ToolExecutionResponseWire struct {
\tSelectedTool *ToolID \`json:"selected_tool"\`
\tStatus ExecutionStatus \`json:"status"\`
\tAnswerText string \`json:"answer_text"\`
\tFollowUpQuestion string \`json:"follow_up_question"\`
\tConfidence ConfidenceLevel \`json:"confidence"\`
\tResolvedTargets []string \`json:"resolved_targets"\`
\tSessionUpdate *SessionUpdateWire \`json:"session_update"\`
\tResult map[string]any \`json:"result"\`
\tError map[string]any \`json:"error"\`
\tObservability map[string]any \`json:"observability,omitempty"\`
\tWorkflowTraceSummary *WorkflowTraceSummaryWire \`json:"workflow_trace_summary,omitempty"\`
\tStageTiming StageTimingWire \`json:"stage_timing,omitempty"\`
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
