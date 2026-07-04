import { summarizeObservedSources } from "../source-trace";
import {
	EXECUTION_FINALIZATION_CONFIDENCE_LEVELS,
	EXECUTION_FINALIZATION_DEBUG_TRACE_SINKS,
	EXECUTION_FINALIZATION_STATUSES,
	type ExecutionFinalizationResponseWire,
	STAGE_TIMING_FIELDS,
} from "./execution-finalization-contract";
import type {
	ToolExecutionDebugTraceRef,
	ToolExecutionModelUsageSummary,
	ToolExecutionObservability,
	ToolExecutionPromptTrace,
	ToolExecutionResponse,
	ToolExecutionUsageSummary,
	ToolExecutionWorkflowTraceSummary,
} from "./tool-execution-types";

const FORBIDDEN_WORKFLOW_TRACE_KEY_TOKENS = [
	"raw_prompt",
	"raw_transcript",
	"provider_raw_response",
	"raw_response",
	"jwt",
	"cookie",
	"auth_envelope",
	"retrieval_backend_dump",
];

const EXECUTION_FINALIZATION_RESPONSE_WIRE_KEYS = new Set([
	"answer_text",
	"confidence",
	"debug_trace_refs",
	"error",
	"follow_up_question",
	"observability",
	"result",
	"selected_tool",
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
	"result",
	"selected_tool",
	"status",
	"trace_id",
] as const;

const STAGE_TIMING_FIELD_SET = new Set<string>(STAGE_TIMING_FIELDS);
const DEBUG_TRACE_SINK_SET = new Set<string>(EXECUTION_FINALIZATION_DEBUG_TRACE_SINKS);

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

function normalizeNullableBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function normalizeNullableNumber(value: unknown): number | null {
	return Number.isFinite(value) ? Number(value) : null;
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

function assertDebugTraceRefs(
	value: unknown,
): asserts value is ExecutionFinalizationResponseWire["debug_trace_refs"] {
	if (value === null || value === undefined) {
		return;
	}
	if (!Array.isArray(value)) {
		throw new ExecutionFinalizationResponseContractError(
			"debug_trace_refs must be an array of objects or null",
		);
	}
	for (const [index, item] of value.entries()) {
		const record = getRecord(item);
		if (!record) {
			throw new ExecutionFinalizationResponseContractError(
				`debug_trace_refs[${index}] must be an object`,
			);
		}
		for (const key of Object.keys(record)) {
			if (!["sink", "trace_id", "trace_ref", "url"].includes(key)) {
				throw new ExecutionFinalizationResponseContractError(
					`debug_trace_refs[${index}].${key} is not allowed`,
				);
			}
		}
		if (!(typeof record.sink === "string" && DEBUG_TRACE_SINK_SET.has(record.sink))) {
			throw new ExecutionFinalizationResponseContractError(
				`debug_trace_refs[${index}].sink is invalid`,
			);
		}
		if (!(typeof record.trace_ref === "string" && record.trace_ref.trim())) {
			throw new ExecutionFinalizationResponseContractError(
				`debug_trace_refs[${index}].trace_ref is required`,
			);
		}
		if (
			"trace_id" in record &&
			!(record.trace_id === null || typeof record.trace_id === "string")
		) {
			throw new ExecutionFinalizationResponseContractError(
				`debug_trace_refs[${index}].trace_id must be a string or null`,
			);
		}
		if ("url" in record && !(typeof record.url === "string" && record.url.trim())) {
			throw new ExecutionFinalizationResponseContractError(
				`debug_trace_refs[${index}].url must be a non-empty string when present`,
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
	assertDebugTraceRefs(record.debug_trace_refs);
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

function normalizeStringArrayRecord(
	record: Record<string, unknown>,
	snakeCaseKey: string,
): string[] | null {
	const value = recordValue(record, snakeCaseKey);
	if (!Array.isArray(value)) {
		return null;
	}
	const items = value.filter(
		(item): item is string => typeof item === "string" && item.trim().length > 0,
	);
	return items.length > 0 ? items : [];
}

function normalizeStringRecord(
	record: Record<string, unknown>,
	snakeCaseKey: string,
): Record<string, string> | null {
	const value = getRecord(recordValue(record, snakeCaseKey));
	if (!value) {
		return null;
	}
	const normalized = Object.fromEntries(
		Object.entries(value).flatMap(([key, entry]) =>
			typeof entry === "string" && entry.trim() ? [[key, entry]] : [],
		),
	);
	return Object.keys(normalized).length > 0 ? normalized : {};
}

function parsePromptTrace(value: unknown): ToolExecutionPromptTrace | null {
	const record = getRecord(value);
	if (!record) {
		return null;
	}

	const parsed: ToolExecutionPromptTrace = {
		modelName: normalizeNullableString(record.model_name),
		modelProvider: normalizeNullableString(record.model_provider),
		outputSchemaVersion: normalizeNullableString(record.output_schema_version),
		promptId: normalizeNullableString(record.prompt_id),
		promptVersion: normalizeNullableString(record.prompt_version),
		templateSha256: normalizeNullableString(record.template_sha256),
		variablesSchemaVersion: normalizeNullableString(record.variables_schema_version),
	};

	if (Object.values(parsed).every((item) => item === null)) {
		return null;
	}

	return parsed;
}

function parseModelUsageSummary(value: unknown): ToolExecutionModelUsageSummary | null {
	const record = getRecord(value);
	if (!record) {
		return null;
	}
	return {
		cachedInputTokens: normalizeNullableNumber(record.cached_input_tokens) ?? 0,
		estimatedCostMicrousd: normalizeNullableNumber(record.estimated_cost_microusd) ?? 0,
		inputTokens: normalizeNullableNumber(record.input_tokens) ?? 0,
		modelName: normalizeNullableString(record.model_name),
		modelProvider: normalizeNullableString(record.model_provider),
		outputTokens: normalizeNullableNumber(record.output_tokens) ?? 0,
		stepCount: normalizeNullableNumber(record.step_count) ?? 0,
	};
}

function parseUsageSummary(value: unknown): ToolExecutionUsageSummary | null {
	const record = getRecord(value);
	if (!record) {
		return null;
	}
	const modelUsageValue = record.model_usage;
	const modelUsage = Array.isArray(modelUsageValue)
		? modelUsageValue.flatMap((item) => {
				const parsed = parseModelUsageSummary(item);
				return parsed ? [parsed] : [];
			})
		: [];
	const parsed: ToolExecutionUsageSummary = {
		billableStepCount: normalizeNullableNumber(record.billable_step_count) ?? 0,
		cachedInputTokens: normalizeNullableNumber(record.cached_input_tokens) ?? 0,
		estimatedCostMicrousd: normalizeNullableNumber(record.estimated_cost_microusd) ?? 0,
		inputTokens: normalizeNullableNumber(record.input_tokens) ?? 0,
		modelName: normalizeNullableString(record.model_name),
		modelProvider: normalizeNullableString(record.model_provider),
		modelUsage,
		outputTokens: normalizeNullableNumber(record.output_tokens) ?? 0,
	};
	if (parsed.billableStepCount <= 0 && parsed.modelUsage.length === 0) {
		return null;
	}
	return parsed;
}

function parseExecutionObservability(value: unknown): ToolExecutionObservability | null {
	const record = getRecord(value);
	if (!record) {
		return null;
	}

	const resolvedScopeCollection = normalizeNullableString(record.resolved_scope_collection);
	const resolvedScopeCorpus = normalizeNullableString(record.resolved_scope_corpus);
	const rawRetrievedSources = record.retrieved_sources;
	const hasRetrievedSourcesTrace = Array.isArray(rawRetrievedSources);
	const retrievedSources = summarizeObservedSources(rawRetrievedSources);
	const retrievalAttempted = normalizeNullableBoolean(record.retrieval_attempted);
	const explicitRetrievedSourceCount = normalizeNullableNumber(record.retrieved_source_count);
	const retrievedSourceCount =
		explicitRetrievedSourceCount ??
		(retrievalAttempted === true && hasRetrievedSourcesTrace ? retrievedSources.length : null);
	const parsed: ToolExecutionObservability = {
		aclAnomalyCode: normalizeNullableString(record.acl_anomaly_code),
		aclDecision: normalizeNullableString(record.acl_decision),
		cachedInputTokens: normalizeNullableNumber(record.cached_input_tokens),
		candidateCount: normalizeNullableNumber(record.candidate_count),
		citationCount: normalizeNullableNumber(record.citation_count),
		citationExpected: normalizeNullableBoolean(record.citation_expected),
		citationMissing: normalizeNullableBoolean(record.citation_missing),
		estimatedCostMicrousd: normalizeNullableNumber(record.estimated_cost_microusd),
		failClosed: normalizeNullableBoolean(record.fail_closed),
		inputTokens: normalizeNullableNumber(record.input_tokens),
		intentAmbiguityReason: normalizeRecordString(record, "intent_ambiguity_reason"),
		intentAmbiguitySignal: normalizeRecordString(record, "intent_ambiguity_signal"),
		intentTool: normalizeRecordString(record, "intent_tool"),
		intentClassifierVersion: normalizeRecordString(record, "intent_classifier_version"),
		intentContextReferenceType: normalizeRecordString(record, "intent_context_reference_type"),
		intentContextResolutionState: normalizeRecordString(record, "intent_context_resolution_state"),
		intentLaunchState: normalizeRecordString(record, "intent_launch_state"),
		intentMissingSlots: normalizeStringArrayRecord(record, "intent_missing_slots"),
		intentNextAction: normalizeRecordString(record, "intent_next_action"),
		intentPolicyReason: normalizeRecordString(record, "intent_policy_reason"),
		intentResolvedSlots: normalizeStringRecord(record, "intent_resolved_slots"),
		intentRoutingConfidence: normalizeRecordString(record, "intent_routing_confidence"),
		intentSchemaVersion: normalizeRecordString(record, "intent_schema_version"),
		intentScopeClass: normalizeRecordString(record, "intent_scope_class"),
		intentScopeReason: normalizeRecordString(record, "intent_scope_reason"),
		intentTaskKind: normalizeRecordString(record, "intent_task_kind"),
		modelName: normalizeNullableString(record.model_name),
		modelProvider: normalizeNullableString(record.model_provider),
		outputTokens: normalizeNullableNumber(record.output_tokens),
		policyReason: normalizeNullableString(record.policy_reason),
		modelExecutionDetail: normalizeNullableString(record.model_execution_detail),
		modelExecutionState: normalizeNullableString(record.model_execution_state),
		promptTrace: parsePromptTrace(record.prompt_trace),
		refusalClass: normalizeNullableString(record.refusal_class),
		retrievedSourceCount,
		...(hasRetrievedSourcesTrace ? { retrievedSources } : {}),
		retrievalAttempted,
		scopeClass: normalizeNullableString(record.scope_class),
		semanticOutcome: normalizeNullableString(record.semantic_outcome),
		selectedTool: normalizeNullableString(record.selected_tool),
		toolBusinessOutcome: normalizeNullableString(record.tool_business_outcome),
		toolFailCloseReason: normalizeNullableString(record.tool_fail_close_reason),
		toolHistoricalDowngradeReason: normalizeNullableString(record.tool_historical_downgrade_reason),
		usageSummary: parseUsageSummary(record.usage_summary),
		...(resolvedScopeCollection ? { resolvedScopeCollection } : {}),
		...(resolvedScopeCorpus ? { resolvedScopeCorpus } : {}),
	};

	if (Object.values(parsed).every((item) => item === null)) {
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
	const handoffChainValue = recordValue(record, "handoff_chain");
	const handoffChain = Array.isArray(handoffChainValue)
		? handoffChainValue.flatMap((item) => {
				const handoff = getRecord(item);
				return handoff ? [handoff] : [];
			})
		: [];
	const contextProjectionsValue = recordValue(record, "context_projections");
	const contextProjections = Array.isArray(contextProjectionsValue)
		? contextProjectionsValue.flatMap((item) => {
				const projection = getRecord(item);
				return projection ? [projection] : [];
			})
		: [];
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
		contextResolution: normalizeWorkflowRecord(recordValue(record, "context_resolution")),
		directVsDelegateBranch: normalizeRecordString(record, "direct_vs_delegate_branch"),
		failCloseReason: normalizeRecordString(record, "fail_close_reason"),
		guardrailOutcomes: normalizeWorkflowRecord(recordValue(record, "guardrail_outcomes")),
		handoff: normalizeWorkflowRecord(record.handoff),
		handoffChain,
		contextProjections,
		planningOutcome: normalizeRecordString(record, "planning_outcome"),
		policyArtifactVersions: normalizeWorkflowRecord(
			recordValue(record, "policy_artifact_versions"),
		),
		routingFrame: normalizeWorkflowRecord(recordValue(record, "routing_frame")),
		runtimeVersions: normalizeWorkflowRecord(recordValue(record, "runtime_versions")),
		selectedTool: normalizeRecordString(record, "selected_tool"),
		selectedTools,
		toolArgumentSummary: normalizeWorkflowRecord(recordValue(record, "tool_argument_summary")),
		traceSteps,
		toolCallSummaries,
		workflowMode: normalizeRecordString(record, "workflow_mode"),
	};

	if (
		!(parsed.directVsDelegateBranch || parsed.planningOutcome || parsed.selectedTool) &&
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

function parseStageTiming(value: unknown): Record<string, number> | null {
	const record = getRecord(value) as Record<string, number> | null;
	if (!record) {
		return null;
	}
	return record;
}

function parseDebugTraceRefs(value: unknown): ToolExecutionDebugTraceRef[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const refs = value.flatMap((item) => {
		const record = getRecord(item);
		if (!record) {
			return [];
		}
		const sink = normalizeNullableString(record.sink);
		const traceRef = normalizeNullableString(record.trace_ref);
		if (!(sink && traceRef)) {
			return [];
		}
		const parsed: ToolExecutionDebugTraceRef = {
			sink,
			traceId: normalizeNullableString(record.trace_id),
			traceRef,
		};
		const url = normalizeNullableString(record.url);
		if (url) {
			parsed.url = url;
		}
		return [parsed];
	});
	return refs.length > 0 ? refs : [];
}

export function parseExecutionFinalizationResponsePayload(
	parsed: (Partial<ExecutionFinalizationResponseWire> & Record<string, unknown>) | null | undefined,
): ToolExecutionResponse {
	assertExecutionFinalizationResponseWire(parsed);
	const workflowTraceSummary = parseWorkflowTraceSummary(parsed.workflow_trace_summary);
	const stageTiming = parseStageTiming(parsed.stage_timing);
	const debugTraceRefs = parseDebugTraceRefs(parsed.debug_trace_refs);
	return {
		answerText: parsed.answer_text,
		...(debugTraceRefs ? { debugTraceRefs } : {}),
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
		result: parsed.result ?? null,
		selectedTool: parsed.selected_tool,
		...(stageTiming ? { stageTiming } : {}),
		status: parsed.status,
		traceId: parsed.trace_id,
		...(workflowTraceSummary ? { workflowTraceSummary } : {}),
	};
}
