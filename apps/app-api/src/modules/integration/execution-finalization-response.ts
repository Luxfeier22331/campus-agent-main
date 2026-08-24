import {
	EXECUTION_CONTROL_FAILURE_MESSAGE,
	isSafeExecutionControlErrorCode,
} from "./execution-control-transport";
import {
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
	"error",
	"model_usage",
	"observability",
	"result",
	"stage_timing",
	"status",
	"trace_id",
	"workflow_trace_summary",
]);

const REQUIRED_EXECUTION_FINALIZATION_RESPONSE_WIRE_KEYS = [
	"answer_text",
	"error",
	"model_usage",
	"result",
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
	if (!(typeof record.trace_id === "string")) {
		throw new ExecutionFinalizationResponseContractError("trace_id must be a string");
	}
	if (!isExecutionFinalizationStatus(record.status)) {
		throw new ExecutionFinalizationResponseContractError(
			"status must be a known execution finalization status",
		);
	}
	assertModelUsage(record.model_usage);
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
				isSafeExecutionControlErrorCode(error.code) &&
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

function assertModelUsage(
	value: unknown,
): asserts value is ExecutionFinalizationResponseWire["model_usage"] {
	const record = getRecord(value);
	const keys = ["cached_input_tokens", "input_tokens", "output_tokens", "total_tokens"];
	if (
		!record ||
		Object.keys(record).length !== keys.length ||
		keys.some((key) => !(key in record))
	) {
		throw new ExecutionFinalizationResponseContractError(
			"model_usage must contain cached_input_tokens, input_tokens, output_tokens, and total_tokens",
		);
	}
	for (const key of keys) {
		const count = record[key];
		if (!(typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) {
			throw new ExecutionFinalizationResponseContractError(
				`model_usage.${key} must be a non-negative safe integer`,
			);
		}
	}
	if ((record.cached_input_tokens as number) > (record.input_tokens as number)) {
		throw new ExecutionFinalizationResponseContractError(
			"model_usage.cached_input_tokens must not exceed input_tokens",
		);
	}
	if (
		(record.total_tokens as number) !==
		(record.input_tokens as number) + (record.output_tokens as number)
	) {
		throw new ExecutionFinalizationResponseContractError(
			"model_usage.total_tokens must equal input_tokens plus output_tokens",
		);
	}
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
		"terminal_reason",
	]);
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key)) {
			throw new ExecutionFinalizationResponseContractError(`observability.${key} is not allowed`);
		}
	}
	const parsed: ToolExecutionObservability = {
		agentRuntime: normalizeNullableString(record.agent_runtime),
		modelName: normalizeNullableString(record.model_name),
		modelProvider: normalizeNullableString(record.model_provider),
		promptTrace: parsePromptTrace(record.prompt_trace),
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
	if (value === null || value === undefined) {
		return null;
	}
	const record = getRecord(value);
	if (!record || containsForbiddenWorkflowTraceKey(record)) {
		throw new ExecutionFinalizationResponseContractError(
			"workflow_trace_summary must be a safe object or null",
		);
	}
	const allowedKeys = new Set([
		"answer_artifact_refs",
		"execution_path",
		"runtime_versions",
		"terminal_reason",
	]);
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key)) {
			throw new ExecutionFinalizationResponseContractError(
				`workflow_trace_summary.${key} is not allowed`,
			);
		}
	}
	if ([...allowedKeys].some((key) => !(key in record))) {
		throw new ExecutionFinalizationResponseContractError(
			"workflow_trace_summary is missing required fields",
		);
	}
	const executionPath = normalizeNullableString(record.execution_path);
	if (!(executionPath && ["direct", "tool_assisted"].includes(executionPath))) {
		throw new ExecutionFinalizationResponseContractError(
			"workflow_trace_summary.execution_path is invalid",
		);
	}
	const terminalReason = normalizeNullableString(record.terminal_reason);
	if (!terminalReason) {
		throw new ExecutionFinalizationResponseContractError(
			"workflow_trace_summary.terminal_reason is required",
		);
	}
	if (!Array.isArray(record.answer_artifact_refs)) {
		throw new ExecutionFinalizationResponseContractError(
			"workflow_trace_summary.answer_artifact_refs must be an array",
		);
	}
	const answerArtifactRefs = stringArray(record.answer_artifact_refs);
	if (answerArtifactRefs.length !== record.answer_artifact_refs.length) {
		throw new ExecutionFinalizationResponseContractError(
			"workflow_trace_summary.answer_artifact_refs must contain non-empty strings",
		);
	}
	return {
		answerArtifactRefs,
		executionPath: executionPath as ToolExecutionWorkflowTraceSummary["executionPath"],
		runtimeVersions: normalizeWorkflowRecord(record.runtime_versions),
		terminalReason,
	};
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
						code: (parsed.error as { code: string }).code.trim(),
						message: EXECUTION_CONTROL_FAILURE_MESSAGE,
						retryable: (parsed.error as { retryable: boolean }).retryable,
					}
				: null,
		modelUsage: {
			cachedInputTokens: parsed.model_usage.cached_input_tokens,
			inputTokens: parsed.model_usage.input_tokens,
			outputTokens: parsed.model_usage.output_tokens,
			totalTokens: parsed.model_usage.total_tokens,
		},
		observability: parseExecutionObservability(parsed.observability),
		result: parsed.result ?? null,
		...(stageTiming ? { stageTiming } : {}),
		status: parsed.status,
		traceId: parsed.trace_id,
		...(workflowTraceSummary ? { workflowTraceSummary } : {}),
	};
}
