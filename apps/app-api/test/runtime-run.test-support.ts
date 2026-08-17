import { vi } from "vitest";

import type {
	ExecutionControlRun,
	ExecutionControlRunEvent,
} from "../src/modules/integration/execution-control";
import {
	createPgRuntimeRunStore,
	type RuntimeRunOwnershipRecord,
	type RuntimeRunStore,
} from "../src/modules/runtime-run";

export function durableRun(overrides: Partial<ExecutionControlRun> = {}): ExecutionControlRun {
	return {
		admittedAt: "",
		completedAt: "",
		conversationId: "conv_01HQ",
		createdAt: "2026-06-04T01:02:03.000Z",
		failCloseReason: "",
		finalResponseRef: "",
		taskQueue: "campus-agent.workflow",
		ownerUserId: "user_01HQ",
		queuedAt: "2026-06-04T01:02:03.500Z",
		requestId: "req_01HQ",
		runId: "run_01HQ",
		startedAt: "",
		status: "running",
		streamingStartedAt: "",
		surface: "campus_web",
		terminalReason: "",
		traceId: "trace_01HQ",
		turnId: "turn_01HQ",
		updatedAt: "2026-06-04T01:02:04.000Z",
		...overrides,
	};
}

export function durableEvent(
	overrides: Partial<ExecutionControlRunEvent> & {
		eventType: string;
		sequence: number;
	},
): ExecutionControlRunEvent {
	const { eventType, sequence, ...rest } = overrides;
	return {
		conversationId: "conv_01HQ",
		eventId: `event-${sequence}`,
		eventType,
		occurredAt: "2026-06-04T01:02:06.000Z",
		payload: {},
		payloadSchemaVersion: "run-event-v1",
		runId: "run_01HQ",
		sequence,
		visibility: "browser",
		...rest,
	};
}

export function ownedRun(
	overrides: Partial<RuntimeRunOwnershipRecord> = {},
): RuntimeRunOwnershipRecord {
	return {
		admissionStatus: "admitted",
		cancelOutboxStatus: "not_requested",
		cancelReason: null,
		cancelRequestedAt: null,
		completedAt: null,
		conversationId: "conv_01HQ",
		requestId: "req_01HQ",
		runId: "run_01HQ",
		status: "accepted",
		traceId: "trace_01HQ",
		...overrides,
	};
}

export function runtimeStore(overrides: Partial<RuntimeRunStore> = {}): RuntimeRunStore {
	return {
		getOwnedRun: vi.fn().mockResolvedValue(ownedRun()),
		listPendingCancellations: vi.fn().mockResolvedValue([]),
		markCancellationDelivered: vi.fn().mockResolvedValue(true),
		recordCancellationFailure: vi.fn().mockResolvedValue(true),
		requestCancellation: vi.fn().mockResolvedValue(null),
		...overrides,
	};
}

export function pgRuntimeRunStoreHarness(admissionStatus: "dispatching" | "pending_admission") {
	const currentRow = {
		actorUserId: "user_01HQ",
		admissionStatus,
		cancelOutboxStatus: "not_requested",
		cancelReason: null,
		cancelRequestedAt: null,
		completedAt: null,
		conversationId: "conv_01HQ",
		requestId: "req_01HQ",
		runId: "run_01HQ",
		status: "accepted",
		traceId: "trace_01HQ",
	};
	let updateValues: Record<string, unknown> = {};
	const returning = vi.fn(async () => [{ ...currentRow, ...updateValues }]);
	const updateWhere = vi.fn(() => ({ returning }));
	const set = vi.fn((values: Record<string, unknown>) => {
		updateValues = values;
		return { where: updateWhere };
	});
	const update = vi.fn(() => ({ set }));
	const forUpdate = vi.fn(async () => [currentRow]);
	const limit = vi.fn(() => ({ for: forUpdate }));
	const selectWhere = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where: selectWhere }));
	const select = vi.fn(() => ({ from }));
	const transactionClient = { select, update };
	const transaction = vi.fn(async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
		callback(transactionClient),
	);
	const store = createPgRuntimeRunStore({} as never, {
		getDb: async () => ({ transaction }) as never,
	});
	return { set, store };
}

export function eventPage(events: ExecutionControlRunEvent[], nextSequence?: number) {
	return {
		events,
		nextSequence: nextSequence ?? events.at(-1)?.sequence ?? 0,
	};
}
