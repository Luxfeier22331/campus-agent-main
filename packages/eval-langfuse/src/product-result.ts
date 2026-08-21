import { type AgentToolEvalCase, validateAgentToolEvalCases } from "./agent-tool-eval";
import {
	type ExecutionRunEvalProjection,
	parseExecutionRunEvalProjection,
} from "./execution-projection";
import {
	loadJsonObject,
	mapping,
	mappingList,
	stringField,
	stringList,
	writeJsonObject,
} from "./json";

export const AGENT_PRODUCT_EVAL_RESULT_SCHEMA_VERSION = "agent_product_eval_result.v1";

export interface AgentTerminalResult {
	answer: string;
	conversationId: string;
	requestId: string;
	resultKind: string;
	runId: string;
	traceId: string;
}

export interface AgentProductEvalItem {
	case: AgentToolEvalCase;
	projection: ExecutionRunEvalProjection;
	terminal: AgentTerminalResult;
}

export interface AgentProductEvalResult {
	evalRunId: string;
	items: AgentProductEvalItem[];
}

export function loadAgentProductEvalResult(path: string): AgentProductEvalResult {
	return parseAgentProductEvalResult(loadJsonObject(path));
}

export function parseAgentProductEvalResult(
	payload: Record<string, unknown>,
): AgentProductEvalResult {
	if (payload.schema_version !== AGENT_PRODUCT_EVAL_RESULT_SCHEMA_VERSION) {
		throw new Error(
			`product result schema_version must be ${AGENT_PRODUCT_EVAL_RESULT_SCHEMA_VERSION}`,
		);
	}
	const evalRunId = stringField(payload.eval_run_id, "eval_run_id");
	const rawItems = mappingList(payload.items, "items");
	if (rawItems.length === 0) {
		throw new Error("product result items must not be empty");
	}
	const seenCaseIds = new Set<string>();
	const items = rawItems.map((item, index) => {
		const casePayload = mapping(item.case, `items[${index}].case`);
		const validation = validateAgentToolEvalCases({
			cases: [casePayload],
			schema_version: "agent_routing_eval_cases.v1",
		});
		const caseItem = validation.cases[0];
		if (!caseItem) {
			throw new Error(`items[${index}].case is invalid`);
		}
		if (seenCaseIds.has(caseItem.case_id)) {
			throw new Error(`product result case_id is duplicated: ${caseItem.case_id}`);
		}
		seenCaseIds.add(caseItem.case_id);
		const terminal = parseTerminal(item.terminal, caseItem.case_id);
		const projection = parseProductProjection(item.projection, caseItem.case_id);
		if (terminal.runId !== projection.runId || terminal.traceId !== projection.traceId) {
			throw new Error(`${caseItem.case_id} terminal and projection identity do not match`);
		}
		return { case: caseItem, projection, terminal };
	});
	return { evalRunId, items };
}

export function writeAgentProductEvalResult(path: string, input: AgentProductEvalResult): void {
	writeJsonObject(path, {
		eval_run_id: input.evalRunId,
		items: input.items.map((item) => ({
			case: item.case,
			projection: {
				...(item.projection.answer === undefined ? {} : { answer: item.projection.answer }),
				retrieved_context_ids: item.projection.retrievedContextIds,
				retrieved_contexts: item.projection.retrievedContexts,
				run_id: item.projection.runId,
				tool_trajectory: item.projection.toolTrajectory,
				trace_id: item.projection.traceId,
			},
			terminal: {
				answer: item.terminal.answer,
				conversation_id: item.terminal.conversationId,
				request_id: item.terminal.requestId,
				result_kind: item.terminal.resultKind,
				run_id: item.terminal.runId,
				trace_id: item.terminal.traceId,
			},
		})),
		schema_version: AGENT_PRODUCT_EVAL_RESULT_SCHEMA_VERSION,
	});
}

function parseTerminal(value: unknown, caseId: string): AgentTerminalResult {
	const terminal = mapping(value, `${caseId}.terminal`);
	return {
		answer: stringValue(terminal.answer, `${caseId}.terminal.answer`),
		conversationId: stringField(terminal.conversation_id, `${caseId}.terminal.conversation_id`),
		requestId: stringField(terminal.request_id, `${caseId}.terminal.request_id`),
		resultKind: stringField(terminal.result_kind, `${caseId}.terminal.result_kind`),
		runId: stringField(terminal.run_id, `${caseId}.terminal.run_id`),
		traceId: stringField(terminal.trace_id, `${caseId}.terminal.trace_id`),
	};
}

function parseProductProjection(value: unknown, caseId: string): ExecutionRunEvalProjection {
	const projection = mapping(value, `${caseId}.projection`);
	return parseExecutionRunEvalProjection({
		agentRuntimeEvalProjection: {
			rag: {
				...(projection.answer === undefined ? {} : { answer: projection.answer }),
				retrieved_context_ids: stringList(projection.retrieved_context_ids),
				retrieved_contexts: stringList(projection.retrieved_contexts),
			},
			run: {
				run_id: stringField(projection.run_id, `${caseId}.projection.run_id`),
				trace_id: stringField(projection.trace_id, `${caseId}.projection.trace_id`),
			},
			schema_version: "agent_runtime_eval_projection.v3",
			tool_trajectory: projection.tool_trajectory,
		},
	});
}

function stringValue(value: unknown, field: string): string {
	if (typeof value !== "string") {
		throw new Error(`${field} must be a string`);
	}
	return value;
}
