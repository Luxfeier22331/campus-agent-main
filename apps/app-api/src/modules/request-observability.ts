import { AppApiRouteError } from "../http";
import type { ResolvedAppPrincipal } from "./auth";
import type {
	RequestedScope,
	ToolExecutionAnswerEvalFingerprint,
	ToolExecutionLlmIoFingerprint,
	ToolExecutionResponse,
} from "./integration";
import { answerEvalFingerprintSha256 } from "./integration/answer-eval-fingerprint-hash";
import {
	STAGE_TIMING_FIELDS,
	type StageTimingField,
} from "./integration/execution-finalization-contract";
import { llmIoFingerprintSha256 } from "./integration/llm-io-fingerprint-hash";
import type { RequestObservabilityFactWrite, TurnDispatchStatus } from "./runtime-command/store";
import { extractObservedSourcesFromResult } from "./source-trace";
import { summarizeVersionQuery, type VersionQuery } from "./version-query";

function toScopeSummary(scope: RequestedScope | null | undefined): string | null {
	return scope?.trim() || null;
}

const STAGE_TIMING_FIELD_SET = new Set<string>(STAGE_TIMING_FIELDS);

function assertStageTimingField(field: string): asserts field is StageTimingField {
	if (!STAGE_TIMING_FIELD_SET.has(field)) {
		throw new Error(`stage_timing.${field} is not an allowed stage timing field`);
	}
}

function addStageTimingField(
	timing: Partial<Record<StageTimingField, number>>,
	field: string,
	value: unknown,
) {
	assertStageTimingField(field);
	if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
		throw new Error(`stage_timing.${field} must be a finite non-negative number`);
	}
	timing[field] = value;
}

function addOptionalStageTimingField(
	timing: Partial<Record<StageTimingField, number>>,
	field: StageTimingField,
	value: number | null | undefined,
) {
	if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
		return;
	}
	timing[field] = value;
}

function mergeStageTiming(input: {
	executionStageTiming?: Record<string, unknown> | null;
	appApiStageTiming?: Record<string, unknown> | null;
	requestTotalMs: number;
	projectionCloseoutMs?: number | null;
	streamBrowserTtftMs?: number | null;
}): Partial<Record<StageTimingField, number>> {
	const timing: Partial<Record<StageTimingField, number>> = {};
	for (const [field, value] of Object.entries(input.executionStageTiming ?? {})) {
		addStageTimingField(timing, field, value);
	}
	for (const [field, value] of Object.entries(input.appApiStageTiming ?? {})) {
		addStageTimingField(timing, field, value);
	}
	addOptionalStageTimingField(timing, "request.total_ms", input.requestTotalMs);
	addOptionalStageTimingField(timing, "stream.browser_ttft_ms", input.streamBrowserTtftMs);
	addOptionalStageTimingField(timing, "projection.closeout_ms", input.projectionCloseoutMs);
	return timing;
}

function assertAnswerEvalFingerprintSourceConsistent(input: {
	answerEvalFingerprint: ToolExecutionAnswerEvalFingerprint | null | undefined;
	llmIoFingerprint: ToolExecutionLlmIoFingerprint | null | undefined;
}): void {
	const { answerEvalFingerprint, llmIoFingerprint } = input;
	if (!answerEvalFingerprint) {
		return;
	}
	if (!llmIoFingerprint) {
		throw new AppApiRouteError({
			code: "validation_failed",
			message: "answer_eval_fingerprint requires observability.llm_io_fingerprint",
			retryable: false,
			status: 422,
		});
	}
	const checks = [
		{
			actual: answerEvalFingerprint.llmIoFingerprintSha256,
			expected: llmIoFingerprintSha256(llmIoFingerprint),
			field: "llm_io_fingerprint_sha256",
		},
		{ actual: answerEvalFingerprint.runId, expected: llmIoFingerprint.runId, field: "run_id" },
		{
			actual: answerEvalFingerprint.requestId,
			expected: llmIoFingerprint.requestId,
			field: "request_id",
		},
		{
			actual: answerEvalFingerprint.traceId,
			expected: llmIoFingerprint.traceId,
			field: "trace_id",
		},
		{
			actual: answerEvalFingerprint.runtimeRelease,
			expected: llmIoFingerprint.runtimeRelease,
			field: "runtime_release",
		},
		{
			actual: answerEvalFingerprint.llmCallSite,
			expected: llmIoFingerprint.llmCallSite,
			field: "llm_call_site",
		},
		{
			actual: answerEvalFingerprint.providerProfileRevision,
			expected: llmIoFingerprint.providerProfileRevision,
			field: "provider_profile_revision",
		},
		{
			actual: answerEvalFingerprint.outputSchemaId,
			expected: llmIoFingerprint.outputSchemaId,
			field: "output_schema_id",
		},
		{
			actual: answerEvalFingerprint.branchIdentity.promptId,
			expected: llmIoFingerprint.promptId,
			field: "branch_identity.prompt_id",
		},
		{
			actual: answerEvalFingerprint.toolRuntimeCombinedSha256,
			expected: llmIoFingerprint.toolRuntimeFingerprint.combinedSha256,
			field: "tool_runtime_combined_sha256",
		},
	];
	for (const check of checks) {
		if (check.actual !== check.expected) {
			throw new AppApiRouteError({
				code: "validation_failed",
				message: `answer_eval_fingerprint.${check.field} must match llm_io_fingerprint`,
				retryable: false,
				status: 422,
			});
		}
	}
	if (
		answerEvalFingerprint.answerFingerprintSha256 !==
		answerEvalFingerprintSha256(answerEvalFingerprint)
	) {
		throw new AppApiRouteError({
			code: "validation_failed",
			message:
				"answer_eval_fingerprint.answer_fingerprint_sha256 must match answer_eval_fingerprint",
			retryable: false,
			status: 422,
		});
	}
}

function assertLlmIoFingerprintRunConsistent(input: {
	llmIoFingerprint: ToolExecutionLlmIoFingerprint | null | undefined;
	requestId: string;
	runId: string;
	traceId: string;
}): void {
	const { llmIoFingerprint } = input;
	if (!llmIoFingerprint) {
		return;
	}
	const checks = [
		{ actual: llmIoFingerprint.requestId, expected: input.requestId, field: "request_id" },
		{ actual: llmIoFingerprint.runId, expected: input.runId, field: "run_id" },
		{ actual: llmIoFingerprint.traceId, expected: input.traceId, field: "trace_id" },
	];
	for (const check of checks) {
		if (check.actual !== check.expected) {
			throw new AppApiRouteError({
				code: "validation_failed",
				message: `llm_io_fingerprint.${check.field} must match finalized request`,
				retryable: false,
				status: 422,
			});
		}
	}
}

function normalizeAclDecision(input: { status: TurnDispatchStatus }): string | null {
	if (input.status === "approval_required") {
		return "approval_required";
	}
	if (input.status === "rejected") {
		return "denied";
	}
	return input.status === "accepted" ? null : "allowed";
}

function normalizeFailClosed(input: { status: TurnDispatchStatus }): boolean | null {
	if (input.status === "accepted") {
		return null;
	}
	return !["completed", "needs_clarification"].includes(input.status);
}

function normalizeRefusalClass(status: TurnDispatchStatus): string | null {
	if (
		status === "needs_clarification" ||
		status === "no_answer" ||
		status === "approval_required" ||
		status === "rejected"
	) {
		return status;
	}

	return status === "error" || status === "cancelled" ? status : null;
}

function normalizeSemanticOutcome(status: TurnDispatchStatus): string | null {
	if (status === "completed") {
		return "answer";
	}
	if (status === "needs_clarification") {
		return "needs_clarification";
	}
	if (status === "approval_required") {
		return "approval_required";
	}
	if (status === "rejected") {
		return "policy_refusal";
	}
	if (status === "no_answer") {
		return "no_answer";
	}
	return status === "accepted" ? null : status;
}

function normalizeScopeClass(input: {
	requestedScope: RequestedScope | null;
	resolvedScope: RequestedScope | null;
	status: TurnDispatchStatus;
}): string | null {
	if (
		(input.status === "completed" ||
			input.status === "needs_clarification" ||
			input.status === "no_answer") &&
		(input.resolvedScope || input.requestedScope)
	) {
		return "in_scope";
	}
	return null;
}

function normalizePolicyReason(input: { status: TurnDispatchStatus }): string | null {
	if (input.status === "approval_required") {
		return "approval_required";
	}
	if (input.status === "rejected") {
		return "request_rejected";
	}
	return null;
}

export function buildAcceptedRequestObservabilityFact(input: {
	conversationId: string;
	principal: ResolvedAppPrincipal;
	requestId: string;
	requestedTool: string | null;
	requestedScope: RequestedScope | null;
	resolvedScope: RequestedScope | null;
	safetyIdentifier?: string | null;
	surface: string;
	startedAt: string;
	traceId: string;
	versionQuery?: VersionQuery | null;
}): RequestObservabilityFactWrite {
	const versionSummary = summarizeVersionQuery(input.versionQuery);

	return {
		aclAnomalyCode: null,
		aclDecision: null,
		supportingSources: [],
		completedAt: null,
		conversationId: input.conversationId,
		durationMs: null,
		entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId ?? null,
		errorCode: null,
		failClosed: null,
		measuredAt: input.startedAt,
		modelName: null,
		modelProvider: null,
		promptId: null,
		promptVersion: null,
		policyProjectionVersion:
			input.principal.authorization?.retrievalFilter.policyProjectionVersion ?? null,
		policyReason: null,
		principalType: input.principal.principal.type,
		projectionLagMs: null,
		requestId: input.requestId,
		requestedTool: input.requestedTool,
		requestedScopeSummary: toScopeSummary(input.requestedScope),
		versionQueryMode: versionSummary.mode,
		versionQuerySummary: versionSummary.summary,
		resolvedScopeSummary: toScopeSummary(input.resolvedScope),
		refusalClass: null,
		scopeClass: null,
		semanticOutcome: null,
		safetyIdentifier: input.safetyIdentifier ?? null,
		templateSha256: null,
		selectedTool: null,
		startedAt: input.startedAt,
		status: "accepted",
		surface: input.surface,
		traceAvailable: Boolean(input.traceId),
		traceId: input.traceId,
		updatedAt: input.startedAt,
		workflowTraceSummary: null,
		stageTiming: {},
		answerEvalFingerprint: null,
		llmIoFingerprint: null,
	};
}

export function buildFinalizedRequestObservabilityFact(input: {
	completedAt: string;
	durationMs: number;
	errorCode: string | null;
	principal: ResolvedAppPrincipal;
	projectionCloseoutMs?: number | null;
	requestId: string;
	requestedTool: string | null;
	requestedScope: RequestedScope | null;
	resolvedScope: RequestedScope | null;
	response: ToolExecutionResponse;
	runId: string;
	safetyIdentifier?: string | null;
	startedAt: string;
	stageTiming?: Record<string, unknown> | null;
	status: TurnDispatchStatus;
	streamBrowserTtftMs?: number | null;
	surface: string;
	traceId: string;
	conversationId: string;
	versionQuery?: VersionQuery | null;
}): RequestObservabilityFactWrite {
	const observability = input.response.observability;
	const versionSummary = summarizeVersionQuery(input.versionQuery);
	const supportingSources = extractObservedSourcesFromResult(input.response.result);
	const answerEvalFingerprint = observability?.answerEvalFingerprint ?? null;
	const llmIoFingerprint = observability?.llmIoFingerprint ?? null;
	assertLlmIoFingerprintRunConsistent({
		llmIoFingerprint,
		requestId: input.requestId,
		runId: input.runId,
		traceId: input.traceId,
	});
	assertAnswerEvalFingerprintSourceConsistent({
		answerEvalFingerprint,
		llmIoFingerprint,
	});

	return {
		aclAnomalyCode: null,
		aclDecision: normalizeAclDecision({ status: input.status }),
		supportingSources,
		completedAt: input.completedAt,
		conversationId: input.conversationId,
		durationMs: input.durationMs,
		entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId ?? null,
		errorCode: input.errorCode,
		failClosed: normalizeFailClosed({ status: input.status }),
		measuredAt: input.completedAt,
		modelName: llmIoFingerprint?.model ?? null,
		modelProvider: llmIoFingerprint?.provider ?? null,
		promptId: llmIoFingerprint?.promptId ?? null,
		promptVersion: null,
		policyProjectionVersion:
			input.principal.authorization?.retrievalFilter.policyProjectionVersion ?? null,
		policyReason: normalizePolicyReason({ status: input.status }),
		principalType: input.principal.principal.type,
		projectionLagMs: null,
		requestId: input.requestId,
		requestedTool: input.requestedTool,
		requestedScopeSummary: toScopeSummary(input.requestedScope),
		versionQueryMode: versionSummary.mode,
		versionQuerySummary: versionSummary.summary,
		resolvedScopeSummary: toScopeSummary(input.resolvedScope),
		refusalClass: normalizeRefusalClass(input.status),
		scopeClass: normalizeScopeClass({
			requestedScope: input.requestedScope,
			resolvedScope: input.resolvedScope,
			status: input.status,
		}),
		semanticOutcome: normalizeSemanticOutcome(input.status),
		safetyIdentifier: input.safetyIdentifier ?? null,
		templateSha256: llmIoFingerprint?.promptTemplateSha256 ?? null,
		selectedTool: input.response.selectedTool,
		startedAt: input.startedAt,
		status: input.status,
		surface: input.surface,
		traceAvailable: Boolean(input.traceId),
		traceId: input.traceId,
		updatedAt: input.completedAt,
		workflowTraceSummary: input.response.workflowTraceSummary ?? null,
		stageTiming: mergeStageTiming({
			appApiStageTiming: input.stageTiming,
			executionStageTiming: input.response.stageTiming,
			projectionCloseoutMs: input.projectionCloseoutMs,
			requestTotalMs: input.durationMs,
			streamBrowserTtftMs: input.streamBrowserTtftMs,
		}),
		answerEvalFingerprint,
		llmIoFingerprint,
	};
}

export function summarizeRequestedScope(scope: RequestedScope | null | undefined): string | null {
	return toScopeSummary(scope);
}
