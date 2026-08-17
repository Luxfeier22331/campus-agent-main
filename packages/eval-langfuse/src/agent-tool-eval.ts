import {
	isRecord,
	type JsonObject,
	mapping,
	mappingList,
	optionalString,
	stringField,
	stringList,
} from "./json";
import { type AgentRuntimeToolName, parseAgentRuntimeToolName } from "./tool-trajectory";

export const AGENT_TOOL_EVAL_DATASET_SCHEMA_VERSION = "agent_tool_eval_dataset.v1";
export type AgentToolEvalArgumentMode = "eval_safe_args" | "name_only";

export interface AgentToolEvalToolCall extends JsonObject {
	args: JsonObject;
	name: AgentRuntimeToolName;
}

export interface AgentToolEvalCase extends JsonObject {
	argument_mode: AgentToolEvalArgumentMode;
	case_family?: string;
	case_id: string;
	dataset_item_id: string;
	expected_outcome?: "answer" | "clarification" | "no_answer";
	forbidden_context_ids: string[];
	query: string;
	reference?: string;
	reference_context_ids: string[];
	reference_contexts: string[];
	reference_tool_calls: AgentToolEvalToolCall[];
	setup_turns: string[];
	surface_key?: string;
}

export interface AgentToolEvalDatasetValidationResult extends JsonObject {
	case_count: number;
	cases: AgentToolEvalCase[];
	schema_version: string;
	tool_counts: Record<string, number>;
}

export function validateAgentToolEvalDataset(
	payload: JsonObject,
): AgentToolEvalDatasetValidationResult {
	const rawItems = mappingList(payload.items, "dataset.items");
	if (rawItems.length === 0) {
		throw new Error("dataset.items must not be empty");
	}
	const seenCaseIds = new Set<string>();
	const toolCounts: Record<string, number> = {};
	const cases = rawItems.map((item, index) => {
		const parsed = parseDatasetItem(item, index);
		if (seenCaseIds.has(parsed.case_id)) {
			throw new Error(`dataset.items[${index}].case_id is duplicated: ${parsed.case_id}`);
		}
		seenCaseIds.add(parsed.case_id);
		const expectedTool = parsed.reference_tool_calls[0]?.name ?? "direct_answer";
		toolCounts[expectedTool] = (toolCounts[expectedTool] ?? 0) + 1;
		return parsed;
	});
	return {
		case_count: cases.length,
		cases,
		schema_version: AGENT_TOOL_EVAL_DATASET_SCHEMA_VERSION,
		tool_counts: toolCounts,
	};
}

function parseDatasetItem(item: JsonObject, index: number): AgentToolEvalCase {
	const input = mapping(item.input, `dataset.items[${index}].input`);
	const expectedOutput = mapping(item.expectedOutput, `dataset.items[${index}].expectedOutput`);
	const metadata = isRecord(item.metadata) ? item.metadata : {};
	const caseId =
		optionalString(metadata.case_id) ??
		optionalString(input.case_id) ??
		stringField(item.id, `dataset.items[${index}].id`);
	const argumentMode = parseArgumentMode(metadata.argument_mode, caseId);
	const referenceToolCalls = mappingList(
		expectedOutput.reference_tool_calls,
		`${caseId}.expectedOutput.reference_tool_calls`,
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
	const caseFamily = optionalString(metadata.case_family);
	const expectedOutcome = parseExpectedOutcome(expectedOutput.expected_outcome, caseId);
	const reference = optionalString(expectedOutput.reference);
	const surfaceKey = optionalString(metadata.surface_key);
	return {
		argument_mode: argumentMode,
		...(caseFamily ? { case_family: caseFamily } : {}),
		case_id: caseId,
		dataset_item_id: stringField(item.id, `${caseId}.dataset_item_id`),
		...(expectedOutcome ? { expected_outcome: expectedOutcome } : {}),
		forbidden_context_ids: stringList(expectedOutput.forbidden_context_ids),
		query: stringField(input.query ?? input.user_input, `${caseId}.input.query`),
		...(reference ? { reference } : {}),
		reference_context_ids: stringList(expectedOutput.reference_context_ids),
		reference_contexts: stringList(expectedOutput.reference_contexts),
		reference_tool_calls: referenceToolCalls,
		setup_turns: parseSetupTurns(input.setup_turns, caseId),
		...(surfaceKey ? { surface_key: surfaceKey } : {}),
	};
}

function parseExpectedOutcome(
	value: unknown,
	caseId: string,
): AgentToolEvalCase["expected_outcome"] {
	const outcome = optionalString(value);
	if (!outcome) {
		return;
	}
	if (outcome === "answer" || outcome === "clarification" || outcome === "no_answer") {
		return outcome;
	}
	throw new Error(`${caseId}.expected_outcome must be answer, clarification, or no_answer`);
}

function parseSetupTurns(value: unknown, caseId: string): string[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error(`${caseId}.input.setup_turns must be a list`);
	}
	return value.map((turn, index) => stringField(turn, `${caseId}.input.setup_turns[${index}]`));
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
