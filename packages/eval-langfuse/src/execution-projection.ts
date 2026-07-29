import { type JsonObject, mapping, optionalString, stringField, stringList } from "./shared";
import { parseToolTrajectory, type ToolTrajectory } from "./tool-trajectory";

export interface ExecutionRunEvalProjection {
	answer?: string;
	coveredScopes: string[];
	groundingMode?: "none" | "single_scope" | "multi_scope";
	groundingStatus?: "not_required" | "empty" | "partial" | "ready";
	retrievedContextIds: string[];
	retrievedContexts: string[];
	runId: string;
	selectedScopes: string[];
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
	return {
		answer: optionalString(rag.answer) ?? undefined,
		coveredScopes: stringList(rag.covered_scopes),
		groundingMode: groundingMode(rag.grounding_mode),
		groundingStatus: groundingStatus(rag.grounding_status),
		retrievedContextIds: stringList(rag.retrieved_context_ids),
		retrievedContexts: stringList(rag.retrieved_contexts),
		runId,
		selectedScopes: stringList(rag.selected_scopes),
		toolTrajectory,
		traceId,
	};
}

function groundingMode(value: unknown): ExecutionRunEvalProjection["groundingMode"] {
	const mode = optionalString(value);
	if (!mode) {
		return;
	}
	if (mode === "none" || mode === "single_scope" || mode === "multi_scope") {
		return mode;
	}
	throw new Error("agent runtime eval projection.rag.grounding_mode is invalid");
}

function groundingStatus(value: unknown): ExecutionRunEvalProjection["groundingStatus"] {
	const status = optionalString(value);
	if (!status) {
		return;
	}
	if (
		status === "not_required" ||
		status === "empty" ||
		status === "partial" ||
		status === "ready"
	) {
		return status;
	}
	throw new Error("agent runtime eval projection.rag.grounding_status is invalid");
}

export function buildRagasSampleFromExecutionRun(input: {
	caseId: string;
	datasetItemId?: string | null;
	datasetRunId?: string | null;
	question: string;
	reference?: string | null;
	referenceContextIds?: string[];
	referenceContexts?: string[];
	runStepsPayload: unknown;
}): JsonObject {
	const projection = parseExecutionRunEvalProjection(input.runStepsPayload);
	const caseId = stringField(input.caseId, "caseId");
	const question = stringField(input.question, `${caseId}.question`);
	const answer = stringField(projection.answer, `${caseId}.answer`);
	if (projection.retrievedContexts.length === 0) {
		throw new Error(`${caseId}.retrieved_contexts must include at least one context`);
	}
	const sample: JsonObject = {
		answer,
		case_id: caseId,
		contexts: projection.retrievedContexts,
		metadata: { run_id: projection.runId },
		question,
		retrieved_context_ids: projection.retrievedContextIds,
		trace_id: projection.traceId,
	};
	for (const [key, raw] of Object.entries({
		dataset_item_id: input.datasetItemId,
		dataset_run_id: input.datasetRunId,
		reference: input.reference,
	})) {
		const value = optionalString(raw);
		if (value) {
			sample[key] = value;
		}
	}
	if (input.referenceContextIds && input.referenceContextIds.length > 0) {
		sample.reference_context_ids = [...input.referenceContextIds];
	}
	if (input.referenceContexts && input.referenceContexts.length > 0) {
		sample.reference_contexts = [...input.referenceContexts];
	}
	return sample;
}
