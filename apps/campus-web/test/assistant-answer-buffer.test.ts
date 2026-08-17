// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { AssistantAnswerBuffer } from "../src/features/conversation/assistant-answer-buffer";

describe("assistant answer buffer", () => {
	it("accumulates deltas and returns provisional ids when cleared", () => {
		const buffer = new AssistantAnswerBuffer();
		const reveal = vi.fn();
		buffer.append("message-1", "A", "2026-08-16T00:00:00.000Z");
		buffer.append("message-1", "B", "2026-08-16T00:00:01.000Z");

		buffer.revealAll(reveal);

		expect(reveal).toHaveBeenCalledWith({
			messageId: "message-1",
			occurredAt: "2026-08-16T00:00:01.000Z",
			text: "AB",
		});
		expect(buffer.clear()).toEqual(new Set(["message-1"]));
	});
});
