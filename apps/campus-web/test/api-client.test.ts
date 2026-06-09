import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteMessageFeedback, submitMessageFeedback } from "../src/features/conversation/api";
import { requestJson, UnauthorizedError } from "../src/platform/api/client";

describe("campus app-api client", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("maps 401 to UnauthorizedError", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "session required" } }), {
				headers: { "content-type": "application/json" },
				status: 401,
			}),
		);

		await expect(requestJson({ path: "/api/me" })).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it("rejects non-json successful responses", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", {
				headers: { "content-type": "text/plain" },
			}),
		);

		await expect(requestJson({ path: "/api/me" })).rejects.toThrow("non-JSON");
	});

	it("returns valid JSON payloads", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			}),
		);

		await expect(requestJson<{ ok: true }>({ path: "/api/me" })).resolves.toEqual({ ok: true });
	});

	it("submits and deletes answer feedback through the conversation contract", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						feedback: {
							feedbackId: "fb_01",
							messageId: "msg_01",
							reasonCodes: ["wrong_intent"],
							vote: "unhelpful",
						},
					}),
					{ headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await expect(
			submitMessageFeedback({
				conversationId: "conv_01",
				messageId: "msg_01",
				reasonCodes: ["wrong_intent"],
				vote: "unhelpful",
			}),
		).resolves.toMatchObject({
			feedback: { feedbackId: "fb_01", vote: "unhelpful" },
		});
		await expect(
			deleteMessageFeedback({ conversationId: "conv_01", messageId: "msg_01" }),
		).resolves.toBeUndefined();

		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"/api/chat/conversations/conv_01/messages/msg_01/feedback",
		);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
		expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
	});
});
