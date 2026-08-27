import type { ResolvedAppPrincipal } from "./auth";
import type { ToolExecutionResponse } from "./integration";
import {
	STAGE_TIMING_FIELDS,
	type StageTimingField,
} from "./integration/execution-finalization-contract";
import type { RequestObservabilityFactWrite, TurnDispatchStatus } from "./runtime-command/store";

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
	if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
		return;
	}
	timing[field] = value;
}

function mergeStageTiming(input: {
	executionStageTiming?: Record<string, unknown> | null;
	appApiStageTiming?: Record<string, unknown> | null;
	requestTotalMs: number;
	projectionCloseoutMs?: number | null;
	streamAppApiTtftMs?: number | null;
}): Partial<Record<StageTimingField, number>> {
	const timing: Partial<Record<StageTimingField, number>> = {};
	for (const [field, value] of Object.entries(input.executionStageTiming ?? {})) {
		addStageTimingField(timing, field, value);
	}
	for (const [field, value] of Object.entries(input.appApiStageTiming ?? {})) {
		addStageTimingField(timing, field, value);
	}
	addOptionalStageTimingField(timing, "request.total_ms", input.requestTotalMs);
	if (timing["stream.app_api_ttft_ms"] === undefined) {
		addOptionalStageTimingField(timing, "stream.app_api_ttft_ms", input.streamAppApiTtftMs);
	}
	const streamAppApiTtftMs = timing["stream.app_api_ttft_ms"];
	const agentFirstDeltaMs = timing["agent.first_delta_ms"];
	if (
		typeof streamAppApiTtftMs === "number" &&
		Number.isFinite(streamAppApiTtftMs) &&
		streamAppApiTtftMs >= 0 &&
		typeof agentFirstDeltaMs === "number" &&
		Number.isFinite(agentFirstDeltaMs) &&
		agentFirstDeltaMs >= 0 &&
		streamAppApiTtftMs >= agentFirstDeltaMs
	) {
		timing["stream.orchestration_overhead_ms"] = streamAppApiTtftMs - agentFirstDeltaMs;
	}
	addOptionalStageTimingField(timing, "projection.closeout_ms", input.projectionCloseoutMs);
	return timing;
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
	return input.status !== "completed";
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
	safetyIdentifier?: string | null;
	surface: string;
	startedAt: string;
}): RequestObservabilityFactWrite {
	return {
		aclAnomalyCode: null,
		aclDecision: null,
		completedAt: null,
		conversationId: input.conversationId,
		durationMs: null,
		entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId ?? null,
		errorCode: null,
		failClosed: null,
		measuredAt: input.startedAt,
		modelName: null,
		modelProvider: null,
		policyReason: null,
		principalType: input.principal.principal.type,
		requestId: input.requestId,
		safetyIdentifier: input.safetyIdentifier ?? null,
		startedAt: input.startedAt,
		status: "accepted",
		surface: input.surface,
		updatedAt: input.startedAt,
		stageTiming: {},
	};
}

export function buildFinalizedRequestObservabilityFact(input: {
	completedAt: string;
	durationMs: number;
	errorCode: string | null;
	principal: ResolvedAppPrincipal;
	projectionCloseoutMs?: number | null;
	requestId: string;
	response: ToolExecutionResponse;
	safetyIdentifier?: string | null;
	startedAt: string;
	stageTiming?: Record<string, unknown> | null;
	status: TurnDispatchStatus;
	streamAppApiTtftMs?: number | null;
	surface: string;
	conversationId: string;
}): RequestObservabilityFactWrite {
	const observability = input.response.observability;

	return {
		aclAnomalyCode: null,
		aclDecision: normalizeAclDecision({ status: input.status }),
		completedAt: input.completedAt,
		conversationId: input.conversationId,
		durationMs: input.durationMs,
		entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId ?? null,
		errorCode: input.errorCode,
		failClosed: normalizeFailClosed({ status: input.status }),
		measuredAt: input.completedAt,
		modelName: observability?.modelName ?? null,
		modelProvider: observability?.modelProvider ?? null,
		policyReason: normalizePolicyReason({ status: input.status }),
		principalType: input.principal.principal.type,
		requestId: input.requestId,
		safetyIdentifier: input.safetyIdentifier ?? null,
		startedAt: input.startedAt,
		status: input.status,
		surface: input.surface,
		updatedAt: input.completedAt,
		stageTiming: mergeStageTiming({
			...(input.stageTiming === undefined ? {} : { appApiStageTiming: input.stageTiming }),
			...(input.response.stageTiming === undefined
				? {}
				: { executionStageTiming: input.response.stageTiming }),
			...(input.projectionCloseoutMs === undefined
				? {}
				: { projectionCloseoutMs: input.projectionCloseoutMs }),
			requestTotalMs: input.durationMs,
			...(input.streamAppApiTtftMs === undefined
				? {}
				: { streamAppApiTtftMs: input.streamAppApiTtftMs }),
		}),
	};
}
