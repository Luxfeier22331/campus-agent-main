import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type ChatRequestStreamEvent,
	createDraftConversation,
	deleteAllConversations,
	deleteConversation,
	deleteMessageFeedback,
	deleteTrailingMessages,
	getConversationDetail,
	getSessionPrincipal,
	listConversations,
	setMessageFeedback,
	submitChatRequest,
	submitChatRequestStream,
	UnauthorizedError,
} from "../src/platform/chat/api";

describe("public chat app-api client", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("submits a first-turn request without conversationId and returns the canonical conversation", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					answer: {
						conversation: {
							createdAt: "2026-03-28T08:00:00.000Z",
							id: "conv_01HQ",
							messages: [],
							title: "图书馆开放时间",
							updatedAt: "2026-03-28T08:00:01.000Z",
						},
						result: {
							kind: "answer",
							requestId: "req_01HQ",
							text: "图书馆开放到 22:00。",
							traceId: "trace_01HQ",
						},
					},
				}),
				{
					headers: {
						"content-type": "application/json; charset=utf-8",
					},
					status: 200,
				},
			),
		);

		const result = await submitChatRequest({
			prompt: "图书馆开放到几点？",
		});

		expect(result.conversation.id).toBe("conv_01HQ");
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/chat/requests",
			expect.objectContaining({
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: expect.objectContaining({
					"content-type": "application/json",
					"idempotency-key": expect.any(String),
				}),
				method: "POST",
			}),
		);
	});

	it("rejects invalid JSON success payloads from app-api", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("{", {
				headers: {
					"content-type": "application/json; charset=utf-8",
				},
				status: 200,
			}),
		);

		await expect(getSessionPrincipal()).rejects.toThrow("App API returned invalid JSON.");
	});

	it("rejects non-JSON success payloads from app-api routes that require JSON", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", {
				headers: {
					"content-type": "text/plain",
				},
				status: 200,
			}),
		);

		await expect(getSessionPrincipal()).rejects.toThrow("App API returned a non-JSON response.");
	});

	it("submits a lifecycle stream request and yields product SSE events", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				[
					'event: request.accepted\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"accepted","occurredAt":"2026-03-28T08:00:00.000Z"}',
					'event: execution.running\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"running","occurredAt":"2026-03-28T08:00:01.000Z"}',
					'event: request.completed\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"completed","occurredAt":"2026-03-28T08:00:02.000Z","answer":{"conversation":{"createdAt":"2026-03-28T08:00:00.000Z","id":"conv_01HQ","messages":[],"title":"图书馆开放时间","updatedAt":"2026-03-28T08:00:02.000Z"},"result":{"kind":"answer","requestId":"req_stream_01HQ","text":"图书馆开放到 22:00。","traceId":"trace_stream_01HQ"}}}',
				].join("\n\n"),
				{
					headers: {
						"content-type": "text/event-stream; charset=utf-8",
					},
					status: 200,
				},
			),
		);

		const events: ChatRequestStreamEvent[] = [];
		for await (const event of submitChatRequestStream({
			conversationId: "conv_01HQ",
			prompt: "图书馆开放到几点？",
		})) {
			events.push(event);
		}

		expect(events.map((event) => event.event)).toEqual([
			"request.accepted",
			"execution.running",
			"request.completed",
		]);
		expect(events.at(-1)?.data.answer?.result).toMatchObject({
			kind: "answer",
			requestId: "req_stream_01HQ",
			text: "图书馆开放到 22:00。",
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/chat/requests/stream",
			expect.objectContaining({
				body: JSON.stringify({
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				}),
				headers: expect.objectContaining({
					accept: "text/event-stream",
					"content-type": "application/json",
					"idempotency-key": expect.any(String),
				}),
				method: "POST",
			}),
		);
	});

	it("rejects invalid JSON stream error payloads from app-api", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("{", {
				headers: {
					"content-type": "application/json; charset=utf-8",
				},
				status: 503,
				statusText: "Service Unavailable",
			}),
		);

		const iterator = submitChatRequestStream({
			prompt: "图书馆开放到几点？",
		})[Symbol.asyncIterator]();

		await expect(iterator.next()).rejects.toThrow("App API returned invalid JSON error payload.");
	});

	it("maps chat app-api routes and unauthorized responses consistently", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						principal: {
							displayName: "Jane Doe",
							email: "jane@example.edu",
							principalId: "user_01HQ",
							type: "campus_member",
						},
						permissions: {
							chat: true,
							operator: false,
						},
						session: {
							expiresAt: "2026-03-29T07:00:00.000Z",
							sessionId: "sess_01HQ",
						},
					}),
					{
						headers: {
							"content-type": "application/json; charset=utf-8",
						},
						status: 200,
					},
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						conversations: [
							{
								createdAt: "2026-03-28T08:00:00.000Z",
								id: "conv_01HQ",
								messages: [],
								title: "图书馆开放时间",
								updatedAt: "2026-03-28T08:01:00.000Z",
							},
						],
					}),
					{
						headers: {
							"content-type": "application/json; charset=utf-8",
						},
						status: 200,
					},
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						conversation: {
							createdAt: "2026-03-28T08:00:00.000Z",
							id: "conv_02HQ",
							messages: [],
							title: "New conversation",
							updatedAt: "2026-03-28T08:00:00.000Z",
						},
					}),
					{
						headers: {
							"content-type": "application/json; charset=utf-8",
						},
						status: 201,
					},
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						conversation: {
							createdAt: "2026-03-28T08:00:00.000Z",
							id: "conv_01HQ",
							messages: [],
							title: "图书馆开放时间",
							updatedAt: "2026-03-28T08:01:00.000Z",
						},
					}),
					{
						headers: {
							"content-type": "application/json; charset=utf-8",
						},
						status: 200,
					},
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						error: {
							code: "session_required",
							message: "Sign in required.",
						},
					}),
					{
						headers: {
							"content-type": "application/json; charset=utf-8",
						},
						status: 401,
					},
				),
			);

		await expect(getSessionPrincipal()).resolves.toMatchObject({
			principal: {
				principalId: "user_01HQ",
			},
		});
		await expect(listConversations()).resolves.toHaveLength(1);
		await expect(createDraftConversation()).resolves.toMatchObject({
			id: "conv_02HQ",
			title: "New conversation",
		});
		await expect(getConversationDetail("conv_01HQ")).resolves.toMatchObject({
			id: "conv_01HQ",
		});
		await expect(getConversationDetail("conv_missing")).rejects.toBeInstanceOf(UnauthorizedError);

		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			"/api/me",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/chat/conversations",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			3,
			"/api/chat/conversations",
			expect.objectContaining({
				method: "POST",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			4,
			"/api/chat/conversations/conv_01HQ",
			expect.objectContaining({
				method: "GET",
			}),
		);
	});

	it("deletes trailing messages from a conversation through the shared app-api route", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(null, {
				status: 204,
			}),
		);

		await expect(deleteTrailingMessages("conv_01HQ", "msg_01HQ")).resolves.toBeUndefined();

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/chat/conversations/conv_01HQ/messages/msg_01HQ/trailing",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
	});

	it("submits and deletes answer feedback through app-api feedback routes", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						feedback: {
							createdAt: "2026-04-29T08:00:00.000Z",
							feedbackId: "fb_01HQ",
							messageId: "msg_assistant_01HQ",
							reasonCodes: ["wrong_intent"],
							updatedAt: "2026-04-29T08:00:00.000Z",
							vote: "unhelpful",
						},
					}),
					{
						headers: {
							"content-type": "application/json; charset=utf-8",
						},
						status: 200,
					},
				),
			)
			.mockResolvedValueOnce(
				new Response(null, {
					status: 204,
				}),
			);

		await expect(
			setMessageFeedback({
				conversationId: "conv_01HQ",
				messageId: "msg_assistant_01HQ",
				reasonCodes: ["wrong_intent"],
				vote: "unhelpful",
			}),
		).resolves.toEqual({
			createdAt: "2026-04-29T08:00:00.000Z",
			feedbackId: "fb_01HQ",
			messageId: "msg_assistant_01HQ",
			reasonCodes: ["wrong_intent"],
			updatedAt: "2026-04-29T08:00:00.000Z",
			vote: "unhelpful",
		});
		await expect(
			deleteMessageFeedback({
				conversationId: "conv_01HQ",
				messageId: "msg_assistant_01HQ",
			}),
		).resolves.toBeUndefined();

		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			"/api/chat/conversations/conv_01HQ/messages/msg_assistant_01HQ/feedback",
			expect.objectContaining({
				body: JSON.stringify({
					reasonCodes: ["wrong_intent"],
					vote: "unhelpful",
				}),
				headers: expect.objectContaining({
					"content-type": "application/json",
				}),
				method: "PUT",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/chat/conversations/conv_01HQ/messages/msg_assistant_01HQ/feedback",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
	});

	it("deletes conversations through checked app-api calls", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ deleted: true }), {
					headers: {
						"content-type": "application/json; charset=utf-8",
					},
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ deletedCount: 3 }), {
					headers: {
						"content-type": "application/json; charset=utf-8",
					},
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						error: {
							code: "conversation_not_found",
							message: "Conversation not found.",
						},
					}),
					{
						headers: {
							"content-type": "application/json; charset=utf-8",
						},
						status: 404,
					},
				),
			);

		await expect(deleteConversation("conv_01HQ")).resolves.toBeUndefined();
		await expect(deleteAllConversations()).resolves.toEqual({ deletedCount: 3 });
		await expect(deleteConversation("conv_missing")).rejects.toThrow("Conversation not found.");

		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			"/api/chat?id=conv_01HQ",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/history",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			3,
			"/api/chat?id=conv_missing",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
	});
});
