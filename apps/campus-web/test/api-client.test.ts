import { afterEach, describe, expect, it, vi } from "vitest";

import {
	archiveConversation,
	ChatStreamRequestError,
	cancelRun,
	deleteConversation,
	deleteMessageFeedback,
	deleteTrailingMessages,
	getRunEvents,
	getRunStatus,
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

	it("forwards an AbortSignal to fetch", async () => {
		const controller = new AbortController();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			}),
		);

		await requestJson({ path: "/api/me", signal: controller.signal });

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/me",
			expect.objectContaining({ signal: controller.signal }),
		);
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
			matchSnippet: null,
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
					'event: request.accepted\ndata: {"requestId":"req_01","sequence":1,"status":"accepted","occurredAt":"2026-06-08T00:00:00.000Z"}',
					'event: execution.queued\ndata: {"requestId":"req_01","status":"queued","occurredAt":"2026-06-08T00:00:00.250Z"}',
					'event: execution.running\ndata: {"requestId":"req_01","status":"running","occurredAt":"2026-06-08T00:00:00.500Z"}',
					'event: answer.delta\ndata: {"requestId":"req_01","sequence":2,"status":"streaming","occurredAt":"2026-06-08T00:00:01.000Z","messageId":"msg_answer","delta":"图书馆开放到"}',
					'event: request.completed\ndata: {"requestId":"req_01","sequence":3,"status":"completed","occurredAt":"2026-06-08T00:00:02.000Z"}',
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

		expect(events.map((event) => event.event)).toEqual([
			"request.accepted",
			"execution.queued",
			"execution.running",
			"answer.delta",
			"request.completed",
		]);
		expect(events[3]).toMatchObject({
			data: {
				delta: "图书馆开放到",
				messageId: "msg_answer",
			},
			event: "answer.delta",
		});
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

	it("does not cancel the lifecycle reader after a normal EOF", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			cancel,
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						'event: request.accepted\ndata: {"requestId":"req_eof","status":"accepted","occurredAt":"2026-06-08T00:00:00.000Z"}\n\n',
					),
				);
				controller.close();
			},
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(body, { headers: { "content-type": "text/event-stream" } }),
		);

		const events: ChatRequestStreamEvent[] = [];
		for await (const event of submitChatRequestStream({ prompt: "正常结束" })) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(cancel).not.toHaveBeenCalled();
	});

	it("cancels the lifecycle reader when parsing fails", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			cancel,
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode("event: request.accepted\ndata: {not-json}\n\n"),
				);
			},
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(body, { headers: { "content-type": "text/event-stream" } }),
		);

		await expect(async () => {
			for await (const _event of submitChatRequestStream({ prompt: "解析失败" })) {
				throw new Error("invalid stream must not yield events");
			}
		}).rejects.toMatchObject({ code: "invalid_stream_event" });
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("normalizes network failures while reading the lifecycle stream", async () => {
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(new TypeError("Failed to fetch"));
			},
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(body, { headers: { "content-type": "text/event-stream" } }),
		);
		await expect(
			submitChatRequestStream({ prompt: "断线" })[Symbol.asyncIterator]().next(),
		).rejects.toMatchObject({ code: "chat_stream_connection_lost", retryable: true });
	});

	it("cancels the lifecycle reader when the caller stops consuming early", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			cancel,
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						'event: request.accepted\ndata: {"requestId":"req_break","status":"accepted","occurredAt":"2026-06-08T00:00:00.000Z"}\n\n',
					),
				);
			},
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(body, { headers: { "content-type": "text/event-stream" } }),
		);

		for await (const _event of submitChatRequestStream({ prompt: "提前结束" })) {
			break;
		}

		expect(cancel).toHaveBeenCalledOnce();
	});

	it("maps failed chat stream startup responses to structured request errors", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					error: {
						code: "execution_failed",
						message: "请求失败。",
						requestId: "req_failed",
						retryable: true,
					},
				}),
				{
					headers: { "content-type": "application/json" },
					status: 500,
					statusText: "Internal Server Error",
				},
			),
		);

		const events = submitChatRequestStream({ prompt: "这次会失败吗？" });

		let error: unknown;
		try {
			for await (const _event of events) {
				throw new Error("stream should not yield events");
			}
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(ChatStreamRequestError);
		expect(error).toMatchObject({
			code: "execution_failed",
			message: "请求失败。",
			requestId: "req_failed",
			retryable: true,
		});
	});

	it("preserves the typed terminal conflict from run cancellation", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					error: {
						code: "request_already_terminal",
						message: "Request is already terminal.",
						retryable: false,
					},
				}),
				{
					headers: { "content-type": "application/json" },
					status: 409,
					statusText: "Conflict",
				},
			),
		);

		await expect(cancelRun("req_terminal")).rejects.toMatchObject({
			code: "request_already_terminal",
			message: "Request is already terminal.",
			retryable: false,
			status: 409,
		});
	});

	it("reads the durable run status through the owned run route", async () => {
		const controller = new AbortController();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					run: {
						acceptedAt: "2026-06-08T00:00:00.000Z",
						completedAt: "2026-06-08T00:00:05.000Z",
						conversationId: "conv_01",
						durationMs: 5_000,
						phase: "failed",
						requestId: "req_01",
						startedAt: "2026-06-08T00:00:01.000Z",
						status: "failed",
						terminalReason: "runtime_invariant_failed",
					},
				}),
				{ headers: { "content-type": "application/json" } },
			),
		);

		await expect(getRunStatus({ requestId: "req_01", signal: controller.signal })).resolves.toEqual(
			{
				acceptedAt: "2026-06-08T00:00:00.000Z",
				completedAt: "2026-06-08T00:00:05.000Z",
				conversationId: "conv_01",
				durationMs: 5_000,
				phase: "failed",
				requestId: "req_01",
				startedAt: "2026-06-08T00:00:01.000Z",
				status: "failed",
				terminalReason: "runtime_invariant_failed",
			},
		);
		expect(fetchMock).toHaveBeenCalledWith("/api/chat/requests/req_01", {
			credentials: "same-origin",
			headers: { accept: "application/json" },
			method: "GET",
			signal: expect.any(AbortSignal),
		});
	});

	it("bounds a stalled durable run status request", async () => {
		vi.useFakeTimers();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					const signal = init?.signal;
					if (!(signal instanceof AbortSignal)) {
						reject(new Error("run status request signal is missing"));
						return;
					}
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
		);

		try {
			const statusPromise = getRunStatus({ requestId: "req_stalled" });
			const expectation = expect(statusPromise).rejects.toMatchObject({
				code: "request_status_timeout",
				retryable: true,
			});
			await vi.advanceTimersByTimeAsync(5_000);
			await expectation;
			expect(fetchMock.mock.calls[0]?.[1]?.signal).toHaveProperty("aborted", true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("maps submit, resume, status, and cancel authentication expiry without retrying", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(new Response(null, { status: 401 }));

		await expect(async () => {
			for await (const _event of submitChatRequestStream({ prompt: "需要重新登录" })) {
				throw new Error("unauthorized submit must not yield events");
			}
		}).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(async () => {
			for await (const _event of resumeRunEventsStream({ requestId: "req_01" })) {
				throw new Error("unauthorized resume must not yield events");
			}
		}).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(getRunStatus({ requestId: "req_01" })).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(cancelRun("req_01")).rejects.toBeInstanceOf(UnauthorizedError);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("fails closed on malformed or unknown lifecycle events", async () => {
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response("event: request.accepted\ndata: {not-json}\n\n", {
					headers: { "content-type": "text/event-stream" },
				}),
			)
			.mockResolvedValueOnce(
				new Response("event: request.future-state\ndata: {}\n\n", {
					headers: { "content-type": "text/event-stream" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					'event: request.completed\ndata: {"status":"completed","occurredAt":"2026-06-08T00:00:02.000Z"}\n\n',
					{ headers: { "content-type": "text/event-stream" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					'event: request.failed\ndata: {"requestId":"req_01","status":"failed","occurredAt":"2026-06-08T00:00:02.000Z","error":{"code":"run_failed","message":"回答失败。"}}\n\n',
					{ headers: { "content-type": "text/event-stream" } },
				),
			);

		for (const prompt of ["损坏事件", "未知事件", "错形终态", "缺少重试语义"]) {
			await expect(async () => {
				for await (const _event of submitChatRequestStream({ prompt })) {
					throw new Error("invalid stream must not yield events");
				}
			}).rejects.toMatchObject({
				code: "invalid_stream_event",
				retryable: false,
			});
		}
	});

	it("discards an unterminated SSE tail so the stable run can be resumed", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				[
					'event: request.accepted\ndata: {"requestId":"req_01","status":"accepted","occurredAt":"2026-06-08T00:00:00.000Z"}',
					'event: request.completed\ndata: {"requestId":"req_01"',
				].join("\n\n"),
				{ headers: { "content-type": "text/event-stream" } },
			),
		);

		const events: ChatRequestStreamEvent[] = [];
		for await (const event of submitChatRequestStream({ prompt: "继续当前运行" })) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			data: { requestId: "req_01" },
			event: "request.accepted",
		});
	});

	it("rejects a chat stream startup response without the contracted error envelope", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response("upstream unavailable", {
				headers: { "content-type": "text/plain" },
				status: 503,
				statusText: "Service Unavailable",
			}),
		);

		const events = submitChatRequestStream({ prompt: "这次会失败吗？" });

		await expect(async () => {
			for await (const _event of events) {
				throw new Error("stream should not yield events");
			}
		}).rejects.toMatchObject({
			code: "invalid_error_response",
			message: "请求返回了无效错误结构。",
			retryable: false,
			status: 503,
		});
	});

	it("reads browser-visible run events and advances the durable cursor", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					events: [
						{
							eventType: "execution.phase",
							occurredAt: "2026-06-08T00:00:01.000Z",
							payload: { phase: "generating" },
							requestId: "req_01",
							sequence: 7,
						},
						{
							eventType: "answer.delta",
							occurredAt: "2026-06-08T00:00:02.000Z",
							payload: { delta: "校园资料", message_id: "msg_01" },
							requestId: "req_01",
							sequence: 8,
						},
					],
					nextSequence: 9,
					run: {
						acceptedAt: "2026-06-08T00:00:00.000Z",
						completedAt: null,
						conversationId: "conv_01",
						durationMs: null,
						phase: "streaming",
						requestId: "req_01",
						startedAt: "2026-06-08T00:00:01.000Z",
						status: "streaming",
					},
				}),
				{ headers: { "content-type": "application/json" } },
			),
		);

		await expect(getRunEvents({ afterSequence: 6, requestId: "req_01" })).resolves.toMatchObject({
			nextSequence: 9,
			run: { requestId: "req_01", status: "streaming" },
			events: [
				{ event: "execution.phase", data: { phase: "generating", sequence: 7 } },
				{
					event: "answer.delta",
					data: { delta: "校园资料", messageId: "msg_01", sequence: 8 },
				},
			],
		});
		expect(fetchMock).toHaveBeenCalledWith("/api/chat/requests/req_01/events?after_sequence=6", {
			credentials: "same-origin",
			headers: { accept: "application/json" },
			method: "GET",
		});
	});

	it("rejects a failed durable run event without product retryability", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					events: [
						{
							eventType: "request.failed",
							occurredAt: "2026-06-08T00:00:02.000Z",
							payload: {
								error: {
									code: "run_failed",
									message: "回答失败。",
								},
							},
							requestId: "req_01",
							sequence: 9,
						},
					],
					nextSequence: 9,
					run: {
						acceptedAt: "2026-06-08T00:00:00.000Z",
						completedAt: "2026-06-08T00:00:02.000Z",
						conversationId: "conv_01",
						durationMs: 2_000,
						phase: "failed",
						requestId: "req_01",
						startedAt: "2026-06-08T00:00:01.000Z",
						status: "failed",
						terminalReason: "execution_failed",
					},
				}),
				{ headers: { "content-type": "application/json" } },
			),
		);

		await expect(getRunEvents({ requestId: "req_01" })).rejects.toMatchObject({
			code: "invalid_request_status_response",
			retryable: false,
		});
	});

	it("calls run control and trailing delete routes explicitly", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						run: {
							acceptedAt: "2026-06-08T00:00:00.000Z",
							completedAt: null,
							conversationId: "conv_01",
							durationMs: null,
							phase: "running",
							requestId: "req_01",
							startedAt: "2026-06-08T00:00:01.000Z",
							status: "running",
						},
					}),
					{
						headers: { "content-type": "application/json" },
						status: 202,
					},
				),
			)
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(
				new Response(
					'event: execution.running\ndata: {"requestId":"req_01","status":"running","sequence":4,"occurredAt":"2026-06-08T00:00:00.000Z"}\n\n',
					{
						headers: { "content-type": "text/event-stream" },
					},
				),
			);

		await expect(cancelRun("req_01")).resolves.toMatchObject({
			requestId: "req_01",
			status: "running",
		});
		await expect(
			deleteTrailingMessages({ conversationId: "conv_01", messageId: "msg_01" }),
		).resolves.toBeUndefined();
		await expect(deleteConversation("conv_01")).resolves.toBeUndefined();
		const events: ChatRequestStreamEvent[] = [];
		for await (const event of resumeRunEventsStream({ afterSequence: 3, requestId: "req_01" })) {
			events.push(event);
		}
		expect(events).toHaveLength(1);

		expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
			["/api/chat/requests/req_01/cancel", "POST"],
			["/api/chat/conversations/conv_01/messages/msg_01/trailing", "DELETE"],
			["/api/chat/conversations/conv_01", "DELETE"],
			["/api/chat/requests/req_01/events/stream?after_sequence=3", "GET"],
		]);
	});
});
