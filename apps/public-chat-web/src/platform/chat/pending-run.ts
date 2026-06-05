import type { ChatRunEventProjection, ChatRunPhase, ShellConversationDetail } from "./types";

const PENDING_RUN_STORAGE_KEY = "campus-agent.public-chat.pending-run.v1";

export interface PendingRunState {
	conversationId: string;
	lastSequence: number;
	phase: ChatRunPhase;
	requestId: string;
	runId: string;
	traceId: string;
}

export interface PendingRunStore {
	clear(): void;
	load(): PendingRunState | null;
	save(state: PendingRunState): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePendingRunState(value: unknown): PendingRunState | null {
	if (!isRecord(value)) {
		return null;
	}
	const lastSequence = value.lastSequence;
	if (
		typeof value.conversationId !== "string" ||
		!isChatRunPhase(value.phase) ||
		typeof value.requestId !== "string" ||
		typeof value.runId !== "string" ||
		typeof value.traceId !== "string" ||
		typeof lastSequence !== "number" ||
		!Number.isInteger(lastSequence) ||
		lastSequence < 0
	) {
		return null;
	}
	return {
		conversationId: value.conversationId,
		lastSequence,
		phase: value.phase,
		requestId: value.requestId,
		runId: value.runId,
		traceId: value.traceId,
	};
}

function isChatRunPhase(value: unknown): value is ChatRunPhase {
	return (
		value === "created" ||
		value === "queued" ||
		value === "admitted" ||
		value === "running" ||
		value === "streaming" ||
		value === "completed" ||
		value === "failed" ||
		value === "canceled" ||
		value === "expired"
	);
}

export function createPendingRunStore(storage: Storage): PendingRunStore {
	return {
		clear() {
			storage.removeItem(PENDING_RUN_STORAGE_KEY);
		},
		load() {
			const raw = storage.getItem(PENDING_RUN_STORAGE_KEY);
			if (!raw) {
				return null;
			}
			try {
				return parsePendingRunState(JSON.parse(raw));
			} catch {
				throw new Error("Stored pending durable run state is not valid JSON.");
			}
		},
		save(state) {
			if (!(state.runId.trim() && state.requestId.trim() && state.traceId.trim())) {
				throw new Error("Pending durable run identity is incomplete.");
			}
			if (!Number.isInteger(state.lastSequence) || state.lastSequence < 0) {
				throw new Error("Pending durable run cursor must be a non-negative integer.");
			}
			storage.setItem(PENDING_RUN_STORAGE_KEY, JSON.stringify(state));
		},
	};
}

export function getBrowserPendingRunStore(): PendingRunStore | null {
	if (typeof window === "undefined") {
		return null;
	}
	return createPendingRunStore(window.sessionStorage);
}

export function isTerminalRunEvent(event: Pick<ChatRunEventProjection, "eventType">): boolean {
	return (
		event.eventType === "finalization.completed" ||
		event.eventType === "run.completed" ||
		event.eventType === "run.failed" ||
		event.eventType === "run.canceled" ||
		event.eventType === "run.expired"
	);
}

function phaseFromRunEvent(
	current: ChatRunPhase,
	event: Pick<ChatRunEventProjection, "eventType">,
): ChatRunPhase {
	switch (event.eventType) {
		case "run.created":
			return "created";
		case "run.queued":
			return "queued";
		case "run.admitted":
			return "admitted";
		case "run.started":
			return "running";
		case "run.streaming_started":
		case "run.output_delta":
			return "streaming";
		case "finalization.completed":
		case "run.completed":
			return "completed";
		case "run.failed":
			return "failed";
		case "run.canceled":
			return "canceled";
		case "run.expired":
			return "expired";
		default:
			return current;
	}
}

function assertPendingRunEventMatchesPendingState(
	current: PendingRunState,
	event: ChatRunEventProjection,
) {
	if (event.runId !== current.runId) {
		throw new Error("Durable run event does not match the pending run.");
	}
	if (!Number.isInteger(event.sequence) || event.sequence <= current.lastSequence) {
		throw new Error("Durable run event sequence must advance the pending cursor.");
	}
}

export function recordPendingRunEvent(
	store: PendingRunStore,
	event: ChatRunEventProjection,
): { state: PendingRunState | null; terminal: boolean } {
	const current = store.load();
	if (!current) {
		throw new Error("Pending durable run state is missing.");
	}
	assertPendingRunEventMatchesPendingState(current, event);
	if (isTerminalRunEvent(event)) {
		store.clear();
		return {
			state: null,
			terminal: true,
		};
	}
	const next = {
		...current,
		lastSequence: event.sequence,
		phase: phaseFromRunEvent(current.phase, event),
	};
	store.save(next);
	return {
		state: next,
		terminal: false,
	};
}

export type ResumePendingRunResult =
	| { kind: "none" }
	| { kind: "pending"; state: PendingRunState }
	| { conversation: ShellConversationDetail; kind: "completed" };

export async function resumePendingRun(input: {
	loadConversation(conversationId: string): Promise<ShellConversationDetail>;
	store: PendingRunStore;
	subscribe(input: {
		afterSequence: number;
		runId: string;
		signal?: AbortSignal;
	}): AsyncIterable<ChatRunEventProjection>;
	signal?: AbortSignal;
}): Promise<ResumePendingRunResult> {
	const pending = input.store.load();
	if (!pending) {
		return { kind: "none" };
	}

	for await (const event of input.subscribe({
		afterSequence: pending.lastSequence,
		runId: pending.runId,
		signal: input.signal,
	})) {
		const current = input.store.load();
		if (!current) {
			throw new Error("Pending durable run state is missing.");
		}
		assertPendingRunEventMatchesPendingState(current, event);
		if (isTerminalRunEvent(event)) {
			const conversation = await input.loadConversation(current.conversationId);
			if (conversation.id !== current.conversationId) {
				throw new Error("Durable run terminal conversation does not match the pending run.");
			}
			input.store.clear();
			return {
				conversation,
				kind: "completed",
			};
		}
		recordPendingRunEvent(input.store, event);
	}

	const current = input.store.load();
	return current ? { kind: "pending", state: current } : { kind: "none" };
}
