import { describe, expect, it, vi } from "vitest";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";
import { consumeRunLifecycleEvents } from "../src/features/conversation/run-lifecycle-consumer";

async function* events(values: ChatRequestStreamEvent[]) {
	for (const value of values) {
		yield value;
	}
}

function event(
	name: ChatRequestStreamEvent["event"],
	data: Partial<ChatRequestStreamEvent["data"]> = {},
): ChatRequestStreamEvent {
	return {
		event: name,
		data: {
			occurredAt: "2026-08-16T00:00:00.000Z",
			requestId: "request-1",
			status: "running",
			traceId: "trace-1",
			...data,
		},
	};
}

describe("run lifecycle consumer", () => {
	it("routes accepted, delta and terminal events to their owners", async () => {
		const onAccepted = vi.fn();
		const onAnswerDelta = vi.fn();
		const onTerminal = vi.fn();
		const result = await consumeRunLifecycleEvents({
			events: events([
				event("request.accepted", { runId: "run-1" }),
				event("answer.delta", { delta: "A", messageId: "message-1", runId: "run-1" }),
				event("request.completed", { runId: "run-1" }),
			]),
			isCurrent: () => true,
			onAccepted,
			onAnswerDelta,
			onEvent: vi.fn(),
			onRunEvent: vi.fn(),
			onTerminal,
		});

		expect(result).toEqual({ eventCount: 3, terminal: true });
		expect(onAccepted).toHaveBeenCalledOnce();
		expect(onAnswerDelta).toHaveBeenCalledOnce();
		expect(onTerminal).toHaveBeenCalledOnce();
	});

	it("stops before applying events owned by a stale operation", async () => {
		const onEvent = vi.fn();
		await expect(
			consumeRunLifecycleEvents({
				events: events([event("request.accepted", { runId: "run-1" })]),
				isCurrent: () => false,
				onAccepted: vi.fn(),
				onAnswerDelta: vi.fn(),
				onEvent,
				onRunEvent: vi.fn(),
				onTerminal: vi.fn(),
			}),
		).resolves.toEqual({ eventCount: 0, terminal: true });
		expect(onEvent).not.toHaveBeenCalled();
	});
});
