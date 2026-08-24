import {
	isRecord,
	type JsonObject,
	loadJsonObject,
	mappingList,
	optionalString,
	stringField,
	stringList,
} from "./json";
import { type AgentRuntimeToolName, parseAgentRuntimeToolName } from "./tool-trajectory";

export const AGENT_TOOL_EVAL_CASES_SCHEMA_VERSION = "agent_routing_eval_cases.v1";
export type AgentToolEvalArgumentMode = "eval_safe_args" | "name_only";

export interface AgentToolEvalToolCall extends JsonObject {
	args: JsonObject;
	name: AgentRuntimeToolName;
}

export interface AgentToolEvalCase extends JsonObject {
	argument_mode: AgentToolEvalArgumentMode;
	case_family?: string;
	case_id: string;
	forbidden_context_ids: string[];
	query: string;
	reference?: string;
	reference_context_ids: string[];
	reference_contexts: string[];
	reference_tool_calls: AgentToolEvalToolCall[];
	setup_turns: string[];
	split?: string;
	surface_key?: string;
}

export interface AgentToolEvalCasesValidationResult extends JsonObject {
	case_count: number;
	cases: AgentToolEvalCase[];
	schema_version: string;
	tool_counts: Record<string, number>;
}

export function loadAgentToolEvalCases(path: string): AgentToolEvalCasesValidationResult {
	return validateAgentToolEvalCases(loadJsonObject(path));
}

export function validateAgentToolEvalCases(
	payload: JsonObject,
): AgentToolEvalCasesValidationResult {
	if (payload.schema_version !== AGENT_TOOL_EVAL_CASES_SCHEMA_VERSION) {
		throw new Error(`cases schema_version must be ${AGENT_TOOL_EVAL_CASES_SCHEMA_VERSION}`);
	}
	const rawCases = mappingList(payload.cases, "cases");
	if (rawCases.length === 0) {
		throw new Error("cases must not be empty");
	}
	const seenCaseIds = new Set<string>();
	const toolCounts: Record<string, number> = {};
	const defaultSurfaceKey = optionalString(payload.surface);
	const cases = rawCases.map((item, index) => {
		const parsed = parseCase(item, index, defaultSurfaceKey);
		if (seenCaseIds.has(parsed.case_id)) {
			throw new Error(`cases[${index}].case_id is duplicated: ${parsed.case_id}`);
		}
		seenCaseIds.add(parsed.case_id);
		const expectedTool = parsed.reference_tool_calls[0]?.name ?? "direct_answer";
		toolCounts[expectedTool] = (toolCounts[expectedTool] ?? 0) + 1;
		return parsed;
	});
	return {
		case_count: cases.length,
		cases,
		schema_version: AGENT_TOOL_EVAL_CASES_SCHEMA_VERSION,
		tool_counts: toolCounts,
	};
}

function parseCase(
	item: JsonObject,
	index: number,
	defaultSurfaceKey: string | null,
): AgentToolEvalCase {
	const caseId = stringField(item.case_id, `cases[${index}].case_id`);
	const argumentMode = parseArgumentMode(item.argument_mode, caseId);
	const referenceToolCalls = mappingList(
		item.reference_tool_calls ?? [],
		`${caseId}.reference_tool_calls`,
	).map((toolCall, toolIndex) =>
		parseToolCall(toolCall, `${caseId}.reference_tool_calls[${toolIndex}]`),
	);
	if (argumentMode === "eval_safe_args") {
		for (const toolCall of referenceToolCalls) {
			if (Object.keys(toolCall.args).length === 0) {
				throw new Error(`${caseId} eval_safe_args requires non-empty reference tool args`);
			}
		}
	}
	const caseFamily = optionalString(item.case_family);
	const reference = optionalString(item.reference);
	const split = optionalString(item.split);
	const surfaceKey = optionalString(item.surface_key) ?? defaultSurfaceKey;
	return {
		argument_mode: argumentMode,
		...(caseFamily ? { case_family: caseFamily } : {}),
		case_id: caseId,
		forbidden_context_ids: stringList(item.forbidden_context_ids),
		query: stringField(item.query ?? item.user_input, `${caseId}.query`),
		...(reference ? { reference } : {}),
		reference_context_ids: stringList(item.reference_context_ids),
		reference_contexts: stringList(item.reference_contexts),
		reference_tool_calls: referenceToolCalls,
		setup_turns: parseSetupTurns(item.setup_turns, caseId),
		...(split ? { split } : {}),
		...(surfaceKey ? { surface_key: surfaceKey } : {}),
	};
}

function parseSetupTurns(value: unknown, caseId: string): string[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error(`${caseId}.setup_turns must be a list`);
	}
	return value.map((turn, index) => stringField(turn, `${caseId}.setup_turns[${index}]`));
}

function parseArgumentMode(value: unknown, caseId: string): AgentToolEvalArgumentMode {
	const mode = optionalString(value) ?? "name_only";
	if (mode === "name_only" || mode === "eval_safe_args") {
		return mode;
	}
	throw new Error(`${caseId}.argument_mode must be name_only or eval_safe_args`);
}

function parseToolCall(value: JsonObject, field: string): AgentToolEvalToolCall {
	const args = value.args ?? {};
	if (!isRecord(args)) {
		throw new Error(`${field}.args must be an object`);
	}
	return {
		args: { ...args },
		name: parseAgentRuntimeToolName(value.name, `${field}.name`),
	};
}
