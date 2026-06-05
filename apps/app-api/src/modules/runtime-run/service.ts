import { and, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { requestExecution } from "../../db/schema";
import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
	createSupervisorDurableRuntimeClient,
	type SupervisorDurableRun,
	type SupervisorDurableRunEvent,
	type SupervisorDurableRuntimeClient,
	SupervisorTransportError,
} from "../integration";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface RuntimeRunOwnershipRecord {
	conversationId: string;
	requestId: string;
	runId: string;
	traceId: string;
}

export interface RuntimeRunStore {
	getOwnedRun(input: {
		ownerUserId: string;
		runId: string;
	}): Promise<RuntimeRunOwnershipRecord | null>;
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

export function runtimeRunPhaseFromSupervisorStatus(status: string): RuntimeRunPhase {
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
			throw new SupervisorTransportError({
				code: "supervisor_invalid_response",
				message: "Supervisor durable run status is not supported.",
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

export interface RuntimeRunEventSubscriptionPolicy {
	maxAttempts: number;
	pollIntervalMs: number;
	sleep?: (durationMs: number) => Promise<void>;
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
	}): Promise<{ events: RuntimeRunEventProjection[]; run: RuntimeRunSummary }>;
	subscribeEvents(input: {
		afterSequence?: number;
		polling?: RuntimeRunEventSubscriptionPolicy;
		principal: ResolvedAppPrincipal;
		runId: string;
	}): AsyncIterable<RuntimeRunEventProjection>;
}

const DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY = {
	maxAttempts: 30,
	pollIntervalMs: 1000,
} as const;

export function createPgRuntimeRunStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): RuntimeRunStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getOwnedRun(query) {
			const db = await getDb();
			const rows = await db
				.select({
					conversationId: requestExecution.conversationId,
					requestId: requestExecution.requestId,
					runId: requestExecution.runId,
					traceId: requestExecution.traceId,
				})
				.from(requestExecution)
				.where(
					and(
						eq(requestExecution.actorUserId, query.ownerUserId),
						eq(requestExecution.runId, query.runId),
					),
				)
				.limit(1);
			const row = rows[0];
			if (!(row?.runId && row.conversationId && row.requestId && row.traceId)) {
				return null;
			}
			return {
				conversationId: row.conversationId,
				requestId: row.requestId,
				runId: row.runId,
				traceId: row.traceId,
			};
		},
	};
}

export function buildRuntimeRunService(input: {
	durableRuntime: SupervisorDurableRuntimeClient;
	store: RuntimeRunStore;
}): RuntimeRunService {
	function validateSubscriptionPolicy(
		policy?: RuntimeRunEventSubscriptionPolicy,
	): Required<RuntimeRunEventSubscriptionPolicy> {
		const maxAttempts = policy?.maxAttempts ?? DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY.maxAttempts;
		const pollIntervalMs =
			policy?.pollIntervalMs ?? DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY.pollIntervalMs;
		if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
			throw new AppApiRouteError({
				code: "invalid_request",
				message: "run event subscription maxAttempts must be a positive integer.",
				retryable: false,
				status: 400,
			});
		}
		if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) {
			throw new AppApiRouteError({
				code: "invalid_request",
				message: "run event subscription pollIntervalMs must be a non-negative integer.",
				retryable: false,
				status: 400,
			});
		}
		return {
			maxAttempts,
			pollIntervalMs,
			sleep:
				policy?.sleep ??
				((durationMs) => new Promise<void>((resolve) => setTimeout(resolve, durationMs))),
		};
	}

	async function requireOwnedRun(
		principal: ResolvedAppPrincipal,
		runId: string,
	): Promise<RuntimeRunOwnershipRecord> {
		if (!principal.permissions.chat) {
			throw new AppApiRouteError({
				code: "forbidden",
				message: "Chat access is not available for this principal.",
				retryable: false,
				status: 403,
			});
		}
		const normalizedRunId = runId.trim();
		if (!normalizedRunId) {
			throw new AppApiRouteError({
				code: "invalid_request",
				message: "run_id is required.",
				retryable: false,
				status: 400,
			});
		}

		const owned = await input.store.getOwnedRun({
			ownerUserId: principal.actor.userId,
			runId: normalizedRunId,
		});
		if (!owned) {
			throw new AppApiRouteError({
				code: "run_not_found",
				message: "Run not found.",
				retryable: false,
				status: 404,
			});
		}
		return owned;
	}

	function assertRunMatchesOwnership(
		owned: RuntimeRunOwnershipRecord,
		run: SupervisorDurableRun,
	): void {
		if (
			run.runId !== owned.runId ||
			run.requestId !== owned.requestId ||
			run.conversationId !== owned.conversationId ||
			run.traceId !== owned.traceId
		) {
			throw new SupervisorTransportError({
				code: "supervisor_invalid_response",
				message: "Supervisor durable run identity does not match app-api request ownership.",
				retryable: true,
				status: 502,
			});
		}
	}

	function toRunSummary(run: SupervisorDurableRun): RuntimeRunSummary {
		return {
			conversationId: run.conversationId,
			phase: runtimeRunPhaseFromSupervisorStatus(run.status),
			requestId: run.requestId,
			runId: run.runId,
			status: run.status,
			terminalReason: run.terminalReason || undefined,
			traceId: run.traceId,
		};
	}

	function toBrowserRunEvent(event: SupervisorDurableRunEvent): RuntimeRunEventProjection | null {
		if (event.visibility !== "browser") {
			return null;
		}
		return {
			eventId: event.eventId,
			eventType: event.eventType,
			occurredAt: event.occurredAt,
			payload: event.payload,
			runId: event.runId,
			sequence: event.sequence,
			visibility: event.visibility,
		};
	}

	function isTerminalRunEvent(event: RuntimeRunEventProjection): boolean {
		return (
			event.eventType === "finalization.completed" ||
			event.eventType === "run.completed" ||
			event.eventType === "run.failed" ||
			event.eventType === "run.canceled" ||
			event.eventType === "run.expired"
		);
	}

	function assertSequenceAdvances(
		lastSequence: number,
		event: Pick<RuntimeRunEventProjection, "sequence">,
	): number {
		if (!Number.isInteger(event.sequence) || event.sequence <= lastSequence) {
			throw new SupervisorTransportError({
				code: "supervisor_invalid_response",
				message: "Supervisor durable run events must advance the requested cursor.",
				retryable: true,
				status: 502,
			});
		}
		return event.sequence;
	}

	async function listEvents(eventsInput: {
		afterSequence?: number;
		principal: ResolvedAppPrincipal;
		runId: string;
	}): Promise<{ events: RuntimeRunEventProjection[]; run: RuntimeRunSummary }> {
		const owned = await requireOwnedRun(eventsInput.principal, eventsInput.runId);
		const run = await input.durableRuntime.getRun({
			runId: owned.runId,
			traceId: owned.traceId,
		});
		assertRunMatchesOwnership(owned, run);
		const events = await input.durableRuntime.listRunEvents({
			afterSequence: eventsInput.afterSequence,
			runId: owned.runId,
			traceId: owned.traceId,
		});
		let lastSequence = eventsInput.afterSequence ?? 0;
		const browserEvents: RuntimeRunEventProjection[] = [];
		for (const event of events) {
			if (event.runId !== owned.runId) {
				throw new SupervisorTransportError({
					code: "supervisor_invalid_response",
					message: "Supervisor durable run event identity does not match requested run.",
					retryable: true,
					status: 502,
				});
			}
			lastSequence = assertSequenceAdvances(lastSequence, event);
			const browserEvent = toBrowserRunEvent(event);
			if (browserEvent) {
				browserEvents.push(browserEvent);
			}
		}
		return {
			events: browserEvents,
			run: toRunSummary(run),
		};
	}

	return {
		async cancel(cancelInput) {
			const owned = await requireOwnedRun(cancelInput.principal, cancelInput.runId);
			const run = await input.durableRuntime.cancelRun({
				reason: cancelInput.reason.trim(),
				runId: owned.runId,
				traceId: owned.traceId,
			});
			assertRunMatchesOwnership(owned, run);
			return { run: toRunSummary(run) };
		},
		async getStatus(statusInput) {
			const owned = await requireOwnedRun(statusInput.principal, statusInput.runId);
			const run = await input.durableRuntime.getRun({
				runId: owned.runId,
				traceId: owned.traceId,
			});
			assertRunMatchesOwnership(owned, run);
			return { run: toRunSummary(run) };
		},
		listEvents,
		async *subscribeEvents(eventsInput) {
			const polling = validateSubscriptionPolicy(eventsInput.polling);
			let lastSequence = eventsInput.afterSequence ?? 0;
			for (let attempt = 0; attempt < polling.maxAttempts; attempt += 1) {
				const result = await listEvents({
					afterSequence: lastSequence,
					principal: eventsInput.principal,
					runId: eventsInput.runId,
				});
				for (const event of result.events) {
					lastSequence = assertSequenceAdvances(lastSequence, event);
					yield event;
					if (isTerminalRunEvent(event)) {
						return;
					}
				}
				if (attempt + 1 < polling.maxAttempts && polling.pollIntervalMs > 0) {
					await polling.sleep(polling.pollIntervalMs);
				}
			}
		},
	};
}

export function buildDefaultRuntimeRunService(env: Env): RuntimeRunService {
	return buildRuntimeRunService({
		durableRuntime: createSupervisorDurableRuntimeClient(env),
		store: createPgRuntimeRunStore(env),
	});
}
