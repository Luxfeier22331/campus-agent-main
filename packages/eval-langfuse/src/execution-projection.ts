import { mapping, optionalString, stringField, stringList } from "./json";
import { parseToolTrajectory, type ToolTrajectory } from "./tool-trajectory";

export interface ExecutionRunEvalProjection {
	answer?: string;
	retrievedContextIds: string[];
	retrievedContexts: string[];
	runId: string;
	toolTrajectory: ToolTrajectory;
	traceId: string;
}

export function parseExecutionRunEvalProjection(value: unknown): ExecutionRunEvalProjection {
	const payload = mapping(value, "run steps payload");
	const projection = mapping(
		payload.agentRuntimeEvalProjection ?? payload.agent_runtime_eval_projection ?? payload,
		"agent runtime eval projection",
	);
	if (projection.schema_version !== "agent_runtime_eval_projection.v3") {
		throw new Error("agent runtime eval projection must use agent_runtime_eval_projection.v3");
	}
	const run = mapping(projection.run, "agent runtime eval projection.run");
	const rag = mapping(projection.rag ?? {}, "agent runtime eval projection.rag");
	const toolTrajectory = parseToolTrajectory(projection.tool_trajectory);
	const runId = stringField(run.run_id, "agent runtime eval projection.run.run_id");
	const traceId = stringField(run.trace_id, "agent runtime eval projection.run.trace_id");
	if (toolTrajectory.run_id !== runId || toolTrajectory.trace_id !== traceId) {
		throw new Error("tool trajectory identity does not match agent runtime eval projection run");
	}
	const answer = optionalString(rag.answer);
	const retrievedContextIds = stringList(rag.retrieved_context_ids);
	const retrievedContexts = stringList(rag.retrieved_contexts);
	if (retrievedContextIds.length !== retrievedContexts.length) {
		throw new Error(
			"agent runtime eval projection retrieved context ids and contexts must have equal length",
		);
	}
	return {
		...(answer ? { answer } : {}),
		retrievedContextIds,
		retrievedContexts,
		runId,
		toolTrajectory,
		traceId,
	};
}
