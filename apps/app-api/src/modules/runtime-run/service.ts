import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
	type ExecutionControlRun,
	type ExecutionControlRuntimeClient,
	ExecutionControlTransportError,
} from "../integration";
import { toBrowserRunEvent } from "./browser-projection";
import type {
	RuntimeRunCancellationRecord,
	RuntimeRunEventProjection,
	RuntimeRunEventSubscriptionPolicy,
	RuntimeRunOwnershipRecord,
	RuntimeRunPhase,
	RuntimeRunService,
	RuntimeRunStep,
	RuntimeRunStepPhase,
	RuntimeRunStepStatus,
	RuntimeRunStore,
	RuntimeRunSummary,
} from "./types";
import { runtimeRunPhaseFromExecutionStatus } from "./types";

const DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY = {
	maxAttempts: 180,
	waitMs: 25_000,
} as const;

const RUNTIME_RUN_STEP_PHASES: RuntimeRunStepPhase[] = [
	"queued",
	"preparing",
	"retrieving",
	"generating",
	"finalizing",
];

function normalizeRunTimestamp(value: string | null | undefined): string | null {
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	const date = new Date(value);
	return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function durationMsBetween(startedAt: string | null, completedAt: string | null): number | null {
	if (!(startedAt && completedAt)) {
		return null;
	}
	const started = new Date(startedAt).valueOf();
	const completed = new Date(completedAt).valueOf();
	if (!(Number.isFinite(started) && Number.isFinite(completed)) || completed < started) {
		return null;
	}
	return completed - started;
}

function isTerminalExecutionStatus(status: string): boolean {
	return (
		status === "completed" || status === "failed" || status === "canceled" || status === "expired"
	);
}

function terminalStepStatus(phase: RuntimeRunPhase): RuntimeRunStepStatus {
	if (phase === "canceled") {
		return "cancelled";
	}
	if (phase === "failed" || phase === "expired") {
		return "failed";
	}
	return "completed";
}

function isTerminalRuntimePhase(phase: RuntimeRunPhase): boolean {
	return phase === "completed" || phase === "failed" || phase === "canceled" || phase === "expired";
}

function productPhaseFromRunEvent(event: RuntimeRunEventProjection): RuntimeRunStepPhase | null {
	if (event.eventType === "execution.queued") {
		return "queued";
	}
	if (event.eventType === "execution.running") {
		return "preparing";
	}
	if (event.eventType === "execution.phase") {
		const phase = event.payload.phase;
		return RUNTIME_RUN_STEP_PHASES.includes(phase as RuntimeRunStepPhase)
			? (phase as RuntimeRunStepPhase)
			: null;
	}
	if (event.eventType === "answer.delta") {
		return "generating";
	}
	if (event.eventType === "request.completed") {
		return "finalizing";
	}
	return null;
}

function terminalEventStatus(event: RuntimeRunEventProjection): RuntimeRunStepStatus | null {
	if (event.eventType === "request.completed") {
		return "completed";
	}
	if (event.eventType === "request.failed") {
		return "failed";
	}
	if (event.eventType === "request.cancelled") {
		return "cancelled";
	}
	return null;
}

function activePhaseFallback(run: RuntimeRunSummary): RuntimeRunStepPhase {
	if (run.phase === "created" || run.phase === "queued" || run.phase === "admitted") {
		return "queued";
	}
	if (run.phase === "streaming") {
		return "generating";
	}
	return "preparing";
}

function deriveRunSteps(
	events: RuntimeRunEventProjection[],
	run: RuntimeRunSummary,
): RuntimeRunStep[] {
	const steps: RuntimeRunStep[] = RUNTIME_RUN_STEP_PHASES.map((phase) => ({
		completedAt: null,
		durationMs: null,
		phase,
		startedAt: null,
		status: "pending",
	}));
	let activeIndex = -1;

	const closeStep = (
		index: number,
		completedAt: string,
		status: RuntimeRunStepStatus = "completed",
	) => {
		const step = steps[index];
		if (!step) {
			return;
		}
		step.status = status;
		step.completedAt = completedAt;
		step.durationMs = durationMsBetween(step.startedAt, completedAt);
	};

	const advanceTo = (phase: RuntimeRunStepPhase, occurredAt: string) => {
		const targetIndex = RUNTIME_RUN_STEP_PHASES.indexOf(phase);
		if (targetIndex < 0 || targetIndex < activeIndex) {
			return;
		}
		if (activeIndex === targetIndex) {
			const current = steps[targetIndex];
			if (current && !current.startedAt) {
				current.startedAt = occurredAt;
				current.status = "running";
			}
			return;
		}
		if (activeIndex >= 0) {
			closeStep(activeIndex, occurredAt);
		}
		for (let index = Math.max(activeIndex + 1, 0); index < targetIndex; index += 1) {
			const skipped = steps[index];
			if (skipped?.status === "pending") {
				skipped.status = "completed";
				skipped.completedAt = occurredAt;
			}
		}
		const target = steps[targetIndex];
		if (target) {
			target.startedAt = target.startedAt ?? occurredAt;
			target.status = "running";
		}
		activeIndex = targetIndex;
	};

	for (const event of events) {
		const occurredAt = normalizeRunTimestamp(event.occurredAt);
		if (!occurredAt) {
			continue;
		}
		const phase = productPhaseFromRunEvent(event);
		if (phase) {
			advanceTo(phase, occurredAt);
		}
		const terminalStatus = terminalEventStatus(event);
		if (terminalStatus) {
			if (terminalStatus === "completed") {
				advanceTo("finalizing", occurredAt);
			}
			const terminalIndex = activeIndex >= 0 ? activeIndex : 0;
			closeStep(terminalIndex, occurredAt, terminalStatus);
			activeIndex = terminalIndex;
		}
	}

	if (activeIndex < 0) {
		if (isTerminalRuntimePhase(run.phase)) {
			const phase = run.phase === "completed" ? "finalizing" : activePhaseFallback(run);
			const index = RUNTIME_RUN_STEP_PHASES.indexOf(phase);
			const startedAt = run.startedAt ?? run.acceptedAt;
			if (index >= 0) {
				for (let stepIndex = 0; stepIndex < index; stepIndex += 1) {
					const step = steps[stepIndex];
					if (step) {
						step.status = "completed";
					}
				}
				const step = steps[index];
				if (step) {
					step.startedAt = startedAt;
					step.status = terminalStepStatus(run.phase);
					step.completedAt = run.completedAt;
					step.durationMs = durationMsBetween(startedAt, run.completedAt);
				}
			}
		}
		return steps;
	}

	if (isTerminalRuntimePhase(run.phase)) {
		const index = activeIndex;
		const step = steps[index];
		if (step && step.status === "running") {
			const completedAt = run.completedAt ?? step.completedAt;
			if (completedAt) {
				closeStep(index, completedAt, terminalStepStatus(run.phase));
			}
		}
	} else {
		const step = steps[activeIndex];
		if (step && step.status === "pending") {
			step.status = "running";
		}
	}
	return steps;
}

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
		const acceptedAt = normalizeRunTimestamp(run.createdAt) ?? run.createdAt;
		const startedAt = normalizeRunTimestamp(run.startedAt);
		const completedAt = isTerminalExecutionStatus(run.status)
			? normalizeRunTimestamp(run.completedAt)
			: null;
		return {
			acceptedAt,
			completedAt,
			conversationId: run.conversationId,
			durationMs: completedAt ? durationMsBetween(acceptedAt, completedAt) : null,
			phase: runtimeRunPhaseFromExecutionStatus(run.status),
			requestId: run.requestId,
			runId: run.runId,
			startedAt,
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
		const acceptedAt = normalizeRunTimestamp(run.acceptedAt) ?? run.acceptedAt;
		const completedAt = isTerminalExecutionStatus(status)
			? normalizeRunTimestamp(run.completedAt)
			: null;
		return {
			acceptedAt,
			completedAt,
			conversationId: run.conversationId,
			durationMs: completedAt ? durationMsBetween(acceptedAt, completedAt) : null,
			phase,
			requestId: run.requestId,
			runId: run.runId,
			startedAt: null,
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
			event.eventType === "request.cancelled" ||
			event.eventType === "request.completed" ||
			event.eventType === "request.failed"
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
			if (
				owned.status !== "accepted" ||
				owned.admissionStatus === "pending_admission" ||
				owned.admissionStatus === "cancelled" ||
				(owned.admissionStatus === "dispatching" && owned.cancelOutboxStatus !== "not_requested")
			) {
				return {
					run: toLocalRunSummary(owned),
					steps: RUNTIME_RUN_STEP_PHASES.map((phase) => ({
						completedAt: null,
						durationMs: null,
						phase,
						startedAt: null,
						status: "pending",
					})),
				};
			}
			const run = await input.executionRuntime.getRun({
				runId: owned.runId,
				traceId: owned.traceId,
			});
			assertRunMatchesOwnership(owned, run);
			const eventTimeline = await listEvents({
				afterSequence: 0,
				principal: stepsInput.principal,
				runId: owned.runId,
			});
			return {
				run: toRunSummary(run),
				steps: deriveRunSteps(eventTimeline.events, toRunSummary(run)),
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
