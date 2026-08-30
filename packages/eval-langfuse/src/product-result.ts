import { type AgentToolEvalCase, validateAgentToolEvalCases } from "./agent-tool-eval";
import {
	loadJsonObject,
	mappingList,
	requiredStringList,
	stringField,
	writeJsonObject,
} from "./json";
import { parseToolTrajectory, type ToolTrajectory } from "./tool-trajectory";

export const AGENT_PRODUCT_EVAL_RESULT_SCHEMA_VERSION = "agent_product_eval_result.v3";

export interface AgentProductEvalItem {
	answer: string;
	citedContextIds: string[];
	citedContexts: string[];
	case: AgentToolEvalCase;
	requestId: string;
	retrievedContextIds: string[];
	retrievedContexts: string[];
	toolTrajectory: ToolTrajectory;
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
	const seenRequestIds = new Set<string>();
	const items = rawItems.map((item, index) => {
		const validation = validateAgentToolEvalCases({
			cases: [item.case],
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
		const requestId = stringField(item.request_id, `${caseItem.case_id}.request_id`);
		if (seenRequestIds.has(requestId)) {
			throw new Error(`product result request_id is duplicated: ${requestId}`);
		}
		seenRequestIds.add(requestId);
		const retrievedContextIds = requiredStringList(
			item.retrieved_context_ids,
			`${caseItem.case_id}.retrieved_context_ids`,
		);
		const retrievedContexts = requiredStringList(
			item.retrieved_contexts,
			`${caseItem.case_id}.retrieved_contexts`,
		);
		const citedContextIds = requiredStringList(
			item.cited_context_ids,
			`${caseItem.case_id}.cited_context_ids`,
		);
		const citedContexts = requiredStringList(
			item.cited_contexts,
			`${caseItem.case_id}.cited_contexts`,
		);
		if (retrievedContextIds.length !== retrievedContexts.length) {
			throw new Error(`${caseItem.case_id} retrieved context ids and contexts must align`);
		}
		if (citedContextIds.length !== citedContexts.length) {
			throw new Error(`${caseItem.case_id} cited context ids and contexts must align`);
		}
		return {
			answer: stringField(item.answer, `${caseItem.case_id}.answer`),
			citedContextIds,
			citedContexts,
			case: caseItem,
			requestId,
			retrievedContextIds,
			retrievedContexts,
			toolTrajectory: parseToolTrajectory(item.tool_trajectory),
		};
	});
	return { evalRunId, items };
}

export function writeAgentProductEvalResult(path: string, input: AgentProductEvalResult): void {
	writeJsonObject(path, {
		eval_run_id: input.evalRunId,
		items: input.items.map((item) => ({
			answer: item.answer,
			cited_context_ids: item.citedContextIds,
			cited_contexts: item.citedContexts,
			case: item.case,
			request_id: item.requestId,
			retrieved_context_ids: item.retrievedContextIds,
			retrieved_contexts: item.retrievedContexts,
			tool_trajectory: item.toolTrajectory,
		})),
		schema_version: AGENT_PRODUCT_EVAL_RESULT_SCHEMA_VERSION,
	});
}
