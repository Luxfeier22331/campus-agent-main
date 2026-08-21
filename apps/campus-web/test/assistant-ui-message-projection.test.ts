import { describe, expect, it } from "vitest";
import {
	provisionalAssistantMessage,
	removeMessagesById,
	upsertAssistantTextMessage,
} from "../src/features/conversation/assistant-ui-message-projection";
import { EMPTY_CAMPUS_RUN_VIEW } from "../src/features/conversation/run-view-state";

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

	it("removes only provisional message ids", () => {
		const messages = [
			{ content: [], id: "canonical", role: "assistant" as const },
			{ content: [], id: "provisional", role: "assistant" as const },
		];
		expect(removeMessagesById(messages, new Set(["provisional"]))).toEqual([messages[0]]);
	});

	it("migrates a provisional assistant message to the durable answer id", () => {
		const provisional = provisionalAssistantMessage({
			messageId: "local-assistant",
			occurredAt: "2026-06-18T01:00:00.000Z",
			runView: { ...EMPTY_CAMPUS_RUN_VIEW, operationId: 1, provisional: true },
		});
		const updated = upsertAssistantTextMessage([provisional], {
			messageId: "msg_answer",
			occurredAt: "2026-06-18T01:00:01.000Z",
			provisionalMessageId: "local-assistant",
			text: "回答正文",
		});

		expect(updated).toHaveLength(1);
		expect(updated[0]).toMatchObject({
			content: [{ text: "回答正文", type: "text" }],
			id: "msg_answer",
			role: "assistant",
		});
	});
});
