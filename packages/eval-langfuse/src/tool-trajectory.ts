import { isRecord, type JsonObject, mapping, optionalString, stringField } from "./shared";

export type ToolDecisionKind = "direct_answer" | "fail_closed" | "tool_call";
export type ExpectedTool = "direct_answer" | "knowledge_query" | "transport_schedule_lookup";
export type ObservedTool = ExpectedTool | "fail_closed" | "unknown_tool";

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
	tool_name: string;
}

export interface InternalToolTrajectoryCall extends ToolTrajectoryCall {
	candidate_count?: number;
	discarded_count?: number;
	outcome?: string;
	query_hash?: string;
	search_ordinal: number;
}

export interface ToolTrajectory {
	available_tools: string[];
	conversation_id?: string;
	decision_kind: ToolDecisionKind;
	environment?: string;
	fail_close_reason?: string;
	internal_tool_calls: InternalToolTrajectoryCall[];
	release?: string;
	request_id: string;
	run_id: string;
	schema_version: "tool_trajectory.v2";
	selected_tool?: string;
	surface?: string;
	tool_calls: ToolTrajectoryCall[];
	trace_id: string;
}

export function parseToolTrajectory(value: unknown): ToolTrajectory {
	assertNoForbiddenToolTrajectoryFields(value, "$");
	const input = mapping(value, "tool_trajectory");
	const schemaVersion = stringField(input.schema_version, "tool_trajectory.schema_version");
	if (schemaVersion !== "tool_trajectory.v2") {
		throw new Error(`tool_trajectory schema_version ${schemaVersion} is not supported`);
	}
	const decisionKind = parseDecisionKind(input.decision_kind);
	return {
		available_tools: stringArray(input.available_tools),
		conversation_id: optionalString(input.conversation_id) ?? undefined,
		decision_kind: decisionKind,
		environment: optionalString(input.environment) ?? undefined,
		fail_close_reason: optionalString(input.fail_close_reason) ?? undefined,
		internal_tool_calls: parseInternalToolCalls(input.internal_tool_calls),
		release: optionalString(input.release) ?? undefined,
		request_id: stringField(input.request_id, "tool_trajectory.request_id"),
		run_id: stringField(input.run_id, "tool_trajectory.run_id"),
		schema_version: "tool_trajectory.v2",
		selected_tool: optionalString(input.selected_tool) ?? undefined,
		surface: optionalString(input.surface) ?? undefined,
		tool_calls: parseToolCalls(input.tool_calls, "tool_calls"),
		trace_id: stringField(input.trace_id, "tool_trajectory.trace_id"),
	};
}

export function expectedToolFromTrajectory(trajectory: ToolTrajectory): ObservedTool {
	if (trajectory.decision_kind === "direct_answer") {
		return "direct_answer";
	}
	if (trajectory.decision_kind === "fail_closed") {
		return "fail_closed";
	}
	if (trajectory.selected_tool === "knowledge_query") {
		return "knowledge_query";
	}
	if (trajectory.selected_tool === "transport_schedule_lookup") {
		return "transport_schedule_lookup";
	}
	return "unknown_tool";
}

export function scoreToolSelection(
	trajectory: ToolTrajectory,
	expectedTool: ExpectedTool,
): boolean {
	return expectedToolFromTrajectory(trajectory) === expectedTool;
}

function parseDecisionKind(value: unknown): ToolDecisionKind {
	const raw = stringField(value, "tool_trajectory.decision_kind");
	if (raw === "direct_answer" || raw === "fail_closed" || raw === "tool_call") {
		return raw;
	}
	throw new Error(`tool_trajectory decision_kind ${raw} is not supported`);
}

function parseToolCalls(value: unknown, field: string): ToolTrajectoryCall[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((item, index) => {
		const call = mapping(item, `tool_trajectory.${field}[${index}]`);
		return {
			arguments_hash: optionalString(call.arguments_hash) ?? undefined,
			arguments_shape: isRecord(call.arguments_shape) ? { ...call.arguments_shape } : undefined,
			duration_ms: optionalNonNegativeNumber(call.duration_ms),
			eval_safe_args: isRecord(call.eval_safe_args) ? { ...call.eval_safe_args } : undefined,
			fail_close_reason: optionalString(call.fail_close_reason) ?? undefined,
			model: optionalString(call.model) ?? undefined,
			provider: optionalString(call.provider) ?? undefined,
			result_kind: stringField(call.result_kind, `tool_trajectory.${field}[${index}].result_kind`),
			status: stringField(call.status, `tool_trajectory.${field}[${index}].status`),
			tool_call_id: stringField(
				call.tool_call_id,
				`tool_trajectory.${field}[${index}].tool_call_id`,
			),
			tool_name: stringField(call.tool_name, `tool_trajectory.${field}[${index}].tool_name`),
		};
	});
}

function parseInternalToolCalls(value: unknown): InternalToolTrajectoryCall[] {
	return parseToolCalls(value, "internal_tool_calls").map((call, index) => {
		const raw = mapping(
			Array.isArray(value) ? value[index] : undefined,
			`tool_trajectory.internal_tool_calls[${index}]`,
		);
		const searchOrdinal = positiveInteger(
			raw.search_ordinal,
			`tool_trajectory.internal_tool_calls[${index}].search_ordinal`,
		);
		return {
			...call,
			candidate_count: optionalNonNegativeNumber(raw.candidate_count),
			discarded_count: optionalNonNegativeNumber(raw.discarded_count),
			outcome: optionalString(raw.outcome) ?? undefined,
			query_hash: optionalString(raw.query_hash) ?? undefined,
			search_ordinal: searchOrdinal,
		};
	});
}

function positiveInteger(value: unknown, field: string): number {
	if (!(typeof value === "number" && Number.isInteger(value) && value > 0)) {
		throw new Error(`${field} must be a positive integer`);
	}
	return value;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((item) => optionalString(item)).filter((item): item is string => Boolean(item));
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
