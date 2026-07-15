import {
	EXECUTION_FINALIZATION_CONFIDENCE_LEVELS,
	EXECUTION_FINALIZATION_STATUSES,
	type ExecutionFinalizationResponseWire,
	STAGE_TIMING_FIELDS,
} from "./execution-finalization-contract";
import type {
	ToolExecutionObservability,
	ToolExecutionPromptTrace,
	ToolExecutionResponse,
	ToolExecutionWorkflowTraceSummary,
} from "./tool-execution-types";

const FORBIDDEN_WORKFLOW_TRACE_KEY_TOKENS = [
	"raw_answer",
	"raw_prompt",
	"raw_transcript",
	"provider_request_body",
	"provider_response_body",
	"provider_stream_deltas",
	"provider_raw_response",
	"raw_response",
	"jwt",
	"authorization",
	"cookie",
	"auth_envelope",
	"retrieval_backend_dump",
];

const EXECUTION_FINALIZATION_RESPONSE_WIRE_KEYS = new Set([
	"answer_text",
	"confidence",
	"error",
	"follow_up_question",
	"observability",
	"resolved_targets",
	"result",
	"selected_tool",
	"session_update",
	"stage_timing",
	"status",
	"trace_id",
	"workflow_trace_summary",
]);

const REQUIRED_EXECUTION_FINALIZATION_RESPONSE_WIRE_KEYS = [
	"answer_text",
	"confidence",
	"error",
	"follow_up_question",
	"resolved_targets",
	"result",
	"selected_tool",
	"session_update",
	"status",
	"trace_id",
] as const;

const STAGE_TIMING_FIELD_SET = new Set<string>(STAGE_TIMING_FIELDS);

class ExecutionFinalizationResponseContractError extends Error {
	constructor(message: string) {
		super(`execution finalization response contract violation: ${message}`);
		this.name = "ExecutionFinalizationResponseContractError";
	}
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function isExecutionFinalizationStatus(value: unknown): value is ToolExecutionResponse["status"] {
	return (
		typeof value === "string" &&
		(EXECUTION_FINALIZATION_STATUSES as readonly string[]).includes(value)
	);
}

function assertStageTiming(
	value: unknown,
): asserts value is ExecutionFinalizationResponseWire["stage_timing"] {
	if (value === null || value === undefined) {
		return;
	}
	const record = getRecord(value);
	if (!record) {
		throw new ExecutionFinalizationResponseContractError("stage_timing must be an object or null");
	}
	if (containsForbiddenWorkflowTraceKey(record)) {
		throw new ExecutionFinalizationResponseContractError("stage_timing contains forbidden keys");
	}
	for (const [key, durationMs] of Object.entries(record)) {
		if (!STAGE_TIMING_FIELD_SET.has(key)) {
			throw new ExecutionFinalizationResponseContractError(
				`stage_timing.${key} is not an allowed stage timing field`,
			);
		}
		if (!(typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0)) {
			throw new ExecutionFinalizationResponseContractError(
				`stage_timing.${key} must be a finite non-negative number`,
			);
		}
	}
}

function assertExecutionFinalizationResponseWire(
	value: unknown,
): asserts value is ExecutionFinalizationResponseWire {
	const record = getRecord(value);
	if (!record) {
		throw new ExecutionFinalizationResponseContractError("response body must be an object");
	}
	for (const key of Object.keys(record)) {
		if (!EXECUTION_FINALIZATION_RESPONSE_WIRE_KEYS.has(key)) {
			throw new ExecutionFinalizationResponseContractError(`unexpected top-level field ${key}`);
		}
	}
	for (const key of REQUIRED_EXECUTION_FINALIZATION_RESPONSE_WIRE_KEYS) {
		if (!(key in record)) {
			throw new ExecutionFinalizationResponseContractError(`missing required field ${key}`);
		}
	}
	if (!(typeof record.answer_text === "string")) {
		throw new ExecutionFinalizationResponseContractError("answer_text must be a string");
	}
	if (!(typeof record.follow_up_question === "string")) {
		throw new ExecutionFinalizationResponseContractError("follow_up_question must be a string");
	}
	if (!(typeof record.trace_id === "string")) {
		throw new ExecutionFinalizationResponseContractError("trace_id must be a string");
	}
	if (!isExecutionFinalizationStatus(record.status)) {
		throw new ExecutionFinalizationResponseContractError(
			"status must be a known execution finalization status",
		);
	}
	if (
		!(EXECUTION_FINALIZATION_CONFIDENCE_LEVELS as readonly string[]).includes(
			String(record.confidence),
		)
	) {
		throw new ExecutionFinalizationResponseContractError("confidence must be high, medium, or low");
	}
	if (!(record.selected_tool === null || typeof record.selected_tool === "string")) {
		throw new ExecutionFinalizationResponseContractError("selected_tool must be a string or null");
	}
	if (!Array.isArray(record.resolved_targets)) {
		throw new ExecutionFinalizationResponseContractError("resolved_targets must be an array");
	}
	const resolvedTargets = stringArray(record.resolved_targets);
	if (
		resolvedTargets.length !== record.resolved_targets.length ||
		new Set(resolvedTargets).size !== resolvedTargets.length
	) {
		throw new ExecutionFinalizationResponseContractError(
			"resolved_targets must contain unique non-empty strings",
		);
	}
	assertSessionUpdate(record.session_update);
	if (!(record.result === null || getRecord(record.result))) {
		throw new ExecutionFinalizationResponseContractError("result must be an object or null");
	}
	if (!(record.error === null || getRecord(record.error))) {
		throw new ExecutionFinalizationResponseContractError("error must be an object or null");
	}
	if (record.error) {
		const error = getRecord(record.error);
		if (
			!(
				error &&
				typeof error.code === "string" &&
				error.code.trim() &&
				typeof error.message === "string" &&
				error.message.trim() &&
				typeof error.retryable === "boolean"
			)
		) {
			throw new ExecutionFinalizationResponseContractError(
				"error.code, error.message, and error.retryable are required",
			);
		}
	}
	if (
		"observability" in record &&
		!(record.observability === null || getRecord(record.observability))
	) {
		throw new ExecutionFinalizationResponseContractError("observability must be an object or null");
	}
	if (
		"workflow_trace_summary" in record &&
		!(record.workflow_trace_summary === null || getRecord(record.workflow_trace_summary))
	) {
		throw new ExecutionFinalizationResponseContractError(
			"workflow_trace_summary must be an object or null",
		);
	}
	assertStageTiming(record.stage_timing);
}

const SESSION_UPDATE_SLOT_NAMES = new Set([
	"curriculum_program",
	"curriculum_program_family",
	"curriculum_semester",
]);

function assertSessionUpdate(
	value: unknown,
): asserts value is ExecutionFinalizationResponseWire["session_update"] {
	if (value === null) {
		return;
	}
	const record = getRecord(value);
	if (!record || Object.keys(record).some((key) => key !== "upsert_slots")) {
		throw new ExecutionFinalizationResponseContractError(
			"session_update must contain only upsert_slots",
		);
	}
	if (!Array.isArray(record.upsert_slots)) {
		throw new ExecutionFinalizationResponseContractError(
			"session_update.upsert_slots must be an array",
		);
	}
	const seenNames = new Set<string>();
	for (const [index, value] of record.upsert_slots.entries()) {
		const slot = getRecord(value);
		if (
			!slot ||
			Object.keys(slot).some((key) => !["confirmed", "name", "value"].includes(key)) ||
			slot.confirmed !== true ||
			typeof slot.name !== "string" ||
			!SESSION_UPDATE_SLOT_NAMES.has(slot.name) ||
			!normalizeNullableString(slot.value) ||
			seenNames.has(slot.name)
		) {
			throw new ExecutionFinalizationResponseContractError(
				`session_update.upsert_slots[${index}] is invalid`,
			);
		}
		seenNames.add(slot.name);
	}
}

function normalizeRecordString(
	record: Record<string, unknown>,
	snakeCaseKey: string,
): string | null {
	return normalizeNullableString(record[snakeCaseKey]);
}

function recordValue(record: Record<string, unknown>, snakeCaseKey: string): unknown {
	return record[snakeCaseKey];
}

function containsForbiddenWorkflowTraceKey(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some((item) => containsForbiddenWorkflowTraceKey(item));
	}
	const record = getRecord(value);
	if (!record) {
		return false;
	}
	return Object.entries(record).some(([key, item]) => {
		const normalizedKey = normalizeWorkflowTraceKeyToken(key);
		return (
			FORBIDDEN_WORKFLOW_TRACE_KEY_TOKENS.some((token) =>
				normalizedKey.includes(normalizeWorkflowTraceKeyToken(token)),
			) || containsForbiddenWorkflowTraceKey(item)
		);
	});
}

function normalizeWorkflowTraceKeyToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

function normalizeWorkflowRecord(value: unknown): Record<string, unknown> {
	const record = getRecord(value);
	if (!record || containsForbiddenWorkflowTraceKey(record)) {
		return {};
	}
	return record;
}

function parsePromptTrace(value: unknown): ToolExecutionPromptTrace | null {
	const record = getRecord(value);
	if (!record) {
		return null;
	}
	const allowedKeys = new Set([
		"prompt_id",
		"prompt_template_sha256",
		"rendered_prompt_sha256",
		"schema_version",
	]);
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key)) {
			throw new ExecutionFinalizationResponseContractError(
				`observability.prompt_trace.${key} is not allowed`,
			);
		}
	}
	const promptId = normalizeNullableString(record.prompt_id);
	const promptTemplateSha256 = normalizeNullableString(record.prompt_template_sha256);
	const renderedPromptSha256 = normalizeNullableString(record.rendered_prompt_sha256);
	if (
		record.schema_version !== "agent_runtime_prompt_trace.v1" ||
		!promptId ||
		!promptTemplateSha256 ||
		!renderedPromptSha256
	) {
		throw new ExecutionFinalizationResponseContractError("observability.prompt_trace is invalid");
	}
	return {
		promptId,
		promptTemplateSha256,
		renderedPromptSha256,
		schemaVersion: "agent_runtime_prompt_trace.v1",
	};
}

function parseExecutionObservability(value: unknown): ToolExecutionObservability | null {
	const record = getRecord(value);
	if (!record) {
		return null;
	}
	if (containsForbiddenWorkflowTraceKey(record)) {
		throw new ExecutionFinalizationResponseContractError("observability contains forbidden keys");
	}
	const allowedKeys = new Set([
		"agent_runtime",
		"model_name",
		"model_provider",
		"prompt_trace",
		"selected_tools",
		"terminal_reason",
	]);
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key)) {
			throw new ExecutionFinalizationResponseContractError(`observability.${key} is not allowed`);
		}
	}
	const selectedTools = stringArray(record.selected_tools);
	const parsed: ToolExecutionObservability = {
		agentRuntime: normalizeNullableString(record.agent_runtime),
		modelName: normalizeNullableString(record.model_name),
		modelProvider: normalizeNullableString(record.model_provider),
		promptTrace: parsePromptTrace(record.prompt_trace),
		selectedTools,
		terminalReason: normalizeNullableString(record.terminal_reason),
	};

	if (
		Object.values(parsed).every(
			(item) => item === null || (Array.isArray(item) && item.length === 0),
		)
	) {
		return null;
	}

	return parsed;
}

function parseWorkflowTraceSummary(value: unknown): ToolExecutionWorkflowTraceSummary | null {
	const record = getRecord(value);
	if (!record || containsForbiddenWorkflowTraceKey(record)) {
		return null;
	}
	const selectedToolsValue = recordValue(record, "selected_tools");
	const selectedTools = Array.isArray(selectedToolsValue)
		? selectedToolsValue.filter(
				(item): item is string => typeof item === "string" && item.trim().length > 0,
			)
		: [];
	const answerArtifactKinds = stringArray(recordValue(record, "answer_artifact_kinds"));
	const answerArtifactRefs = stringArray(recordValue(record, "answer_artifact_refs"));
	const traceStepsValue = recordValue(record, "trace_steps");
	const traceSteps = Array.isArray(traceStepsValue)
		? traceStepsValue.flatMap((item) => {
				const step = getRecord(item);
				return step ? [step] : [];
			})
		: [];
	const toolCallSummariesValue = recordValue(record, "tool_call_summaries");
	const toolCallSummaries = Array.isArray(toolCallSummariesValue)
		? toolCallSummariesValue.flatMap((item) => {
				const summary = getRecord(item);
				return summary ? [summary] : [];
			})
		: [];
	const parsed: ToolExecutionWorkflowTraceSummary = {
		answerArtifactKinds,
		answerArtifactRefs,
		directVsDelegateBranch: normalizeRecordString(record, "direct_vs_delegate_branch"),
		firstDecisionActor: normalizeRecordString(record, "first_decision_actor"),
		planningOutcome: normalizeRecordString(record, "planning_outcome"),
		runtimeVersions: normalizeWorkflowRecord(recordValue(record, "runtime_versions")),
		selectedTool: normalizeRecordString(record, "selected_tool"),
		selectedTools,
		terminalReason: normalizeRecordString(record, "terminal_reason"),
		traceSteps,
		toolCallSummaries,
		workflowMode: normalizeRecordString(record, "workflow_mode"),
	};

	if (
		!(
			parsed.directVsDelegateBranch ||
			parsed.firstDecisionActor ||
			parsed.planningOutcome ||
			parsed.selectedTool ||
			parsed.terminalReason ||
			parsed.workflowMode
		) &&
		parsed.answerArtifactKinds.length === 0 &&
		parsed.answerArtifactRefs.length === 0 &&
		parsed.selectedTools.length === 0 &&
		Object.values(parsed).every(
			(item) =>
				item === null ||
				(Array.isArray(item) && item.length === 0) ||
				(typeof item === "object" && item !== null && Object.keys(item).length === 0),
		)
	) {
		return null;
	}

	return parsed;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: [];
}

function parseStageTiming(value: unknown): Record<string, number> | null {
	const record = getRecord(value) as Record<string, number> | null;
	if (!record) {
		return null;
	}
	return record;
}

export function parseExecutionFinalizationResponsePayload(
	parsed: (Partial<ExecutionFinalizationResponseWire> & Record<string, unknown>) | null | undefined,
): ToolExecutionResponse {
	assertExecutionFinalizationResponseWire(parsed);
	const workflowTraceSummary = parseWorkflowTraceSummary(parsed.workflow_trace_summary);
	const stageTiming = parseStageTiming(parsed.stage_timing);
	return {
		answerText: parsed.answer_text,
		error:
			parsed.error && typeof parsed.error === "object"
				? {
						code: (parsed.error as { code: string }).code,
						message: (parsed.error as { message: string }).message,
						retryable: (parsed.error as { retryable: boolean }).retryable,
					}
				: null,
		followUpQuestion: parsed.follow_up_question,
		observability: parseExecutionObservability(parsed.observability),
		resolvedTargets: [...parsed.resolved_targets],
		result: parsed.result ?? null,
		selectedTool: parsed.selected_tool,
		sessionUpdate: parsed.session_update
			? {
					upsertSlots: parsed.session_update.upsert_slots.map((slot) => ({
						confirmed: true,
						name: slot.name,
						value: slot.value.trim(),
					})),
				}
			: null,
		...(stageTiming ? { stageTiming } : {}),
		status: parsed.status,
		traceId: parsed.trace_id,
		...(workflowTraceSummary ? { workflowTraceSummary } : {}),
	};
}
