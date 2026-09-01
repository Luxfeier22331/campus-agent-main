// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createChatSseResponse } from "../src/app/routes/chat-stream-responses";
import type { ChatCommandStreamEvent } from "../src/modules/runtime-command";

const firstEvent: ChatCommandStreamEvent = {
	data: {
		occurredAt: "2026-09-01T00:00:00.000Z",
		requestId: "req_stream_01HQ",
		status: "accepted",
	},
	event: "request.accepted",
};

describe("createChatSseResponse", () => {
	it("propagates an iterator failure instead of completing with normal EOF", async () => {
		const response = createChatSseResponse({
			first: firstEvent,
			iterator: {
				async next() {
					throw new Error("stream iterator failed");
				},
			},
		});

		await expect(response.text()).rejects.toThrow("stream iterator failed");
	});

	it("completes normally when the iterator reaches EOF", async () => {
		const response = createChatSseResponse({
			first: firstEvent,
			iterator: {
				async next() {
					return { done: true, value: undefined };
				},
			},
		});

		await expect(response.text()).resolves.toContain("event: request.accepted");
	});
});
