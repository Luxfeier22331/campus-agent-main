import { describe, expect, it } from "vitest";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";
import type { ChatRunStatus } from "../src/features/conversation/run-client";
import {
	type CampusRunViewState,
	EMPTY_CAMPUS_RUN_VIEW,
	reduceCampusRunViewState,
} from "../src/features/conversation/run-view-state";

const RUN_TIMES = {
	acceptedAt: "2026-06-18T01:00:00.000Z",
	completedAt: "2026-06-18T01:00:05.000Z",
	startedAt: "2026-06-18T01:00:01.000Z",
};

function run(overrides: Partial<ChatRunStatus> = {}): ChatRunStatus {
	return {
		acceptedAt: RUN_TIMES.acceptedAt,
		completedAt: null,
		conversationId: "conv_01",
		durationMs: null,
		phase: "running",
		requestId: "req_01",
		startedAt: RUN_TIMES.startedAt,
		status: "running",
		...overrides,
	};
}

function event(
	eventName: ChatRequestStreamEvent["event"],
	overrides: Partial<ChatRequestStreamEvent["data"]> = {},
): ChatRequestStreamEvent {
	return {
		data: {
			occurredAt: RUN_TIMES.startedAt,
			requestId: "req_01",
			sequence: 1,
			status: "running",
			...overrides,
		},
		event: eventName,
	};
}

function acceptedState(): CampusRunViewState {
	return reduceCampusRunViewState(
		reduceCampusRunViewState(EMPTY_CAMPUS_RUN_VIEW, {
			acceptedAt: RUN_TIMES.acceptedAt,
			operationId: 7,
			type: "start",
		}),
		{
			event: event("request.accepted", {
				occurredAt: RUN_TIMES.acceptedAt,
				sequence: 1,
				status: "accepted",
			}),
			operationId: 7,
			type: "event",
		},
	);
}

describe("campus run view state", () => {
	it("projects execution phases and records the first start time", () => {
		const next = reduceCampusRunViewState(acceptedState(), {
			event: event("execution.phase", {
				occurredAt: RUN_TIMES.startedAt,
				phase: "generating",
				sequence: 2,
			}),
			operationId: 7,
			type: "event",
		});

		expect(next).toMatchObject({
			connection: "live",
			phase: "generating",
			sequence: 2,
			startedAt: RUN_TIMES.startedAt,
			status: "running",
		});
	});

	it("ignores stale, wrong-operation, and wrong-run events", () => {
		const state = reduceCampusRunViewState(acceptedState(), {
			event: event("execution.running", { sequence: 3 }),
			operationId: 7,
			type: "event",
		});
		const stale = reduceCampusRunViewState(state, {
			event: event("answer.delta", { delta: "旧", messageId: "msg_01", sequence: 3 }),
			operationId: 7,
			type: "event",
		});
		const wrongOperation = reduceCampusRunViewState(state, {
			event: event("answer.delta", { delta: "错误操作", messageId: "msg_01", sequence: 4 }),
			operationId: 8,
			type: "event",
		});
		const wrongRun = reduceCampusRunViewState(state, {
			event: event("answer.delta", {
				delta: "错误运行",
				messageId: "msg_01",
				requestId: "req_other",
				sequence: 4,
			}),
			operationId: 7,
			type: "event",
		});

		expect(stale).toEqual(state);
		expect(wrongOperation).toEqual(state);
		expect(wrongRun).toEqual(state);
	});

	it("accepts a terminal hydrate at the current cursor", () => {
		const state = reduceCampusRunViewState(acceptedState(), {
			event: event("execution.running", { sequence: 4 }),
			operationId: 7,
			type: "event",
		});
		const terminal = reduceCampusRunViewState(state, {
			operationId: 7,
			run: run({
				completedAt: RUN_TIMES.completedAt,
				durationMs: 5_000,
				phase: "failed",
				status: "failed",
			}),
			sequence: state.sequence,
			type: "hydrate",
		});

		expect(terminal).toMatchObject({
			completedAt: RUN_TIMES.completedAt,
			durationMs: 5_000,
			status: "failed",
		});
	});

	it("preserves the local start time when hydrating a run", () => {
		const hydrated = reduceCampusRunViewState(acceptedState(), {
			operationId: 7,
			run: run({ acceptedAt: "2026-06-18T01:00:02.000Z" }),
			type: "hydrate",
		});

		expect(hydrated.acceptedAt).toBe(RUN_TIMES.acceptedAt);
	});

	it("locks a terminal state against later non-terminal hydration or events", () => {
		const completed = reduceCampusRunViewState(acceptedState(), {
			event: event("request.completed", {
				occurredAt: RUN_TIMES.completedAt,
				sequence: 5,
				status: "completed",
			}),
			operationId: 7,
			type: "event",
		});
		const hydratedRunning = reduceCampusRunViewState(completed, {
			operationId: 7,
			run: run(),
			sequence: 99,
			type: "hydrate",
		});
		const lateFailure = reduceCampusRunViewState(completed, {
			event: event("request.failed", {
				sequence: 100,
				status: "failed",
			}),
			operationId: 7,
			type: "event",
		});

		expect(hydratedRunning).toEqual(completed);
		expect(lateFailure).toEqual(completed);
	});

	it("accepts a terminal event sharing the answer delta sequence", () => {
		const state = reduceCampusRunViewState(acceptedState(), {
			event: event("answer.delta", {
				delta: "完整回答",
				messageId: "msg_answer",
				occurredAt: RUN_TIMES.startedAt,
				sequence: 2,
				status: "streaming",
			}),
			operationId: 7,
			type: "event",
		});

		const completed = reduceCampusRunViewState(state, {
			event: event("request.completed", {
				occurredAt: RUN_TIMES.completedAt,
				sequence: 2,
				status: "completed",
			}),
			operationId: 7,
			type: "event",
		});

		expect(completed).toMatchObject({
			completedAt: RUN_TIMES.completedAt,
			phase: "finalizing",
			sequence: 2,
			status: "completed",
		});
	});

	it("keeps a disconnected run disconnected until recovery produces an event", () => {
		const disconnected = reduceCampusRunViewState(
			{ ...acceptedState(), connection: "disconnected" },
			{ operationId: 8, requestId: "req_01", type: "rebind" },
		);
		const mismatched = reduceCampusRunViewState(disconnected, {
			operationId: 9,
			requestId: "req_other",
			type: "rebind",
		});

		expect(disconnected).toMatchObject({
			connection: "disconnected",
			operationId: 8,
			requestId: "req_01",
		});
		expect(mismatched).toEqual(disconnected);

		const recovered = reduceCampusRunViewState(disconnected, {
			event: event("execution.running", { sequence: 2 }),
			operationId: 8,
			type: "event",
		});
		expect(recovered.connection).toBe("live");
	});
});
