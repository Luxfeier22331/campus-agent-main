import { summarizeObservedSources } from "../source-trace";

import {
	SUPERVISOR_STATUSES,
	type SupervisorExecutionResponseWire,
} from "./generated/supervisor-execution-contract";
import type {
	SupervisorExecutionObservability,
	SupervisorExecutionResponse,
	SupervisorExecutionWorkflowTraceSummary,
	SupervisorPromptTrace,
} from "./supervisor-types";

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

const SUPERVISOR_RESPONSE_WIRE_KEYS = new Set([
	"answer_text",
	"confidence",
	"error",
	"follow_up_question",
	"observability",
	"result",
	"selected_target",
	"status",
	"trace_id",
	"workflow_trace_summary",
]);

const REQUIRED_SUPERVISOR_RESPONSE_WIRE_KEYS = [
	"answer_text",
	"confidence",
	"error",
	"follow_up_question",
	"result",
	"selected_target",
	"status",
	"trace_id",
] as const;

class SupervisorResponseContractError extends Error {
	constructor(message: string) {
		super(`supervisor response contract violation: ${message}`);
		this.name = "SupervisorResponseContractError";
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

function isSupervisorStatus(value: unknown): value is SupervisorExecutionResponse["status"] {
	return typeof value === "string" && (SUPERVISOR_STATUSES as readonly string[]).includes(value);
}

function assertSupervisorExecutionResponseWire(
	value: unknown,
): asserts value is SupervisorExecutionResponseWire {
	const record = getRecord(value);
	if (!record) {
		throw new SupervisorResponseContractError("response body must be an object");
	}
	for (const key of Object.keys(record)) {
		if (!SUPERVISOR_RESPONSE_WIRE_KEYS.has(key)) {
			throw new SupervisorResponseContractError(`unexpected top-level field ${key}`);
		}
	}
	for (const key of REQUIRED_SUPERVISOR_RESPONSE_WIRE_KEYS) {
		if (!(key in record)) {
			throw new SupervisorResponseContractError(`missing required field ${key}`);
		}
	}
	if (!(typeof record.answer_text === "string")) {
		throw new SupervisorResponseContractError("answer_text must be a string");
	}
	if (!(typeof record.follow_up_question === "string")) {
		throw new SupervisorResponseContractError("follow_up_question must be a string");
	}
	if (!(typeof record.trace_id === "string")) {
		throw new SupervisorResponseContractError("trace_id must be a string");
	}
	if (!isSupervisorStatus(record.status)) {
		throw new SupervisorResponseContractError("status must be a known supervisor status");
	}
	if (!["high", "medium", "low"].includes(String(record.confidence))) {
		throw new SupervisorResponseContractError("confidence must be high, medium, or low");
	}
	if (!(record.selected_target === null || typeof record.selected_target === "string")) {
		throw new SupervisorResponseContractError("selected_target must be a string or null");
	}
	if (!(record.result === null || getRecord(record.result))) {
		throw new SupervisorResponseContractError("result must be an object or null");
	}
	if (!(record.error === null || getRecord(record.error))) {
		throw new SupervisorResponseContractError("error must be an object or null");
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
			throw new SupervisorResponseContractError(
				"error.code, error.message, and error.retryable are required",
			);
		}
	}
	if (
		"observability" in record &&
		!(record.observability === null || getRecord(record.observability))
	) {
		throw new SupervisorResponseContractError("observability must be an object or null");
	}
	if (
		"workflow_trace_summary" in record &&
		!(record.workflow_trace_summary === null || getRecord(record.workflow_trace_summary))
	) {
		throw new SupervisorResponseContractError("workflow_trace_summary must be an object or null");
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

function parsePromptTrace(value: unknown): SupervisorPromptTrace | null {
	const record = getRecord(value);
	if (!record) {
		return null;
	}

	const parsed: SupervisorPromptTrace = {
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

function parseExecutionObservability(value: unknown): SupervisorExecutionObservability | null {
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
	const parsed: SupervisorExecutionObservability = {
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
		intentCapability: normalizeRecordString(record, "intent_capability"),
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
		promptRuntimeDetail: normalizeNullableString(record.prompt_runtime_detail),
		promptRuntimeState: normalizeNullableString(record.prompt_runtime_state),
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
		...(resolvedScopeCollection ? { resolvedScopeCollection } : {}),
		...(resolvedScopeCorpus ? { resolvedScopeCorpus } : {}),
	};

	if (Object.values(parsed).every((item) => item === null)) {
		return null;
	}

	return parsed;
}

function parseWorkflowTraceSummary(value: unknown): SupervisorExecutionWorkflowTraceSummary | null {
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
	const parsed: SupervisorExecutionWorkflowTraceSummary = {
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
		selectedTarget: normalizeRecordString(record, "selected_target"),
		selectedTools,
		toolArgumentSummary: normalizeWorkflowRecord(recordValue(record, "tool_argument_summary")),
		traceSteps,
		toolCallSummaries,
		workflowMode: normalizeRecordString(record, "workflow_mode"),
	};

	if (
		!(parsed.directVsDelegateBranch || parsed.planningOutcome || parsed.selectedTarget) &&
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

export function parseSupervisorExecutionResponsePayload(
	parsed: (Partial<SupervisorExecutionResponseWire> & Record<string, unknown>) | null | undefined,
): SupervisorExecutionResponse {
	assertSupervisorExecutionResponseWire(parsed);
	const workflowTraceSummary = parseWorkflowTraceSummary(parsed.workflow_trace_summary);
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
		result: parsed.result ?? null,
		selectedTarget: parsed.selected_target,
		status: parsed.status,
		traceId: parsed.trace_id,
		...(workflowTraceSummary ? { workflowTraceSummary } : {}),
	};
}
