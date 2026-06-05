import { describe, expect, it } from "vitest";

import {
	createPendingRunStore,
	isTerminalRunEvent,
	recordPendingRunEvent,
	resumePendingRun,
} from "../src/platform/chat/pending-run";
import type { ChatRunEventProjection } from "../src/platform/chat/types";

function createMemoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear() {
			values.clear();
		},
		getItem(key) {
			return values.get(key) ?? null;
		},
		key(index) {
			return Array.from(values.keys())[index] ?? null;
		},
		removeItem(key) {
			values.delete(key);
		},
		setItem(key, value) {
			values.set(key, value);
		},
	};
}

function runEvent(overrides: Partial<ChatRunEventProjection> = {}): ChatRunEventProjection {
	return {
		eventId: "event-started",
		eventType: "run.started",
		occurredAt: "2026-06-04T01:02:05.000Z",
		payload: {},
		runId: "run_01HQ",
		sequence: 1,
		visibility: "browser",
		...overrides,
	};
}

describe("public chat pending durable run state", () => {
	it("advances the resume cursor and clears only after a terminal durable run event", () => {
		const store = createPendingRunStore(createMemoryStorage());
		store.save({
			conversationId: "conv_01HQ",
			lastSequence: 0,
			phase: "queued",
			requestId: "req_01HQ",
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});

		expect(recordPendingRunEvent(store, runEvent({ sequence: 1 }))).toEqual({
			terminal: false,
			state: {
				conversationId: "conv_01HQ",
				lastSequence: 1,
				phase: "running",
				requestId: "req_01HQ",
				runId: "run_01HQ",
				traceId: "trace_01HQ",
			},
		});
		expect(store.load()?.lastSequence).toBe(1);

		expect(
			recordPendingRunEvent(
				store,
				runEvent({
					eventId: "event-final",
					eventType: "finalization.completed",
					sequence: 2,
				}),
			),
		).toEqual({
			terminal: true,
			state: null,
		});
		expect(store.load()).toBeNull();
	});

	it("fails closed when a durable run event does not match the stored run cursor", () => {
		const store = createPendingRunStore(createMemoryStorage());
		store.save({
			conversationId: "conv_01HQ",
			lastSequence: 3,
			phase: "running",
			requestId: "req_01HQ",
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});

		expect(() =>
			recordPendingRunEvent(
				store,
				runEvent({
					runId: "run_other",
					sequence: 4,
				}),
			),
		).toThrow("Durable run event does not match the pending run.");
		expect(() =>
			recordPendingRunEvent(
				store,
				runEvent({
					sequence: 3,
				}),
			),
		).toThrow("Durable run event sequence must advance the pending cursor.");
	});

	it("fails closed when stored durable run state has no product phase", () => {
		const storage = createMemoryStorage();
		storage.setItem(
			"campus-agent.public-chat.pending-run.v1",
			JSON.stringify({
				conversationId: "conv_01HQ",
				lastSequence: 0,
				requestId: "req_01HQ",
				runId: "run_01HQ",
				traceId: "trace_01HQ",
			}),
		);

		expect(createPendingRunStore(storage).load()).toBeNull();
	});

	it("projects durable run events into the stored product phase", () => {
		const store = createPendingRunStore(createMemoryStorage());
		store.save({
			conversationId: "conv_01HQ",
			lastSequence: 0,
			phase: "queued",
			requestId: "req_01HQ",
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});

		expect(
			recordPendingRunEvent(
				store,
				runEvent({
					eventId: "event-started",
					eventType: "run.started",
					sequence: 1,
				}),
			).state?.phase,
		).toBe("running");
		expect(
			recordPendingRunEvent(
				store,
				runEvent({
					eventId: "event-failed",
					eventType: "run.failed",
					sequence: 2,
				}),
			),
		).toEqual({
			state: null,
			terminal: true,
		});
	});

	it("classifies durable terminal events explicitly", () => {
		expect(isTerminalRunEvent(runEvent({ eventType: "finalization.completed" }))).toBe(true);
		expect(isTerminalRunEvent(runEvent({ eventType: "run.failed" }))).toBe(true);
		expect(isTerminalRunEvent(runEvent({ eventType: "run.started" }))).toBe(false);
	});

	it("resumes a pending run from the stored cursor and loads conversation truth after terminal", async () => {
		const store = createPendingRunStore(createMemoryStorage());
		store.save({
			conversationId: "conv_01HQ",
			lastSequence: 2,
			phase: "running",
			requestId: "req_01HQ",
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
		const subscribed: Array<{ afterSequence: number; runId: string }> = [];
		const loadedConversations: string[] = [];

		const result = await resumePendingRun({
			loadConversation: async (conversationId) => {
				loadedConversations.push(conversationId);
				return {
					createdAt: "2026-06-04T01:02:03.000Z",
					id: conversationId,
					messages: [],
					title: "国家奖学金",
					updatedAt: "2026-06-04T01:02:06.000Z",
				};
			},
			store,
			subscribe: async function* (input) {
				subscribed.push({
					afterSequence: input.afterSequence,
					runId: input.runId,
				});
				yield runEvent({
					eventId: "event-final",
					eventType: "finalization.completed",
					sequence: 3,
				});
			},
		});

		expect(result).toEqual({
			conversation: {
				createdAt: "2026-06-04T01:02:03.000Z",
				id: "conv_01HQ",
				messages: [],
				title: "国家奖学金",
				updatedAt: "2026-06-04T01:02:06.000Z",
			},
			kind: "completed",
		});
		expect(subscribed).toEqual([{ afterSequence: 2, runId: "run_01HQ" }]);
		expect(loadedConversations).toEqual(["conv_01HQ"]);
		expect(store.load()).toBeNull();
	});

	it("fails closed when terminal resume loads a different conversation truth", async () => {
		const store = createPendingRunStore(createMemoryStorage());
		store.save({
			conversationId: "conv_01HQ",
			lastSequence: 2,
			phase: "running",
			requestId: "req_01HQ",
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});

		await expect(
			resumePendingRun({
				loadConversation: async () => ({
					createdAt: "2026-06-04T01:02:03.000Z",
					id: "conv_other",
					messages: [],
					title: "错误对话",
					updatedAt: "2026-06-04T01:02:06.000Z",
				}),
				store,
				subscribe: async function* () {
					yield runEvent({
						eventId: "event-final",
						eventType: "finalization.completed",
						sequence: 3,
					});
				},
			}),
		).rejects.toThrow("Durable run terminal conversation does not match the pending run.");
	});
});
