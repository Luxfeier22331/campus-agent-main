import { isRecord, type JsonObject, mapping, optionalString, stringField } from "./json";

export const AGENT_RUNTIME_TOOL_NAMES = ["personal_memory_recall"] as const;

export type AgentRuntimeToolName = (typeof AGENT_RUNTIME_TOOL_NAMES)[number];
export type ToolDecisionKind = "direct_answer" | "fail_closed" | "tool_assisted";

export interface ToolTrajectoryCall {
	arguments_hash?: string;
	arguments_shape?: JsonObject;
	duration_ms?: number;
	eval_safe_args?: JsonObject;
	fail_close_reason?: string;
	model?: string;
	provider?: string;
	result_kind: string;
	status: string;
	tool_call_id: string;
	tool_name: AgentRuntimeToolName;
}

export interface ToolTrajectory {
	available_tools: AgentRuntimeToolName[];
	conversation_id?: string;
	decision_kind: ToolDecisionKind;
	environment?: string;
	fail_close_reason?: string;
	release?: string;
	request_id: string;
	run_id: string;
	schema_version: "tool_trajectory.v3";
	surface?: string;
	tool_calls: ToolTrajectoryCall[];
	trace_id: string;
}

const agentRuntimeToolNames = new Set<string>(AGENT_RUNTIME_TOOL_NAMES);

export function parseToolTrajectory(value: unknown): ToolTrajectory {
	assertNoForbiddenToolTrajectoryFields(value, "$");
	const input = mapping(value, "tool_trajectory");
	const schemaVersion = stringField(input.schema_version, "tool_trajectory.schema_version");
	if (schemaVersion !== "tool_trajectory.v3") {
		throw new Error(`tool_trajectory schema_version ${schemaVersion} is not supported`);
	}
	const decisionKind = parseDecisionKind(input.decision_kind);
	const toolCalls = parseToolCalls(input.tool_calls);
	if (decisionKind === "direct_answer" && toolCalls.length > 0) {
		throw new Error("direct_answer trajectory must not contain tool calls");
	}
	if (decisionKind === "tool_assisted" && toolCalls.length === 0) {
		throw new Error("tool_assisted trajectory must contain at least one tool call");
	}
	const conversationId = optionalString(input.conversation_id);
	const environment = optionalString(input.environment);
	const failCloseReason = optionalString(input.fail_close_reason);
	const release = optionalString(input.release);
	const surface = optionalString(input.surface);
	return {
		available_tools: parseToolNames(input.available_tools, "tool_trajectory.available_tools"),
		...(conversationId ? { conversation_id: conversationId } : {}),
		decision_kind: decisionKind,
		...(environment ? { environment } : {}),
		...(failCloseReason ? { fail_close_reason: failCloseReason } : {}),
		...(release ? { release } : {}),
		request_id: stringField(input.request_id, "tool_trajectory.request_id"),
		run_id: stringField(input.run_id, "tool_trajectory.run_id"),
		schema_version: "tool_trajectory.v3",
		...(surface ? { surface } : {}),
		tool_calls: toolCalls,
		trace_id: stringField(input.trace_id, "tool_trajectory.trace_id"),
	};
}

export function toolSequenceFromTrajectory(trajectory: ToolTrajectory): AgentRuntimeToolName[] {
	return trajectory.tool_calls.map((call) => call.tool_name);
}

export function scoreToolSequence(
	trajectory: ToolTrajectory,
	expectedTools: readonly AgentRuntimeToolName[],
): boolean {
	const observed = toolSequenceFromTrajectory(trajectory);
	return (
		observed.length === expectedTools.length &&
		observed.every((toolName, index) => toolName === expectedTools[index])
	);
}

export function parseAgentRuntimeToolName(value: unknown, field: string): AgentRuntimeToolName {
	const toolName = stringField(value, field);
	if (!agentRuntimeToolNames.has(toolName)) {
		throw new Error(`${field} ${toolName} is not an active agent runtime tool`);
	}
	return toolName as AgentRuntimeToolName;
}

function parseDecisionKind(value: unknown): ToolDecisionKind {
	const raw = stringField(value, "tool_trajectory.decision_kind");
	if (raw === "direct_answer" || raw === "fail_closed" || raw === "tool_assisted") {
		return raw;
	}
	throw new Error(`tool_trajectory decision_kind ${raw} is not supported`);
}

function parseToolCalls(value: unknown): ToolTrajectoryCall[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((item, index) => {
		const call = mapping(item, `tool_trajectory.tool_calls[${index}]`);
		const argumentsHash = optionalString(call.arguments_hash);
		const durationMs = optionalNonNegativeNumber(call.duration_ms);
		const failCloseReason = optionalString(call.fail_close_reason);
		const model = optionalString(call.model);
		const provider = optionalString(call.provider);
		return {
			...(argumentsHash ? { arguments_hash: argumentsHash } : {}),
			...(isRecord(call.arguments_shape) ? { arguments_shape: { ...call.arguments_shape } } : {}),
			...(durationMs === undefined ? {} : { duration_ms: durationMs }),
			...(isRecord(call.eval_safe_args) ? { eval_safe_args: { ...call.eval_safe_args } } : {}),
			...(failCloseReason ? { fail_close_reason: failCloseReason } : {}),
			...(model ? { model } : {}),
			...(provider ? { provider } : {}),
			result_kind: stringField(
				call.result_kind,
				`tool_trajectory.tool_calls[${index}].result_kind`,
			),
			status: stringField(call.status, `tool_trajectory.tool_calls[${index}].status`),
			tool_call_id: stringField(
				call.tool_call_id,
				`tool_trajectory.tool_calls[${index}].tool_call_id`,
			),
			tool_name: parseAgentRuntimeToolName(
				call.tool_name,
				`tool_trajectory.tool_calls[${index}].tool_name`,
			),
		};
	});
}

function parseToolNames(value: unknown, field: string): AgentRuntimeToolName[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((item, index) => parseAgentRuntimeToolName(item, `${field}[${index}]`));
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function assertNoForbiddenToolTrajectoryFields(value: unknown, path: string): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoForbiddenToolTrajectoryFields(item, `${path}[${index}]`);
		}
		return;
	}
	if (!isRecord(value)) {
		return;
	}
	for (const [key, nested] of Object.entries(value)) {
		if (isForbiddenToolTrajectoryKey(key)) {
			throw new Error(`forbidden tool_trajectory field at ${path}.${key}`);
		}
		assertNoForbiddenToolTrajectoryFields(nested, `${path}.${key}`);
	}
}

function isForbiddenToolTrajectoryKey(key: string): boolean {
	const normalized = key.toLowerCase().trim();
	return (
		normalized === "selected_tool" ||
		normalized === "internal_tool_calls" ||
		normalized === "bank_id" ||
		normalized === "context_block" ||
		normalized === "hindsight_id" ||
		normalized === "memory_content" ||
		normalized === "memory_text" ||
		normalized === "operation_id" ||
		normalized.includes("raw_prompt") ||
		normalized.includes("raw_transcript") ||
		normalized.includes("raw_provider") ||
		normalized.includes("raw_source") ||
		normalized.includes("source_body") ||
		normalized.includes("authorization") ||
		normalized.includes("cookie") ||
		normalized.includes("api_key") ||
		normalized.includes("secret") ||
		normalized.includes("database_url") ||
		normalized.includes("object_store")
	);
}
