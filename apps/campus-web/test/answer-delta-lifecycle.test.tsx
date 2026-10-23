import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { readProductSse } from "../src/features/conversation/chat-stream-protocol";
import { RunOperationMachine } from "../src/features/conversation/run-operation-machine";
import { useConversationLifecycleStream } from "../src/features/conversation/use-conversation-lifecycle-stream";

it("deduplicates ephemeral answers independently and still applies canonical completion", async () => {
	const machine = new RunOperationMachine();
	const operation = machine.start();
	machine.replaceActiveRun({ requestId: "r", sequence: 10 });
	const append = vi.fn();
	const terminal = vi.fn(async () => undefined);
	const { result } = renderHook(() =>
		useConversationLifecycleStream({
			appendAssistantDelta: append,
			applyRunStateEvent: vi.fn(),
			applyTerminalEvent: terminal,
			holdAssistantDelta: vi.fn(),
			noteRunProgress: vi.fn(),
			operationMachine: machine,
			ownsOperation: (op) => machine.ownedBy(op),
			requestRunCancellation: vi.fn(async () => undefined),
		}),
	);
	const base = {
		occurredAt: "2026-10-13T00:00:00Z",
		requestId: "r",
		status: "streaming",
		messageId: "m",
	};
	const frames = [
		["answer.delta", { ...base, answerIndex: 1, delta: "你" }],
		["answer.delta", { ...base, answerIndex: 1, delta: "你" }],
		["answer.delta", { ...base, answerIndex: 3, delta: "！" }],
		["request.completed", { ...base, status: "completed", sequence: 11 }],
	];
	const body = frames
		.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
		.join("");
	const events = readProductSse(
		new Response(body, { headers: { "content-type": "text/event-stream" } }),
		"empty",
	);
	await act(async () => {
		await result.current.consumeLifecycleStream(events, undefined, operation);
	});
	expect(append.mock.calls.map(([, text]) => text)).toEqual(["你", "！"]);
	expect(terminal).toHaveBeenCalledTimes(1);
	expect(machine.activeRun).toMatchObject({ sequence: 11, answerIndex: 3 });
});
