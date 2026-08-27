import { mapping, stringField, stringList } from "./json";
import { parseToolTrajectory, type ToolTrajectory } from "./tool-trajectory";

export interface ExecutionRunEvalProjection {
	answer: string;
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
	if (projection.schema_version !== "agent_runtime_eval_projection.v4") {
		throw new Error("agent runtime eval projection must use agent_runtime_eval_projection.v4");
	}
	const retrievedContextIds = stringList(projection.retrieved_context_ids);
	const retrievedContexts = stringList(projection.retrieved_contexts);
	if (retrievedContextIds.length !== retrievedContexts.length) {
		throw new Error(
			"agent runtime eval projection retrieved context ids and contexts must have equal length",
		);
	}
	return {
		answer: stringField(projection.answer, "agent runtime eval projection.answer"),
		requestId: stringField(projection.request_id, "agent runtime eval projection.request_id"),
		retrievedContextIds,
		retrievedContexts,
		toolTrajectory: parseToolTrajectory(projection.tool_trajectory),
	};
}
