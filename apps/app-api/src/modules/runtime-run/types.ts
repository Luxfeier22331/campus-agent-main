import type { ResolvedAppPrincipal } from "../auth";
import { ExecutionControlTransportError } from "../integration";

export interface RuntimeRunOwnershipRecord {
	acceptedAt: string;
	completedAt: string | null;
	conversationId: string;
	requestId: string;
	runId: string;
	status: string;
	traceId: string;
}

export interface RuntimeRunStore {
	getOwnedRun(input: {
		ownerUserId: string;
		runId: string;
	}): Promise<RuntimeRunOwnershipRecord | null>;
}

export interface RuntimeRunSummary {
	acceptedAt: string;
	completedAt: string | null;
	conversationId: string;
	durationMs: number | null;
	phase: RuntimeRunPhase;
	requestId: string;
	runId: string;
	startedAt: string | null;
	status: string;
	terminalReason?: string;
	traceId: string;
}

export type RuntimeRunPhase =
	| "created"
	| "queued"
	| "admitted"
	| "running"
	| "streaming"
	| "completed"
	| "failed"
	| "canceled"
	| "expired";

export function runtimeRunPhaseFromExecutionStatus(status: string): RuntimeRunPhase {
	switch (status) {
		case "created":
			return "created";
		case "queued":
			return "queued";
		case "admitted":
			return "admitted";
		case "running":
			return "running";
		case "streaming":
			return "streaming";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "canceled":
			return "canceled";
		case "expired":
			return "expired";
		default:
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Execution durable run status is not supported.",
				retryable: true,
				status: 502,
			});
	}
}

export interface RuntimeRunEventProjection {
	eventId: string;
	eventType: RuntimeRunProductEventName;
	occurredAt: string;
	payload: Record<string, unknown>;
	runId: string;
	sequence: number;
	visibility: string;
}

export type RuntimeRunProductEventName =
	| "answer.delta"
	| "execution.phase"
	| "execution.queued"
	| "execution.running"
	| "request.cancelled"
	| "request.completed"
	| "request.failed";

export type RuntimeRunProductPhase = "finalizing" | "generating" | "preparing";

export type RuntimeRunStepPhase = "finalizing" | "generating" | "preparing" | "queued";

export type RuntimeRunStepStatus = "cancelled" | "completed" | "failed" | "pending" | "running";

export interface RuntimeRunStep {
	completedAt: string | null;
	durationMs: number | null;
	phase: RuntimeRunStepPhase;
	startedAt: string | null;
	status: RuntimeRunStepStatus;
}

export interface RuntimeRunStepTrajectory {
	run: RuntimeRunSummary;
	steps: RuntimeRunStep[];
}

export interface RuntimeRunEventSubscriptionPolicy {
	maxAttempts: number;
	waitMs?: number;
}

export interface RuntimeRunService {
	cancel(input: {
		principal: ResolvedAppPrincipal;
		reason: string;
		runId: string;
	}): Promise<{ run: RuntimeRunSummary }>;
	getStatus(input: {
		principal: ResolvedAppPrincipal;
		runId: string;
	}): Promise<{ run: RuntimeRunSummary }>;
	listEvents(input: {
		afterSequence?: number;
		principal: ResolvedAppPrincipal;
		runId: string;
		signal?: AbortSignal;
	}): Promise<{
		events: RuntimeRunEventProjection[];
		nextSequence: number;
		run: RuntimeRunSummary;
	}>;
	listSteps(input: {
		principal: ResolvedAppPrincipal;
		runId: string;
	}): Promise<RuntimeRunStepTrajectory>;
	subscribeEvents(input: {
		afterSequence?: number;
		polling?: RuntimeRunEventSubscriptionPolicy;
		principal: ResolvedAppPrincipal;
		runId: string;
		signal?: AbortSignal;
	}): AsyncIterable<RuntimeRunEventProjection>;
}
