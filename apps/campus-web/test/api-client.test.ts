import { afterEach, describe, expect, it, vi } from "vitest";

import {
	archiveConversation,
	cancelRun,
	deleteConversation,
	deleteMessageFeedback,
	deleteTrailingMessages,
	listConversations,
	pinConversation,
	renameConversation,
	resumeRunEventsStream,
	searchConversations,
	submitChatRequestStream,
	submitMessageFeedback,
	unarchiveConversation,
	unpinConversation,
} from "../src/features/conversation/api";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";
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

	it("uses the conversation management contract for search and mutations", async () => {
		const summary = {
			archivedAt: null,
			createdAt: "2026-06-08T00:00:00.000Z",
			id: "conv_01",
			pinnedAt: "2026-06-08T00:01:00.000Z",
			title: "图书馆开放时间",
			updatedAt: "2026-06-08T00:02:00.000Z",
		};
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ conversations: [summary], query: "图书馆" }), {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockImplementation(() =>
				Promise.resolve(
					new Response(JSON.stringify({ conversation: summary }), {
						headers: { "content-type": "application/json" },
					}),
				),
			);

		await expect(searchConversations({ limit: 10, query: " 图书馆 " })).resolves.toEqual({
			conversations: [summary],
			query: "图书馆",
		});
		await expect(
			renameConversation({ conversationId: "conv_01", title: "新标题" }),
		).resolves.toEqual(summary);
		await expect(pinConversation("conv_01")).resolves.toEqual(summary);
		await expect(unpinConversation("conv_01")).resolves.toEqual(summary);
		await expect(archiveConversation("conv_01")).resolves.toEqual(summary);
		await expect(unarchiveConversation("conv_01")).resolves.toEqual(summary);

		expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
			["/api/chat/conversations/search?q=%E5%9B%BE%E4%B9%A6%E9%A6%86&view=active&limit=10", "GET"],
			["/api/chat/conversations/conv_01", "PATCH"],
			["/api/chat/conversations/conv_01/pin", "POST"],
			["/api/chat/conversations/conv_01/pin", "DELETE"],
			["/api/chat/conversations/conv_01/archive", "POST"],
			["/api/chat/conversations/conv_01/archive", "DELETE"],
		]);
	});

	it("lists archived conversations with an explicit query contract", async () => {
		const summary = {
			archivedAt: "2026-06-08T00:03:00.000Z",
			createdAt: "2026-06-08T00:00:00.000Z",
			id: "conv_archived",
			pinnedAt: null,
			title: "已归档的问题",
			updatedAt: "2026-06-08T00:02:00.000Z",
		};
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ conversations: [summary] }), {
				headers: { "content-type": "application/json" },
			}),
		);

		await expect(listConversations({ limit: 50, view: "archived" })).resolves.toEqual([summary]);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/chat/conversations?view=archived&limit=50");
	});

	it("submits chat prompts through the durable lifecycle SSE route", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				[
					'event: request.accepted\ndata: {"runId":"run_01","requestId":"req_01","traceId":"trace_01","sequence":1,"status":"accepted","occurredAt":"2026-06-08T00:00:00.000Z"}',
					'event: request.completed\ndata: {"runId":"run_01","requestId":"req_01","traceId":"trace_01","sequence":3,"status":"completed","occurredAt":"2026-06-08T00:00:02.000Z"}',
					"",
				].join("\n\n"),
				{
					headers: { "content-type": "text/event-stream" },
				},
			),
		);

		const events: ChatRequestStreamEvent[] = [];
		for await (const event of submitChatRequestStream({
			conversationId: "conv_01",
			prompt: " 图书馆几点关门？ ",
		})) {
			events.push(event);
		}

		expect(events.map((event) => event.event)).toEqual(["request.accepted", "request.completed"]);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/chat/requests/stream");
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			body: JSON.stringify({ conversationId: "conv_01", prompt: "图书馆几点关门？" }),
			credentials: "same-origin",
			method: "POST",
		});
		expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
			accept: "text/event-stream",
			"content-type": "application/json",
		});
		expect(fetchMock.mock.calls[0]?.[1]?.headers).toHaveProperty("idempotency-key");
	});

	it("calls run control and trailing delete routes explicitly", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ accepted: true }), {
					headers: { "content-type": "application/json" },
					status: 202,
				}),
			)
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(
				new Response(
					'event: execution.running\ndata: {"runId":"run_01","requestId":"req_01","traceId":"trace_01","status":"running","occurredAt":"2026-06-08T00:00:00.000Z"}\n\n',
					{
						headers: { "content-type": "text/event-stream" },
					},
				),
			);

		await expect(cancelRun("run_01")).resolves.toBeUndefined();
		await expect(
			deleteTrailingMessages({ conversationId: "conv_01", messageId: "msg_01" }),
		).resolves.toBeUndefined();
		await expect(deleteConversation("conv_01")).resolves.toBeUndefined();
		const events: ChatRequestStreamEvent[] = [];
		for await (const event of resumeRunEventsStream({ afterSequence: 3, runId: "run_01" })) {
			events.push(event);
		}
		expect(events).toHaveLength(1);

		expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
			["/api/chat/runs/run_01/cancel", "POST"],
			["/api/chat/conversations/conv_01/messages/msg_01/trailing", "DELETE"],
			["/api/chat/conversations/conv_01", "DELETE"],
			["/api/chat/runs/run_01/events/stream?after_sequence=3", "GET"],
		]);
	});
});
