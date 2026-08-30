import { mapping, requiredStringList, stringField } from "./json";
import { parseToolTrajectory, type ToolTrajectory } from "./tool-trajectory";

export interface ExecutionRunEvalProjection {
	answer: string;
	citedContextIds: string[];
	citedContexts: string[];
	requestId: string;
	retrievedContextIds: string[];
	retrievedContexts: string[];
	toolTrajectory: ToolTrajectory;
}

export function parseExecutionRunEvalProjection(value: unknown): ExecutionRunEvalProjection {
	const payload = mapping(value, "run steps payload");
	const projection = mapping(
		payload.agentRuntimeEvalProjection ?? payload.agent_runtime_eval_projection ?? payload,
		"agent runtime eval projection",
	);
	if (projection.schema_version !== "agent_runtime_eval_projection.v5") {
		throw new Error("agent runtime eval projection must use agent_runtime_eval_projection.v5");
	}
	const citedContextIds = requiredStringList(
		projection.cited_context_ids,
		"agent runtime eval projection.cited_context_ids",
	);
	const citedContexts = requiredStringList(
		projection.cited_contexts,
		"agent runtime eval projection.cited_contexts",
	);
	if (citedContextIds.length !== citedContexts.length) {
		throw new Error(
			"agent runtime eval projection cited context ids and contexts must have equal length",
		);
	}
	const retrievedContextIds = requiredStringList(
		projection.retrieved_context_ids,
		"agent runtime eval projection.retrieved_context_ids",
	);
	const retrievedContexts = requiredStringList(
		projection.retrieved_contexts,
		"agent runtime eval projection.retrieved_contexts",
	);
	if (retrievedContextIds.length !== retrievedContexts.length) {
		throw new Error(
			"agent runtime eval projection retrieved context ids and contexts must have equal length",
		);
	}
	return {
		answer: stringField(projection.answer, "agent runtime eval projection.answer"),
		citedContextIds,
		citedContexts,
		requestId: stringField(projection.request_id, "agent runtime eval projection.request_id"),
		retrievedContextIds,
		retrievedContexts,
		toolTrajectory: parseToolTrajectory(projection.tool_trajectory),
	};
}
