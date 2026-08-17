import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
	type ExecutionControlRun,
	type ExecutionControlRuntimeClient,
	ExecutionControlTransportError,
} from "../integration";
import { sanitizeStudentRunStepTrajectory, toBrowserRunEvent } from "./browser-projection";
import type {
	RuntimeRunCancellationRecord,
	RuntimeRunEventProjection,
	RuntimeRunEventSubscriptionPolicy,
	RuntimeRunOwnershipRecord,
	RuntimeRunPhase,
	RuntimeRunService,
	RuntimeRunStore,
	RuntimeRunSummary,
} from "./types";
import { runtimeRunPhaseFromExecutionStatus } from "./types";

const DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY = {
	maxAttempts: 180,
	waitMs: 25_000,
} as const;

export function buildRuntimeRunService(input: {
	executionRuntime: ExecutionControlRuntimeClient;
	finalizeLocalCancellation?: (input: { completedAt: string; runId: string }) => Promise<void>;
	now?: () => Date;
	store: RuntimeRunStore;
}): RuntimeRunService {
	const now = input.now ?? (() => new Date());
	function validateSubscriptionPolicy(
		policy?: RuntimeRunEventSubscriptionPolicy,
	): Required<RuntimeRunEventSubscriptionPolicy> {
		const maxAttempts = policy?.maxAttempts ?? DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY.maxAttempts;
		const waitMs = policy?.waitMs ?? DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY.waitMs;
		if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
			throw new AppApiRouteError({
				code: "invalid_request",
				message: "run event subscription maxAttempts must be a positive integer.",
				retryable: false,
				status: 400,
			});
		}
		if (!Number.isInteger(waitMs) || waitMs < 0) {
			throw new AppApiRouteError({
				code: "invalid_request",
				message: "run event subscription waitMs must be a non-negative integer.",
				retryable: false,
				status: 400,
			});
		}
		return {
			maxAttempts,
			waitMs,
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
		run: ExecutionControlRun,
	): void {
		if (
			run.runId !== owned.runId ||
			run.requestId !== owned.requestId ||
			run.conversationId !== owned.conversationId ||
			run.traceId !== owned.traceId
		) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Execution durable run identity does not match app-api request ownership.",
				retryable: true,
				status: 502,
			});
		}
	}

	function toRunSummary(run: ExecutionControlRun): RuntimeRunSummary {
		return {
			conversationId: run.conversationId,
			phase: runtimeRunPhaseFromExecutionStatus(run.status),
			requestId: run.requestId,
			runId: run.runId,
			status: run.status,
			...(run.terminalReason ? { terminalReason: run.terminalReason } : {}),
			traceId: run.traceId,
		};
	}

	function toLocalRunSummary(
		run: RuntimeRunOwnershipRecord,
		override: { status?: string; terminalReason?: string } = {},
	): RuntimeRunSummary {
		let status = override.status;
		if (!status) {
			switch (run.status) {
				case "accepted":
					status = "pending_admission";
					break;
				case "completed":
				case "needs_clarification":
				case "no_answer":
				case "approval_required":
				case "rejected":
					status = "completed";
					break;
				case "error":
					status = "failed";
					break;
				case "cancelled":
					status = "canceled";
					break;
				default:
					throw new ExecutionControlTransportError({
						code: "runtime_invariant_failed",
						message: "Product run status is not supported.",
						retryable: false,
						status: 500,
					});
			}
		}
		const phase: RuntimeRunPhase =
			status === "canceled"
				? "canceled"
				: status === "completed"
					? "completed"
					: status === "failed"
						? "failed"
						: "queued";
		return {
			conversationId: run.conversationId,
			phase,
			requestId: run.requestId,
			runId: run.runId,
			status,
			...(override.terminalReason || run.cancelReason
				? { terminalReason: override.terminalReason ?? run.cancelReason ?? "" }
				: {}),
			traceId: run.traceId,
		};
	}

	async function finalizeLocalCancellation(
		run: RuntimeRunCancellationRecord,
	): Promise<RuntimeRunSummary> {
		if (!input.finalizeLocalCancellation) {
			throw new ExecutionControlTransportError({
				code: "dependency_not_ready",
				message: "Local run cancellation finalization is not configured.",
				retryable: true,
				status: 503,
			});
		}
		await input.finalizeLocalCancellation({
			completedAt: run.requestedAt,
			runId: run.runId,
		});
		return toLocalRunSummary(run, {
			status: "canceled",
			terminalReason: run.cancelReason ?? "user_requested",
		});
	}

	async function deliverRemoteCancellation(
		run: RuntimeRunCancellationRecord,
	): Promise<ExecutionControlRun> {
		try {
			const remote = await input.executionRuntime.cancelRun({
				reason: run.cancelReason ?? "user_requested",
				runId: run.runId,
				traceId: run.traceId,
			});
			assertRunMatchesOwnership(run, remote);
			await input.store.markCancellationDelivered({
				deliveredAt: now().toISOString(),
				runId: run.runId,
			});
			return remote;
		} catch (error) {
			await input.store.recordCancellationFailure({
				errorCode:
					error instanceof ExecutionControlTransportError
						? error.code
						: "execution_control_unavailable",
				failedAt: now().toISOString(),
				runId: run.runId,
			});
			throw error;
		}
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

	function isTerminalRunPhase(phase: RuntimeRunPhase): boolean {
		return (
			phase === "completed" || phase === "failed" || phase === "canceled" || phase === "expired"
		);
	}

	function assertSequenceAdvances(
		lastSequence: number,
		event: Pick<RuntimeRunEventProjection, "sequence">,
	): number {
		if (!Number.isInteger(event.sequence) || event.sequence <= lastSequence) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Execution durable run events must advance the requested cursor.",
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
		signal?: AbortSignal;
		waitMs?: number;
	}): Promise<{
		events: RuntimeRunEventProjection[];
		nextSequence: number;
		run: RuntimeRunSummary;
	}> {
		const owned = await requireOwnedRun(eventsInput.principal, eventsInput.runId);
		const run = await input.executionRuntime.getRun({
			runId: owned.runId,
			...(eventsInput.signal ? { signal: eventsInput.signal } : {}),
			traceId: owned.traceId,
		});
		assertRunMatchesOwnership(owned, run);
		const page = await input.executionRuntime.listRunEvents({
			...(eventsInput.afterSequence === undefined
				? {}
				: { afterSequence: eventsInput.afterSequence }),
			runId: owned.runId,
			...(eventsInput.signal ? { signal: eventsInput.signal } : {}),
			traceId: owned.traceId,
			...(eventsInput.waitMs === undefined ? {} : { waitMs: eventsInput.waitMs }),
		});
		let lastSequence = eventsInput.afterSequence ?? 0;
		const browserEvents: RuntimeRunEventProjection[] = [];
		for (const event of page.events) {
			if (event.runId !== owned.runId) {
				throw new ExecutionControlTransportError({
					code: "execution_control_invalid_response",
					message: "Execution durable run event identity does not match requested run.",
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
		if (!Number.isInteger(page.nextSequence) || page.nextSequence < lastSequence) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Execution durable run event page returned a stale next_sequence.",
				retryable: true,
				status: 502,
			});
		}
		return {
			events: browserEvents,
			nextSequence: page.nextSequence,
			run: toRunSummary(run),
		};
	}

	return {
		async cancel(cancelInput) {
			await requireOwnedRun(cancelInput.principal, cancelInput.runId);
			const decision = await input.store.requestCancellation({
				ownerUserId: cancelInput.principal.actor.userId,
				reason: cancelInput.reason.trim(),
				requestedAt: now().toISOString(),
				runId: cancelInput.runId.trim(),
			});
			if (!decision) {
				throw new AppApiRouteError({
					code: "run_not_found",
					message: "Run not found.",
					retryable: false,
					status: 404,
				});
			}
			if (decision.kind === "local_finalization") {
				return { run: await finalizeLocalCancellation(decision.run) };
			}
			if (decision.kind === "terminal") {
				throw new AppApiRouteError({
					code: "run_already_terminal",
					message: "Run is already terminal.",
					retryable: false,
					status: 409,
				});
			}
			if (decision.kind === "remote_delivered") {
				const remote = await input.executionRuntime.getRun({
					runId: decision.run.runId,
					traceId: decision.run.traceId,
				});
				assertRunMatchesOwnership(decision.run, remote);
				return { run: toRunSummary(remote) };
			}
			return { run: toRunSummary(await deliverRemoteCancellation(decision.run)) };
		},
		async dispatchPendingCancellations(dispatchInput = {}) {
			const candidates = await input.store.listPendingCancellations({
				limit: dispatchInput.limit ?? 25,
			});
			let delivered = 0;
			let failed = 0;
			let finalized = 0;
			for (const candidate of candidates) {
				try {
					if (candidate.kind === "local_finalization") {
						await finalizeLocalCancellation(candidate.run);
						finalized += 1;
					} else {
						await deliverRemoteCancellation(candidate.run);
						delivered += 1;
					}
				} catch {
					failed += 1;
				}
			}
			return { delivered, failed, finalized, processed: candidates.length };
		},
		async getStatus(statusInput) {
			const owned = await requireOwnedRun(statusInput.principal, statusInput.runId);
			if (
				owned.status !== "accepted" ||
				owned.admissionStatus === "pending_admission" ||
				owned.admissionStatus === "cancelled" ||
				(owned.admissionStatus === "dispatching" && owned.cancelOutboxStatus !== "not_requested")
			) {
				return { run: toLocalRunSummary(owned) };
			}
			const run = await input.executionRuntime.getRun({
				runId: owned.runId,
				traceId: owned.traceId,
			});
			assertRunMatchesOwnership(owned, run);
			return { run: toRunSummary(run) };
		},
		listEvents,
		async listSteps(stepsInput) {
			const owned = await requireOwnedRun(stepsInput.principal, stepsInput.runId);
			const run = await input.executionRuntime.getRun({
				runId: owned.runId,
				traceId: owned.traceId,
			});
			assertRunMatchesOwnership(owned, run);
			const trajectory = await input.executionRuntime.listRunSteps({
				runId: owned.runId,
				traceId: owned.traceId,
			});
			return {
				...sanitizeStudentRunStepTrajectory(trajectory),
				run: toRunSummary(run),
			};
		},
		async *subscribeEvents(eventsInput) {
			const polling = validateSubscriptionPolicy(eventsInput.polling);
			let lastSequence = eventsInput.afterSequence ?? 0;
			for (let attempt = 0; attempt < polling.maxAttempts; attempt += 1) {
				if (eventsInput.signal?.aborted) {
					throw new DOMException("The operation was aborted.", "AbortError");
				}
				const result = await listEvents({
					afterSequence: lastSequence,
					principal: eventsInput.principal,
					runId: eventsInput.runId,
					...(eventsInput.signal ? { signal: eventsInput.signal } : {}),
					waitMs: polling.waitMs,
				});
				for (const event of result.events) {
					lastSequence = assertSequenceAdvances(lastSequence, event);
					yield event;
					if (isTerminalRunEvent(event)) {
						return;
					}
				}
				if (isTerminalRunPhase(result.run.phase)) {
					return;
				}
				lastSequence = result.nextSequence;
			}
		},
	};
}
