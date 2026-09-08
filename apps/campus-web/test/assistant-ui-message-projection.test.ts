import { describe, expect, it } from "vitest";
import {
	localUserMessage,
	removeMessagesById,
	upsertAssistantTextMessage,
} from "../src/features/conversation/assistant-ui-message-projection";

describe("assistant-ui message projection", () => {
	it("upserts streamed assistant text without duplicating the message", () => {
		const first = upsertAssistantTextMessage([], {
			messageId: "msg_answer",
			occurredAt: "2026-06-24T01:00:00.000Z",
			text: "第一段",
		});
		const updated = upsertAssistantTextMessage(first, {
			messageId: "msg_answer",
			occurredAt: "2026-06-24T01:00:01.000Z",
			text: "完整回答",
		});

		expect(updated).toHaveLength(1);
		expect(updated[0]).toMatchObject({
			content: [{ text: "完整回答", type: "text" }],
			id: "msg_answer",
			role: "assistant",
		});
		expect(updated[0]?.createdAt).toEqual(first[0]?.createdAt);
	});

	it("marks a streamed answer as optimistic until canonical messages replace it", () => {
		const updated = upsertAssistantTextMessage([], {
			messageId: "run:answer",
			occurredAt: "2026-06-24T01:00:00.000Z",
			text: "流式回答",
		});

		expect(updated[0]?.metadata).toMatchObject({ isOptimistic: true });
	});

	it("removes only provisional message ids", () => {
		const messages = [
			{ content: [], id: "canonical", role: "assistant" as const },
			{ content: [], id: "provisional", role: "assistant" as const },
		];
		expect(removeMessagesById(messages, new Set(["provisional"]))).toEqual([messages[0]]);
	});

	it("marks the local user message as optimistic until the server message replaces it", () => {
		expect(localUserMessage([{ text: "测试", type: "text" }], "local-user")).toMatchObject({
			id: "local-user",
			metadata: { isOptimistic: true },
			role: "user",
		});
	});

	it("creates the durable answer message on its first delta", () => {
		const updated = upsertAssistantTextMessage([], {
			messageId: "msg_answer",
			occurredAt: "2026-06-18T01:00:01.000Z",
			text: "回答正文",
		});

		expect(updated).toHaveLength(1);
		expect(updated[0]).toMatchObject({
			content: [{ text: "回答正文", type: "text" }],
			id: "msg_answer",
			metadata: { isOptimistic: true },
			role: "assistant",
		});
	});
});
