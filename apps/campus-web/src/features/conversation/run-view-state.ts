import type { ChatRequestStreamEvent } from "./model";
import type { ChatRunStatus } from "./run-client";

export type CampusRunPhase = "queued" | "preparing" | "generating" | "finalizing";
export type CampusRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type CampusRunConnection = "live" | "reconnecting" | "disconnected";

export interface CampusRunViewState {
	acceptedAt: string | null;
	completedAt: string | null;
	connection: CampusRunConnection;
	durationMs: number | null;
	operationId: number;
	phase: CampusRunPhase;
	provisional: boolean;
	requestId: string | null;
	runId: string | null;
	sequence: number;
	startedAt: string | null;
	status: CampusRunStatus;
}

export const EMPTY_CAMPUS_RUN_VIEW: CampusRunViewState = {
	acceptedAt: null,
	completedAt: null,
	connection: "live",
	durationMs: null,
	operationId: 0,
	phase: "queued",
	provisional: false,
	requestId: null,
	runId: null,
	sequence: 0,
	startedAt: null,
	status: "queued",
};

export type CampusRunViewAction =
	| {
			type: "start";
			acceptedAt: string;
			operationId: number;
	  }
	| {
			runId?: string | null;
			type: "reset";
			operationId: number;
	  }
	| {
			event: ChatRequestStreamEvent;
			operationId: number;
			type: "event";
	  }
	| {
			connection: CampusRunConnection;
			operationId: number;
			runId?: string | null;
			type: "connection";
	  }
	| {
			operationId: number;
			run: ChatRunStatus;
			sequence?: number;
			type: "hydrate";
	  }
	| {
			operationId: number;
			runId?: string | null;
			type: "rebind";
	  };

function isTerminalStatus(status: CampusRunStatus): boolean {
	return status === "completed" || status === "failed" || status === "cancelled";
}

function phaseFromRunStatus(run: ChatRunStatus): CampusRunPhase {
	if (run.phase === "completed") {
		return "finalizing";
	}
	if (run.phase === "streaming") {
		return "generating";
	}
	if (run.phase === "created" || run.phase === "queued" || run.phase === "admitted") {
		return "queued";
	}
	return "preparing";
}

function statusFromRunStatus(run: ChatRunStatus): CampusRunStatus {
	if (run.phase === "completed") {
		return "completed";
	}
	if (run.phase === "failed" || run.phase === "expired" || run.status === "failed") {
		return "failed";
	}
	if (run.phase === "canceled" || run.status === "canceled") {
		return "cancelled";
	}
	if (run.phase === "created" || run.phase === "queued" || run.phase === "admitted") {
		return "queued";
	}
	return "running";
}

function durationBetween(startedAt: string | null, completedAt: string | null): number | null {
	if (!(startedAt && completedAt)) {
		return null;
	}
	const started = Date.parse(startedAt);
	const completed = Date.parse(completedAt);
	return Number.isFinite(started) && Number.isFinite(completed) && completed >= started
		? completed - started
		: null;
}

function eventRunId(event: ChatRequestStreamEvent): string | null {
	return typeof event.data.runId === "string" && event.data.runId.trim()
		? event.data.runId.trim()
		: null;
}

function acceptsEvent(
	state: CampusRunViewState,
	operationId: number,
	event: ChatRequestStreamEvent,
) {
	if (state.operationId !== operationId) {
		return false;
	}
	const runId = eventRunId(event);
	if (state.runId && runId && state.runId !== runId) {
		return false;
	}
	if (event.data.sequence !== undefined && event.data.sequence <= state.sequence) {
		return false;
	}
	if (isTerminalStatus(state.status)) {
		return false;
	}
	return true;
}

function updateSequence(state: CampusRunViewState, event: ChatRequestStreamEvent): number {
	return event.data.sequence === undefined ? state.sequence : event.data.sequence;
}

function applyEvent(
	state: CampusRunViewState,
	operationId: number,
	event: ChatRequestStreamEvent,
): CampusRunViewState {
	if (!acceptsEvent(state, operationId, event)) {
		return state;
	}
	const occurredAt = event.data.occurredAt || null;
	const runId = eventRunId(event) ?? state.runId;
	const base = {
		...state,
		connection: "live" as const,
		operationId,
		provisional: state.provisional && !runId,
		requestId: event.data.requestId || state.requestId,
		runId,
		sequence: updateSequence(state, event),
	};

	switch (event.event) {
		case "request.accepted":
			return {
				...base,
				acceptedAt: state.acceptedAt ?? occurredAt,
				phase: "queued",
				provisional: false,
				status: "queued",
			};
		case "execution.queued":
			return {
				...base,
				acceptedAt: state.acceptedAt ?? occurredAt,
				phase: "queued",
				status: "queued",
			};
		case "execution.running":
			return {
				...base,
				acceptedAt: state.acceptedAt ?? occurredAt,
				phase: "preparing",
				startedAt: state.startedAt ?? occurredAt,
				status: "running",
			};
		case "execution.phase":
			return {
				...base,
				acceptedAt: state.acceptedAt ?? occurredAt,
				phase: event.data.phase ?? state.phase,
				startedAt: state.startedAt ?? occurredAt,
				status: "running",
			};
		case "answer.delta":
			return {
				...base,
				acceptedAt: state.acceptedAt ?? occurredAt,
				phase: "generating",
				startedAt: state.startedAt ?? occurredAt,
				status: "running",
			};
		case "request.completed":
			return {
				...base,
				completedAt: occurredAt,
				durationMs: durationBetween(state.acceptedAt ?? occurredAt, occurredAt),
				phase: "finalizing",
				provisional: false,
				status: "completed",
			};
		case "request.failed":
			return {
				...base,
				completedAt: occurredAt,
				durationMs: durationBetween(state.acceptedAt ?? occurredAt, occurredAt),
				provisional: false,
				status: "failed",
			};
		case "request.cancelled":
			return {
				...base,
				completedAt: occurredAt,
				durationMs: durationBetween(state.acceptedAt ?? occurredAt, occurredAt),
				provisional: false,
				status: "cancelled",
			};
		default:
			return state;
	}
}

export function reduceCampusRunViewState(
	state: CampusRunViewState,
	action: CampusRunViewAction,
): CampusRunViewState {
	switch (action.type) {
		case "reset":
			return {
				...EMPTY_CAMPUS_RUN_VIEW,
				operationId: action.operationId,
				runId: action.runId ?? null,
			};
		case "start":
			return {
				...EMPTY_CAMPUS_RUN_VIEW,
				acceptedAt: action.acceptedAt,
				operationId: action.operationId,
				provisional: true,
			};
		case "connection":
			if (
				state.operationId !== action.operationId ||
				(action.runId !== undefined && action.runId !== state.runId)
			) {
				return state;
			}
			return { ...state, connection: action.connection };
		case "hydrate": {
			if (
				state.operationId !== action.operationId ||
				(state.runId && state.runId !== action.run.runId) ||
				(action.sequence !== undefined && action.sequence < state.sequence)
			) {
				return state;
			}
			const status = statusFromRunStatus(action.run);
			if (isTerminalStatus(state.status) && status !== state.status) {
				return state;
			}
			return {
				...state,
				acceptedAt: action.run.acceptedAt,
				completedAt: action.run.completedAt,
				connection: "live",
				durationMs: action.run.durationMs,
				phase: phaseFromRunStatus(action.run),
				provisional: false,
				requestId: action.run.requestId,
				runId: action.run.runId,
				sequence: action.sequence ?? state.sequence,
				startedAt: action.run.startedAt,
				status,
			};
		}
		case "rebind":
			if (state.operationId === action.operationId) {
				return state;
			}
			if (action.runId !== undefined && state.runId && state.runId !== action.runId) {
				return state;
			}
			return {
				...state,
				connection: "reconnecting",
				operationId: action.operationId,
				...(action.runId === undefined ? {} : { runId: action.runId }),
			};
		case "event":
			return applyEvent(state, action.operationId, action.event);
		default:
			return state;
	}
}

export function campusRunViewToMetadata(state: CampusRunViewState): Record<string, unknown> {
	return {
		acceptedAt: state.acceptedAt,
		completedAt: state.completedAt,
		connection: state.connection,
		durationMs: state.durationMs,
		phase: state.phase,
		provisional: state.provisional,
		requestId: state.requestId,
		runId: state.runId,
		sequence: state.sequence,
		startedAt: state.startedAt,
		status: state.status,
	};
}

export function readCampusRunViewMetadata(value: unknown): CampusRunViewState | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (
		(record.status !== "queued" &&
			record.status !== "running" &&
			record.status !== "completed" &&
			record.status !== "failed" &&
			record.status !== "cancelled") ||
		(record.phase !== "queued" &&
			record.phase !== "preparing" &&
			record.phase !== "generating" &&
			record.phase !== "finalizing")
	) {
		return null;
	}
	return {
		...EMPTY_CAMPUS_RUN_VIEW,
		acceptedAt: typeof record.acceptedAt === "string" ? record.acceptedAt : null,
		completedAt: typeof record.completedAt === "string" ? record.completedAt : null,
		connection:
			record.connection === "reconnecting" || record.connection === "disconnected"
				? record.connection
				: "live",
		durationMs: typeof record.durationMs === "number" ? record.durationMs : null,
		phase: record.phase,
		provisional: record.provisional === true,
		requestId: typeof record.requestId === "string" ? record.requestId : null,
		runId: typeof record.runId === "string" ? record.runId : null,
		sequence: typeof record.sequence === "number" ? record.sequence : 0,
		startedAt: typeof record.startedAt === "string" ? record.startedAt : null,
		status: record.status,
	};
}
