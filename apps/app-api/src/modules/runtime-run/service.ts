import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
	type ExecutionControlRun,
	type ExecutionControlRuntimeClient,
	ExecutionControlTransportError,
} from "../integration";
import { toBrowserRunEvent } from "./browser-projection";
import type {
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
	ensureRun?: (input: { requestId: string }) => Promise<ExecutionControlRun>;
	store: RuntimeRunStore;
}): RuntimeRunService {
	function ensureMissingRun(error: unknown, owned: RuntimeRunOwnershipRecord) {
		if (
			owned.status === "accepted" &&
			error instanceof ExecutionControlTransportError &&
			error.status === 404 &&
			(error.code === "durable_run_not_found" || error.code === "execution_run_not_found")
		) {
			if (!input.ensureRun) {
				throw error;
			}
			return input.ensureRun;
		}
		throw error;
	}

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
		requestId: string,
	): Promise<RuntimeRunOwnershipRecord> {
		if (!principal.permissions.chat) {
			throw new AppApiRouteError({
				code: "forbidden",
				message: "Chat access is not available for this principal.",
				retryable: false,
				status: 403,
			});
		}
		const normalizedRequestId = requestId.trim();
		if (!normalizedRequestId) {
			throw new AppApiRouteError({
				code: "invalid_request",
				message: "request_id is required.",
				retryable: false,
				status: 400,
			});
		}

		const owned = await input.store.getOwnedRun({
			ownerUserId: principal.actor.userId,
			requestId: normalizedRequestId,
		});
		if (!owned) {
			throw new AppApiRouteError({
				code: "request_not_found",
				message: "Request not found.",
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
		if (run.requestId !== owned.requestId || run.conversationId !== owned.conversationId) {
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
			startedAt,
			status: run.status,
			...(run.terminalReason ? { terminalReason: run.terminalReason } : {}),
		};
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

	async function listDurableEventPage(eventsInput: {
		afterSequence?: number;
		owned: RuntimeRunOwnershipRecord;
		run: ExecutionControlRun;
		signal?: AbortSignal;
		waitMs?: number;
	}): Promise<{
		events: RuntimeRunEventProjection[];
		nextSequence: number;
		run: RuntimeRunSummary;
	}> {
		const page = await input.executionRuntime.listRunEvents({
			...(eventsInput.afterSequence === undefined
				? {}
				: { afterSequence: eventsInput.afterSequence }),
			requestId: eventsInput.owned.requestId,
			...(eventsInput.signal ? { signal: eventsInput.signal } : {}),
			...(eventsInput.waitMs === undefined ? {} : { waitMs: eventsInput.waitMs }),
		});
		let lastSequence = eventsInput.afterSequence ?? 0;
		const browserEvents: RuntimeRunEventProjection[] = [];
		for (const event of page.events) {
			if (event.requestId !== eventsInput.owned.requestId) {
				throw new ExecutionControlTransportError({
					code: "execution_control_invalid_response",
					message: "Execution durable request event identity does not match requested request.",
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
			run: toRunSummary(eventsInput.run),
		};
	}

	async function listEvents(eventsInput: {
		afterSequence?: number;
		principal: ResolvedAppPrincipal;
		requestId: string;
		signal?: AbortSignal;
		waitMs?: number;
	}): Promise<{
		events: RuntimeRunEventProjection[];
		nextSequence: number;
		run: RuntimeRunSummary;
	}> {
		const owned = await requireOwnedRun(eventsInput.principal, eventsInput.requestId);
		let run: ExecutionControlRun;
		try {
			run = await input.executionRuntime.getRun({
				requestId: owned.requestId,
				...(eventsInput.signal ? { signal: eventsInput.signal } : {}),
			});
		} catch (error) {
			run = await ensureMissingRun(
				error,
				owned,
			)({
				requestId: owned.requestId,
			});
		}
		assertRunMatchesOwnership(owned, run);
		return listDurableEventPage({
			...(eventsInput.afterSequence === undefined
				? {}
				: { afterSequence: eventsInput.afterSequence }),
			owned,
			run,
			...(eventsInput.signal ? { signal: eventsInput.signal } : {}),
			...(eventsInput.waitMs === undefined ? {} : { waitMs: eventsInput.waitMs }),
		});
	}

	return {
		async cancel(cancelInput) {
			const owned = await requireOwnedRun(cancelInput.principal, cancelInput.requestId);
			let current: ExecutionControlRun;
			try {
				current = await input.executionRuntime.getRun({
					requestId: owned.requestId,
				});
			} catch (error) {
				current = await ensureMissingRun(
					error,
					owned,
				)({
					requestId: owned.requestId,
				});
			}
			assertRunMatchesOwnership(owned, current);
			if (isTerminalExecutionStatus(current.status)) {
				throw new AppApiRouteError({
					code: "request_already_terminal",
					message: "Request is already terminal.",
					retryable: false,
					status: 409,
				});
			}
			const remote = await input.executionRuntime.cancelRun({
				reason: cancelInput.reason.trim() || "user_requested",
				requestId: owned.requestId,
			});
			assertRunMatchesOwnership(owned, remote);
			return { run: toRunSummary(remote) };
		},
		async getStatus(statusInput) {
			const owned = await requireOwnedRun(statusInput.principal, statusInput.requestId);
			let run: ExecutionControlRun;
			try {
				run = await input.executionRuntime.getRun({
					requestId: owned.requestId,
				});
			} catch (error) {
				run = await ensureMissingRun(
					error,
					owned,
				)({
					requestId: owned.requestId,
				});
			}
			assertRunMatchesOwnership(owned, run);
			return { run: toRunSummary(run) };
		},
		listEvents,
		async listSteps(stepsInput) {
			const owned = await requireOwnedRun(stepsInput.principal, stepsInput.requestId);
			let run: ExecutionControlRun;
			try {
				run = await input.executionRuntime.getRun({
					requestId: owned.requestId,
				});
			} catch (error) {
				run = await ensureMissingRun(
					error,
					owned,
				)({
					requestId: owned.requestId,
				});
			}
			assertRunMatchesOwnership(owned, run);
			const eventTimeline = await listDurableEventPage({
				afterSequence: 0,
				owned,
				run,
			});
			return {
				run: eventTimeline.run,
				steps: deriveRunSteps(eventTimeline.events, eventTimeline.run),
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
					requestId: eventsInput.requestId,
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
