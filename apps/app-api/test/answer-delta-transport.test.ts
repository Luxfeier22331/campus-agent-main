import { describe, expect, it, vi } from "vitest";
import { parseExecutionFinalizationResponsePayload } from "../src/modules/integration";
import {
	durableRunEventsPath,
	parseDurableRunEvents,
} from "../src/modules/integration/execution-control-runtime-codec";
import { liveRunEvents } from "../src/modules/integration/live-run-events";
import { answerDeltaEventFromDurableRunEvent } from "../src/modules/runtime-command/service/durable";
import { startDurableFinalizationCloseout } from "../src/modules/runtime-command/service/durable-polling";
import type {
	ChatCommandResponse,
	ChatCommandStreamEvent,
} from "../src/modules/runtime-command/service/types";
import { buildRuntimeRunService } from "../src/modules/runtime-run";
import type { RuntimeRunEventProjection } from "../src/modules/runtime-run/types";
import { answerResponsePayload } from "./chat-command.service.durable-cutover.test-support";
import { createPrincipal } from "./chat-command.service.test-support";
import { durableEvent, durableRun, eventPage, runtimeStore } from "./runtime-run.test-support";

const answer = {
	requestId: "req_01HQ",
	messageId: "req_01HQ:answer",
	index: 1,
	delta: "你",
	occurredAt: "2026-10-13T00:00:00Z",
};
describe("temporary answer transport", () => {
	it("parses independent cursors and preserves Unicode and whitespace", () => {
		expect(
			durableRunEventsPath({ requestId: "r", afterSequence: 9, afterAnswerIndex: 2 }),
		).toContain("after_sequence=9&after_answer_index=2");
		const page = parseDurableRunEvents({
			events: [],
			next_sequence: 9,
			answer_deltas: [
				{
					request_id: "req_01HQ",
					message_id: "m",
					index: 3,
					delta: " 😀\n",
					occurred_at: answer.occurredAt,
				},
			],
		});
		expect(page.nextSequence).toBe(9);
		expect(page.answerDeltas?.[0]).toMatchObject({ index: 3, delta: " 😀\n" });
		expect(() =>
			parseDurableRunEvents({ events: [], next_sequence: 9, answer_deltas: [{ index: -1 }] }),
		).toThrow();
	});
	it("does not manufacture a durable sequence for live answers and emits them before a terminal", () => {
		const events = liveRunEvents({
			...eventPage([
				durableEvent({ eventType: "run.answer_started", sequence: 4 }),
				durableEvent({ eventType: "run.completed", sequence: 5 }),
			]),
			answerDeltas: [answer],
		});
		expect(events.map((e) => e.eventType)).toEqual([
			"run.answer_started",
			"answer.delta",
			"run.completed",
		]);
		const delta = events[1];
		if (!delta) {
			throw new Error("Missing live answer fixture");
		}
		expect(delta).not.toHaveProperty("sequence");
		expect(delta).not.toHaveProperty("eventId");
		expect(
			answerDeltaEventFromDurableRunEvent(
				{ requestId: "req_01HQ", acceptedAt: answer.occurredAt },
				delta,
			),
		).toMatchObject({ data: { answerIndex: 1, delta: "你" } });
	});
	it("resumes across pages without moving the durable cursor or repeating deltas", async () => {
		const listRunEvents = vi
			.fn()
			.mockResolvedValueOnce({
				...eventPage([durableEvent({ eventType: "run.answer_started", sequence: 4 })]),
				answerDeltas: [answer],
			})
			.mockResolvedValueOnce({
				...eventPage([], 4),
				answerDeltas: [answer, { ...answer, index: 2, delta: "好" }],
			})
			.mockResolvedValueOnce(
				eventPage([durableEvent({ eventType: "run.completed", sequence: 5 })]),
			);
		const executionRuntime = {
			listRunEvents,
			getRun: vi.fn().mockResolvedValue(durableRun()),
			createRun: vi.fn(),
			cancelRun: vi.fn(),
		};
		const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });
		const events: RuntimeRunEventProjection[] = [];
		for await (const e of service.subscribeEvents({
			requestId: "req_01HQ",
			principal: createPrincipal(),
			afterSequence: 3,
			afterAnswerIndex: 0,
			polling: { maxAttempts: 3, waitMs: 0 },
		})) {
			events.push(e);
		}
		expect(
			events.filter((e) => e.eventType === "answer.delta").map((e) => e.payload.delta),
		).toEqual(["你", "好"]);
		expect(events.at(-1)?.eventType).toBe("request.completed");
		expect(listRunEvents.mock.calls.map(([q]) => [q.afterSequence, q.afterAnswerIndex])).toEqual([
			[3, 0],
			[4, 1],
			[4, 2],
		]);
	});
});

it.each([false, true])(
	"completes from canonical output with or without temporary deltas (%s)",
	async (withDeltas) => {
		const finalized: ChatCommandResponse = {
			requestId: answer.requestId,
			execution: parseExecutionFinalizationResponsePayload(answerResponsePayload("完整答案")),
			answer: {
				conversation: {
					id: "c",
					title: "test",
					createdAt: answer.occurredAt,
					updatedAt: answer.occurredAt,
					activeRequestId: null,
					messages: [],
				},
				result: { kind: "answer", requestId: answer.requestId, text: "完整答案" },
			},
		};
		const page = {
			...eventPage([
				durableEvent({
					eventType: "finalization.completed",
					sequence: 6,
					visibility: "internal",
					payload: { request_id: answer.requestId, response: answerResponsePayload("完整答案") },
				}),
			]),
			answerDeltas: withDeltas ? [answer] : [],
		};
		const finalize = vi.fn(async () => finalized);
		const closeout = startDurableFinalizationCloseout({
			context: { requestId: answer.requestId, acceptedAt: answer.occurredAt },
			listRunEvents: vi.fn(async () => page),
			finalizeAcceptedCommand: finalize,
			now: () => new Date(answer.occurredAt),
			recordStreamAppApiTtft: vi.fn(async () => undefined),
		});
		const events: ChatCommandStreamEvent[] = [];
		for await (const event of closeout.streamEvents()) {
			events.push(event);
		}
		await expect(closeout.completion).resolves.toBe(finalized);
		expect(events.map((e) => e.event)).toEqual(
			withDeltas ? ["answer.delta", "request.completed"] : ["request.completed"],
		);
		expect(events.at(-1)?.data).toMatchObject({ sequence: 6, answer: finalized.answer });
		expect(finalize).toHaveBeenCalledTimes(1);
	},
);
