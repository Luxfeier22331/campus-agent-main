import type { ResolvedAppPrincipal } from "../auth";
import { ExecutionControlTransportError } from "../integration";

export interface RuntimeRunOwnershipRecord {
	acceptedAt: string;
	completedAt: string | null;
	conversationId: string;
	requestId: string;
	status: string;
}

export interface RuntimeRunStore {
	getOwnedRun(input: {
		ownerUserId: string;
		requestId: string;
	}): Promise<RuntimeRunOwnershipRecord | null>;
}

export interface RuntimeRunSummary {
	acceptedAt: string;
	completedAt: string | null;
	conversationId: string;
	durationMs: number | null;
	phase: RuntimeRunPhase;
	requestId: string;
	startedAt: string | null;
	status: string;
	terminalReason?: string;
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
	eventType: RuntimeRunProductEventName;
	occurredAt: string;
	payload: Record<string, unknown>;
	requestId: string;
	sequence: number;
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
		requestId: string;
	}): Promise<{ run: RuntimeRunSummary }>;
	getStatus(input: {
		principal: ResolvedAppPrincipal;
		requestId: string;
	}): Promise<{ run: RuntimeRunSummary }>;
	listEvents(input: {
		afterSequence?: number;
		principal: ResolvedAppPrincipal;
		requestId: string;
		signal?: AbortSignal;
	}): Promise<{
		events: RuntimeRunEventProjection[];
		nextSequence: number;
		run: RuntimeRunSummary;
	}>;
	listSteps(input: {
		principal: ResolvedAppPrincipal;
		requestId: string;
	}): Promise<RuntimeRunStepTrajectory>;
	subscribeEvents(input: {
		afterSequence?: number;
		polling?: RuntimeRunEventSubscriptionPolicy;
		principal: ResolvedAppPrincipal;
		requestId: string;
		signal?: AbortSignal;
	}): AsyncIterable<RuntimeRunEventProjection>;
}
