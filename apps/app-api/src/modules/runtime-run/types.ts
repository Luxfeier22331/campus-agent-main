import type { ResolvedAppPrincipal } from "../auth";
import {
	type ExecutionControlRunStepTrajectory,
	ExecutionControlTransportError,
} from "../integration";

export interface RuntimeRunOwnershipRecord {
	admissionStatus: string;
	cancelOutboxStatus: string;
	cancelReason: string | null;
	cancelRequestedAt: string | null;
	completedAt: string | null;
	conversationId: string;
	requestId: string;
	runId: string;
	status: string;
	traceId: string;
}

export interface RuntimeRunCancellationRecord extends RuntimeRunOwnershipRecord {
	requestedAt: string;
}

export type RuntimeRunCancellationDecision =
	| { kind: "local_finalization"; run: RuntimeRunCancellationRecord }
	| { kind: "remote_delivery"; run: RuntimeRunCancellationRecord }
	| { kind: "remote_delivered"; run: RuntimeRunCancellationRecord }
	| { kind: "terminal"; run: RuntimeRunCancellationRecord };

export interface RuntimeRunStore {
	getOwnedRun(input: {
		ownerUserId: string;
		runId: string;
	}): Promise<RuntimeRunOwnershipRecord | null>;
	listPendingCancellations(input?: { limit?: number }): Promise<
		Array<{
			kind: "local_finalization" | "remote_delivery";
			run: RuntimeRunCancellationRecord;
		}>
	>;
	markCancellationDelivered(input: { deliveredAt: string; runId: string }): Promise<boolean>;
	recordCancellationFailure(input: {
		errorCode: string;
		failedAt: string;
		runId: string;
	}): Promise<boolean>;
	requestCancellation(input: {
		ownerUserId: string;
		reason: string;
		requestedAt: string;
		runId: string;
	}): Promise<RuntimeRunCancellationDecision | null>;
}

export interface RuntimeRunSummary {
	conversationId: string;
	phase: RuntimeRunPhase;
	requestId: string;
	runId: string;
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
	eventType: string;
	occurredAt: string;
	payload: Record<string, unknown>;
	runId: string;
	sequence: number;
	visibility: string;
}

export interface RuntimeRunStepTrajectory extends ExecutionControlRunStepTrajectory {
	run: RuntimeRunSummary;
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
	dispatchPendingCancellations?(input?: { limit?: number }): Promise<{
		delivered: number;
		failed: number;
		finalized: number;
		processed: number;
	}>;
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
