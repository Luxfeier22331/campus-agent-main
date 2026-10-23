import type {
	RuntimeRunEventProjection,
	RuntimeRunStep,
	RuntimeRunStepPhase,
	RuntimeRunStepStatus,
} from "./types";

const RUNTIME_RUN_STEP_PHASES: RuntimeRunStepPhase[] = [
	"queued",
	"preparing",
	"generating",
	"finalizing",
];

export function normalizeRunTimestamp(value: string | null | undefined): string | null {
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	const date = new Date(value);
	return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

export function durationMsBetween(
	startedAt: string | null,
	completedAt: string | null,
): number | null {
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

export function isTerminalExecutionStatus(status: string): boolean {
	return (
		status === "completed" || status === "failed" || status === "canceled" || status === "expired"
	);
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

export function deriveRunSteps(events: RuntimeRunEventProjection[]): RuntimeRunStep[] {
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
		if (terminalStatus && activeIndex >= 0) {
			closeStep(activeIndex, occurredAt, terminalStatus);
		}
	}

	if (activeIndex >= 0) {
		const step = steps[activeIndex];
		if (step && step.status === "pending") {
			step.status = "running";
		}
	}
	return steps;
}
