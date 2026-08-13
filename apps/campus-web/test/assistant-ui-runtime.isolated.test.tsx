import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatStreamRequestError } from "../src/features/conversation/api";
import { createCampusAssistantRuntimeHook } from "../src/features/conversation/assistant-ui-runtime";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";
import { UnauthorizedError } from "../src/platform/api/client";

const assistantUiMock = vi.hoisted(() => ({
	externalStoreInput: null as null | {
		isRunning: boolean;
		messages: unknown[];
		onCancel: () => Promise<void>;
		onEdit?: (message: {
			content: { text: string; type: "text" }[];
			parentId?: string;
		}) => Promise<void>;
		onNew: (message: { content: { text: string; type: "text" }[] }) => Promise<void>;
		onReload?: (parentId: string | null) => Promise<void>;
		onResume?: () => Promise<void>;
	},
	deleteThread: vi.fn(),
	initialize: vi.fn(),
	remoteId: undefined as string | undefined,
	threadId: "__LOCALID_new",
}));

const conversationApiMock = vi.hoisted(() => ({
	cancelRun: vi.fn(),
	ChatStreamRequestError: class ChatStreamRequestError extends Error {
		code: string;
		requestId: string | undefined;
		retryable: boolean;
		traceId: string | undefined;

		constructor(input: {
			code: string;
			message: string;
			requestId?: string;
			retryable: boolean;
			traceId?: string;
		}) {
			super(input.message);
			this.name = "ChatStreamRequestError";
			this.code = input.code;
			this.requestId = input.requestId;
			this.retryable = input.retryable;
			this.traceId = input.traceId;
		}
	},
	deleteTrailingMessages: vi.fn(),
	getConversationDetail: vi.fn(),
	getRunStatus: vi.fn(),
	resumeRunEventsStream: vi.fn(),
	submitChatRequestStream: vi.fn(),
}));

vi.mock("@assistant-ui/react", () => ({
	useAui: () => ({
		threadListItem: {
			initialize: assistantUiMock.initialize,
		},
		threads: {
			item: ({ id }: { id: string }) => ({
				delete: () => assistantUiMock.deleteThread(id),
				initialize: assistantUiMock.initialize,
			}),
		},
	}),
	useAuiState: (
		selector: (state: { threadListItem: { id: string; remoteId?: string | undefined } }) => unknown,
	) =>
		selector({
			threadListItem: { id: assistantUiMock.threadId, remoteId: assistantUiMock.remoteId },
		}),
	useExternalStoreRuntime: (input: typeof assistantUiMock.externalStoreInput) => {
		assistantUiMock.externalStoreInput = input;
		return input;
	},
}));

vi.mock("../src/features/conversation/api", () => conversationApiMock);

function RuntimeProbe({
	hasSession = true,
	onLoginRequired,
}: {
	hasSession?: boolean;
	onLoginRequired: () => void;
}) {
	const useRuntime = createCampusAssistantRuntimeHook({
		loginRequired: !hasSession,
		onLoginRequired,
	});
	useRuntime();
	return null;
}

async function* streamEvents(events: ChatRequestStreamEvent[]) {
	for (const event of events) {
		yield event;
		await Promise.resolve();
	}
}

function cancellationTerminalEvent(): ChatRequestStreamEvent {
	return {
		data: {
			answer: {
				conversation: {
					archivedAt: null,
					createdAt: "2026-06-24T01:00:00.000Z",
					id: "conv_created",
					messages: [],
					pinnedAt: null,
					title: "",
					updatedAt: "2026-06-24T01:00:02.000Z",
				},
				result: {
					errorCode: "execution_cancelled",
					kind: "error",
					message: "The request was cancelled.",
					requestId: "req_01",
					retryable: false,
					traceId: "trace_01",
				},
			},
			occurredAt: "2026-06-24T01:00:02.000Z",
			requestId: "req_01",
			runId: "run_01",
			sequence: 2,
			status: "cancelled",
			traceId: "trace_01",
		},
		event: "request.cancelled",
	};
}

function completedTerminalEvent(answerText: string): ChatRequestStreamEvent {
	return {
		data: {
			answer: {
				conversation: {
					archivedAt: null,
					createdAt: "2026-06-24T01:00:00.000Z",
					id: "conv_created",
					messages: [
						{
							conversationId: "conv_created",
							createdAt: "2026-06-24T01:00:00.000Z",
							id: "msg_user",
							kind: null,
							requestId: "req_01",
							retryable: null,
							role: "user",
							structuredParts: [],
							text: "hi 你是谁",
						},
						{
							conversationId: "conv_created",
							createdAt: "2026-06-24T01:00:02.000Z",
							id: "msg_answer",
							kind: "answer",
							requestId: "req_01",
							retryable: null,
							role: "assistant",
							structuredParts: [],
							text: answerText,
						},
					],
					pinnedAt: null,
					title: "hi 你是谁",
					updatedAt: "2026-06-24T01:00:02.000Z",
				},
				result: {
					kind: "answer",
					requestId: "req_01",
					text: answerText,
					traceId: "trace_01",
				},
			},
			occurredAt: "2026-06-24T01:00:02.000Z",
			requestId: "req_01",
			runId: "run_01",
			sequence: 3,
			status: "completed",
			traceId: "trace_01",
		},
		event: "request.completed",
	};
}

function readAssistantText(): string {
	const message = assistantUiMock.externalStoreInput?.messages.find(
		(item): item is { content: { text: string; type: "text" }[]; role: "assistant" } =>
			typeof item === "object" &&
			item !== null &&
			"role" in item &&
			item.role === "assistant" &&
			"content" in item &&
			Array.isArray(item.content),
	);
	return message?.content.find((part) => part.type === "text")?.text ?? "";
}

function hasMessageId(messageId: string): boolean {
	return Boolean(
		assistantUiMock.externalStoreInput?.messages.some(
			(message) =>
				typeof message === "object" &&
				message !== null &&
				"id" in message &&
				message.id === messageId,
		),
	);
}

function readMessageText(messageId: string): string {
	const message = assistantUiMock.externalStoreInput?.messages.find(
		(item): item is { content: { text: string; type: "text" }[]; id: string } =>
			typeof item === "object" &&
			item !== null &&
			"id" in item &&
			item.id === messageId &&
			"content" in item &&
			Array.isArray(item.content),
	);
	return message?.content.find((part) => part.type === "text")?.text ?? "";
}

describe("assistant-ui runtime lifecycle bridge", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		assistantUiMock.externalStoreInput = null;
		assistantUiMock.remoteId = undefined;
		assistantUiMock.threadId = "__LOCALID_new";
		assistantUiMock.deleteThread.mockReset();
		assistantUiMock.deleteThread.mockResolvedValue(undefined);
		assistantUiMock.initialize.mockReset();
		assistantUiMock.initialize.mockResolvedValue({ remoteId: "conv_created" });
		conversationApiMock.cancelRun.mockReset();
		conversationApiMock.deleteTrailingMessages.mockReset();
		conversationApiMock.getConversationDetail.mockReset();
		conversationApiMock.getRunStatus.mockReset();
		conversationApiMock.getRunStatus.mockResolvedValue({
			conversationId: "conv_created",
			phase: "running",
			requestId: "req_01",
			runId: "run_01",
			status: "running",
			traceId: "trace_01",
		});
		conversationApiMock.resumeRunEventsStream.mockReset();
		conversationApiMock.submitChatRequestStream.mockReset();
	});

	it("submits new assistant-ui messages through the durable lifecycle SSE contract", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_01",
						runId: "run_01",
						sequence: 1,
						status: "accepted",
						traceId: "trace_01",
					},
					event: "request.accepted",
				},
				{
					data: {
						answer: {
							conversation: {
								archivedAt: null,
								createdAt: "2026-06-24T01:00:00.000Z",
								id: "conv_created",
								messages: [
									{
										conversationId: "conv_created",
										createdAt: "2026-06-24T01:00:01.000Z",
										id: "msg_user",
										kind: null,
										requestId: "req_01",
										retryable: null,
										role: "user",
										structuredParts: [],
										text: "奖学金怎么申请？",
									},
									{
										conversationId: "conv_created",
										createdAt: "2026-06-24T01:00:02.000Z",
										id: "msg_answer",
										kind: "answer",
										requestId: "req_01",
										retryable: null,
										role: "assistant",
										structuredParts: [],
										text: "按学校奖学金通知提交材料。",
									},
								],
								pinnedAt: null,
								title: "奖学金申请",
								updatedAt: "2026-06-24T01:00:02.000Z",
							},
							result: {
								kind: "answer",
								requestId: "req_01",
								text: "按学校奖学金通知提交材料。",
								traceId: "trace_01",
							},
						},
						occurredAt: "2026-06-24T01:00:02.000Z",
						requestId: "req_01",
						runId: "run_01",
						sequence: 3,
						status: "completed",
						traceId: "trace_01",
					},
					event: "request.completed",
				},
			]),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: " 奖学金怎么申请？ ", type: "text" }],
			});
		});

		expect(assistantUiMock.initialize).toHaveBeenCalledOnce();
		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledWith({
			conversationId: "conv_created",
			idempotencyKey: expect.any(String),
			prompt: "奖学金怎么申请？",
			signal: expect.any(AbortSignal),
		});
		expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(assistantUiMock.externalStoreInput?.messages).toEqual([
				expect.objectContaining({ id: "msg_user", role: "user" }),
				expect.objectContaining({ id: "msg_answer", role: "assistant" }),
			]);
		});
	});

	it("replays a submit that closes before acceptance with the same idempotency key", async () => {
		vi.useFakeTimers();
		conversationApiMock.submitChatRequestStream
			.mockImplementationOnce(() => streamEvents([]))
			.mockImplementationOnce(() =>
				streamEvents([
					{
						data: {
							occurredAt: "2026-06-24T01:00:00.000Z",
							requestId: "req_replay",
							runId: "run_replay",
							sequence: 1,
							status: "accepted",
							traceId: "trace_replay",
						},
						event: "request.accepted",
					},
					{
						data: {
							error: {
								code: "execution_failed",
								message: "重放后取得同一运行。",
								retryable: false,
							},
							occurredAt: "2026-06-24T01:00:01.000Z",
							requestId: "req_replay",
							runId: "run_replay",
							sequence: 2,
							status: "failed",
							traceId: "trace_replay",
						},
						event: "request.failed",
					},
				]),
			);

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "恢复提交", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			await act(async () => {
				await vi.advanceTimersByTimeAsync(250);
				await submitPromise;
			});

			expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledTimes(2);
			const firstInput = conversationApiMock.submitChatRequestStream.mock.calls[0]?.[0];
			const replayInput = conversationApiMock.submitChatRequestStream.mock.calls[1]?.[0];
			expect(firstInput?.idempotencyKey).toEqual(expect.any(String));
			expect(replayInput?.idempotencyKey).toBe(firstInput?.idempotencyKey);
			expect(readAssistantText()).toBe("重放后取得同一运行。");
		} finally {
			vi.useRealTimers();
		}
	});

	it("automatically resumes the accepted run when the submit stream ends before terminal", async () => {
		vi.useFakeTimers();
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_resume",
						runId: "run_resume",
						sequence: 7,
						status: "accepted",
						traceId: "trace_resume",
					},
					event: "request.accepted",
				},
			]),
		);
		conversationApiMock.resumeRunEventsStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						error: {
							code: "execution_failed",
							message: "恢复后的终态。",
							retryable: false,
						},
						occurredAt: "2026-06-24T01:00:01.000Z",
						requestId: "req_resume",
						runId: "run_resume",
						sequence: 9,
						status: "failed",
						traceId: "trace_resume",
					},
					event: "request.failed",
				},
			]),
		);

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "继续回答", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);
			expect(conversationApiMock.resumeRunEventsStream).not.toHaveBeenCalled();

			await act(async () => {
				await vi.advanceTimersByTimeAsync(250);
				await submitPromise;
			});

			expect(conversationApiMock.resumeRunEventsStream).toHaveBeenCalledWith({
				afterSequence: 7,
				runId: "run_resume",
				signal: expect.any(AbortSignal),
			});
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(readAssistantText()).toBe("恢复后的终态。");
		} finally {
			vi.useRealTimers();
		}
	});

	it("refreshes canonical messages when durable status is terminal beyond the stream cursor", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_status_terminal",
						runId: "run_status_terminal",
						sequence: 4,
						status: "accepted",
						traceId: "trace_status_terminal",
					},
					event: "request.accepted",
				},
				{
					data: {
						delta: "临时草稿",
						messageId: "msg_status_draft",
						occurredAt: "2026-06-24T01:00:01.000Z",
						requestId: "req_status_terminal",
						runId: "run_status_terminal",
						sequence: 5,
						status: "streaming",
						traceId: "trace_status_terminal",
					},
					event: "answer.delta",
				},
			]),
		);
		conversationApiMock.getRunStatus.mockResolvedValue({
			conversationId: "conv_created",
			phase: "completed",
			requestId: "req_status_terminal",
			runId: "run_status_terminal",
			status: "completed",
			terminalReason: "answer_completed",
			traceId: "trace_status_terminal",
		});
		const terminal = completedTerminalEvent("规范回答");
		conversationApiMock.getConversationDetail.mockResolvedValue(terminal.data.answer?.conversation);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "查询耐久终态", type: "text" }],
			});
		});

		expect(conversationApiMock.getRunStatus).toHaveBeenCalledWith({
			runId: "run_status_terminal",
			signal: expect.any(AbortSignal),
		});
		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith(
			"conv_created",
			expect.any(AbortSignal),
		);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(hasMessageId("msg_status_draft")).toBe(false);
		expect(readAssistantText()).toBe("规范回答");
	});

	it("stops a submit after three replays with the same idempotency key", async () => {
		vi.useFakeTimers();
		conversationApiMock.submitChatRequestStream.mockImplementation(() => streamEvents([]));

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "限制初始重放", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			await act(async () => {
				await vi.runAllTimersAsync();
				await submitPromise;
			});

			expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledTimes(4);
			const idempotencyKeys = conversationApiMock.submitChatRequestStream.mock.calls.map(
				([input]) => input.idempotencyKey,
			);
			expect(new Set(idempotencyKeys).size).toBe(1);
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(readAssistantText()).toBe("回答连接已中断，请重试。");
		} finally {
			vi.useRealTimers();
		}
	});

	it("ends loading after three recovery rounds make no stream or durable-status progress", async () => {
		vi.useFakeTimers();
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_recovery_lost",
						runId: "run_recovery_lost",
						sequence: 1,
						status: "accepted",
						traceId: "trace_recovery_lost",
					},
					event: "request.accepted",
				},
			]),
		);
		conversationApiMock.resumeRunEventsStream.mockImplementation(() => streamEvents([]));
		conversationApiMock.getRunStatus.mockRejectedValue(
			new ChatStreamRequestError({
				code: "dependency_not_ready",
				message: "状态暂不可用。",
				retryable: true,
			}),
		);

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "恢复失败上限", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			await act(async () => {
				await vi.runAllTimersAsync();
				await submitPromise;
			});

			expect(conversationApiMock.getRunStatus).toHaveBeenCalledTimes(4);
			expect(conversationApiMock.resumeRunEventsStream).toHaveBeenCalledTimes(3);
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(readAssistantText()).toBe("回答连接已中断，请重试。");
		} finally {
			vi.useRealTimers();
		}
	});

	it("resets recovery failures after a successful durable status check", async () => {
		vi.useFakeTimers();
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_recovery_reset",
						runId: "run_recovery_reset",
						sequence: 1,
						status: "accepted",
						traceId: "trace_recovery_reset",
					},
					event: "request.accepted",
				},
			]),
		);
		conversationApiMock.resumeRunEventsStream.mockImplementation(() => streamEvents([]));
		const retryableStatusError = new ChatStreamRequestError({
			code: "dependency_not_ready",
			message: "状态暂不可用。",
			retryable: true,
		});
		conversationApiMock.getRunStatus
			.mockRejectedValueOnce(retryableStatusError)
			.mockRejectedValueOnce(retryableStatusError)
			.mockResolvedValueOnce({
				conversationId: "conv_created",
				phase: "running",
				requestId: "req_recovery_reset",
				runId: "run_recovery_reset",
				status: "running",
				traceId: "trace_recovery_reset",
			})
			.mockRejectedValue(retryableStatusError);

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "恢复计数重置", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			await act(async () => {
				await vi.runAllTimersAsync();
				await submitPromise;
			});

			expect(conversationApiMock.getRunStatus).toHaveBeenCalledTimes(6);
			expect(conversationApiMock.resumeRunEventsStream).toHaveBeenCalledTimes(5);
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(readAssistantText()).toBe("回答连接已中断，请重试。");
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not record a new browser TTFT when resuming an existing run", async () => {
		vi.useFakeTimers();
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_manual_resume",
						runId: "run_manual_resume",
						sequence: 4,
						status: "accepted",
						traceId: "trace_manual_resume",
					},
					event: "request.accepted",
				},
			]),
		);
		conversationApiMock.resumeRunEventsStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						delta: "恢复中的回答",
						messageId: "msg_manual_resume",
						occurredAt: "2026-06-24T01:00:01.000Z",
						requestId: "req_manual_resume",
						runId: "run_manual_resume",
						sequence: 5,
						status: "streaming",
						traceId: "trace_manual_resume",
					},
					event: "answer.delta",
				},
				{
					data: {
						error: {
							code: "execution_failed",
							message: "恢复订阅结束。",
							retryable: false,
						},
						occurredAt: "2026-06-24T01:00:02.000Z",
						requestId: "req_manual_resume",
						runId: "run_manual_resume",
						sequence: 6,
						status: "failed",
						traceId: "trace_manual_resume",
					},
					event: "request.failed",
				},
			]),
		);

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "继续已有运行", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			await act(async () => {
				await assistantUiMock.externalStoreInput?.onResume?.();
				await submitPromise;
			});

			expect(conversationApiMock.resumeRunEventsStream).toHaveBeenCalledWith({
				afterSequence: 4,
				runId: "run_manual_resume",
				signal: expect.any(AbortSignal),
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders a structured manual resume failure without rejecting assistant-ui", async () => {
		vi.useFakeTimers();
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_manual_resume_failed",
						runId: "run_manual_resume_failed",
						sequence: 4,
						status: "accepted",
						traceId: "trace_manual_resume_failed",
					},
					event: "request.accepted",
				},
			]),
		);
		conversationApiMock.resumeRunEventsStream.mockImplementation(async function* () {
			yield* [] as ChatRequestStreamEvent[];
			throw new ChatStreamRequestError({
				code: "execution_failed",
				message: "手动恢复失败。",
				requestId: "req_manual_resume_failed",
				retryable: false,
				traceId: "trace_manual_resume_failed",
			});
		});

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "手动恢复", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			await act(async () => {
				await expect(assistantUiMock.externalStoreInput?.onResume?.()).resolves.toBeUndefined();
				await submitPromise;
			});

			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(readAssistantText()).toBe("手动恢复失败。");
		} finally {
			vi.useRealTimers();
		}
	});

	it("opens login without initializing a conversation when a prompt is submitted anonymously", async () => {
		const onLoginRequired = vi.fn();
		render(<RuntimeProbe hasSession={false} onLoginRequired={onLoginRequired} />);

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "国家奖学金怎么评审？", type: "text" }],
			});
		});

		expect(onLoginRequired).toHaveBeenCalledOnce();
		expect(assistantUiMock.initialize).not.toHaveBeenCalled();
		expect(conversationApiMock.submitChatRequestStream).not.toHaveBeenCalled();
		expect(assistantUiMock.externalStoreInput?.messages).toEqual([]);
	});

	it("shows the local prompt and running state while a new conversation initializes", async () => {
		let resolveInitialize: (value: { remoteId: string }) => void = () => {
			throw new Error("initialize resolver was not initialized");
		};
		assistantUiMock.initialize.mockImplementation(
			() =>
				new Promise<{ remoteId: string }>((resolve) => {
					resolveInitialize = resolve;
				}),
		);
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						error: { code: "execution_failed", message: "初始化后提交。", retryable: false },
						occurredAt: "2026-06-24T01:00:01.000Z",
						requestId: "req_initialized",
						runId: "run_initialized",
						sequence: 1,
						status: "failed",
						traceId: "trace_initialized",
					},
					event: "request.failed",
				},
			]),
		);
		render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		let submitPromise: Promise<void> | undefined;

		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "初始化中的消息", type: "text" }],
			});
			await Promise.resolve();
		});

		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);
		expect(assistantUiMock.externalStoreInput?.messages).toEqual([
			expect.objectContaining({ role: "user" }),
		]);
		expect(conversationApiMock.submitChatRequestStream).not.toHaveBeenCalled();

		await act(async () => {
			resolveInitialize({ remoteId: "conv_initialized" });
			await submitPromise;
		});
		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledWith(
			expect.objectContaining({ conversationId: "conv_initialized" }),
		);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
	});

	it("keeps the active operation when assistant-ui publishes remoteId before initialize resolves", async () => {
		let resolveInitialize: (value: { remoteId: string }) => void = () => {
			throw new Error("initialize resolver was not initialized");
		};
		assistantUiMock.initialize.mockImplementation(
			() =>
				new Promise<{ remoteId: string }>((resolve) => {
					resolveInitialize = resolve;
				}),
		);
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						error: { code: "execution_failed", message: "提交完成。", retryable: false },
						occurredAt: "2026-06-24T01:00:01.000Z",
						requestId: "req_remote_id_race",
						runId: "run_remote_id_race",
						sequence: 1,
						status: "failed",
						traceId: "trace_remote_id_race",
					},
					event: "request.failed",
				},
			]),
		);
		const { rerender } = render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		let submitPromise: Promise<void> | undefined;

		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "远端 ID 竞态", type: "text" }],
			});
			await Promise.resolve();
		});

		assistantUiMock.remoteId = "conv_remote_id_race";
		await act(async () => {
			rerender(<RuntimeProbe onLoginRequired={vi.fn()} />);
			await Promise.resolve();
		});

		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);
		expect(assistantUiMock.externalStoreInput?.messages).toEqual([
			expect.objectContaining({ role: "user" }),
		]);
		expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();

		await act(async () => {
			resolveInitialize({ remoteId: "conv_remote_id_race" });
			await submitPromise;
		});

		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledWith(
			expect.objectContaining({ conversationId: "conv_remote_id_race" }),
		);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
	});

	it("treats a different thread item as a real switch during initialization", async () => {
		assistantUiMock.initialize.mockImplementation(() => new Promise(() => undefined));
		conversationApiMock.getConversationDetail.mockResolvedValue({
			archivedAt: null,
			createdAt: "2026-06-24T01:00:00.000Z",
			id: "conv_other",
			messages: [],
			pinnedAt: null,
			title: "其他对话",
			updatedAt: "2026-06-24T01:00:00.000Z",
		});
		const { rerender } = render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		await act(async () => {
			void assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "初始化后切换", type: "text" }],
			});
			await Promise.resolve();
		});

		assistantUiMock.threadId = "conv_other";
		assistantUiMock.remoteId = "conv_other";
		await act(async () => {
			rerender(<RuntimeProbe onLoginRequired={vi.fn()} />);
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(assistantUiMock.externalStoreInput?.messages).toEqual([]);
		});
		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith(
			"conv_other",
			expect.any(AbortSignal),
		);
		expect(conversationApiMock.submitChatRequestStream).not.toHaveBeenCalled();
	});

	it("deletes a draft that finishes initialization after Stop", async () => {
		let resolveInitialize: (value: { remoteId: string }) => void = () => {
			throw new Error("initialize resolver was not initialized");
		};
		assistantUiMock.initialize.mockImplementation(
			() =>
				new Promise<{ remoteId: string }>((resolve) => {
					resolveInitialize = resolve;
				}),
		);
		const { rerender } = render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		let submitPromise: Promise<void> | undefined;

		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "不要提交", type: "text" }],
			});
			await Promise.resolve();
		});
		await act(async () => {
			await assistantUiMock.externalStoreInput?.onCancel();
		});

		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(assistantUiMock.externalStoreInput?.messages).toEqual([]);
		expect(conversationApiMock.submitChatRequestStream).not.toHaveBeenCalled();

		await act(async () => {
			assistantUiMock.remoteId = "conv_cancelled_initialization";
			rerender(<RuntimeProbe onLoginRequired={vi.fn()} />);
			await Promise.resolve();
		});
		expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();

		await act(async () => {
			resolveInitialize({ remoteId: "conv_cancelled_initialization" });
			await submitPromise;
		});
		expect(conversationApiMock.submitChatRequestStream).not.toHaveBeenCalled();
		expect(assistantUiMock.deleteThread).toHaveBeenCalledOnce();
		expect(assistantUiMock.deleteThread).toHaveBeenCalledWith("__LOCALID_new");
		expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
	});

	it("lets a new prompt take ownership of a pending initialization after Stop", async () => {
		let resolveInitialize: (value: { remoteId: string }) => void = () => {
			throw new Error("initialize resolver was not initialized");
		};
		assistantUiMock.initialize.mockImplementation(
			() =>
				new Promise<{ remoteId: string }>((resolve) => {
					resolveInitialize = resolve;
				}),
		);
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_reused_initialization",
					runId: "run_reused_initialization",
					sequence: 1,
					status: "accepted",
					traceId: "trace_reused_initialization",
				},
				event: "request.accepted",
			};
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield {
				data: {
					error: { code: "execution_failed", message: "提交完成。", retryable: false },
					occurredAt: "2026-06-24T01:00:02.000Z",
					requestId: "req_reused_initialization",
					runId: "run_reused_initialization",
					sequence: 2,
					status: "failed",
					traceId: "trace_reused_initialization",
				},
				event: "request.failed",
			};
		});
		const { rerender } = render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		let firstSubmit: Promise<void> | undefined;
		let secondSubmit: Promise<void> | undefined;

		await act(async () => {
			firstSubmit = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "停止的消息", type: "text" }],
			});
			await Promise.resolve();
		});
		await act(async () => {
			await assistantUiMock.externalStoreInput?.onCancel();
			secondSubmit = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "继续提交", type: "text" }],
			});
			await Promise.resolve();
		});
		expect(assistantUiMock.initialize).toHaveBeenCalledOnce();

		await act(async () => {
			assistantUiMock.remoteId = "conv_reused_initialization";
			rerender(<RuntimeProbe onLoginRequired={vi.fn()} />);
			resolveInitialize({ remoteId: "conv_reused_initialization" });
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(assistantUiMock.deleteThread).not.toHaveBeenCalled();
		expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();
		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledOnce();
		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_reused_initialization",
				prompt: "继续提交",
			}),
		);

		releaseTerminal();
		await act(async () => {
			await firstSubmit;
			await secondSubmit;
		});
	});

	it("renders conversation initialization failure through the local error message", async () => {
		assistantUiMock.initialize.mockRejectedValue(new Error("创建会话失败。"));
		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "创建失败的消息", type: "text" }],
			});
		});

		expect(conversationApiMock.submitChatRequestStream).not.toHaveBeenCalled();
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(assistantUiMock.externalStoreInput?.messages).toEqual([
			expect.objectContaining({ role: "user" }),
			expect.objectContaining({
				content: [{ text: "创建会话失败。", type: "text" }],
				role: "assistant",
			}),
		]);
	});

	it("reveals the complete answer delta backlog on the next animation frame", async () => {
		vi.useFakeTimers();
		const finalAnswer = "按学校奖学金通知提交材料。";
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			yield {
				data: {
					delta: finalAnswer,
					messageId: "msg_answer",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 2,
					status: "streaming",
					traceId: "trace_01",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield {
				data: {
					answer: {
						conversation: {
							archivedAt: null,
							createdAt: "2026-06-24T01:00:00.000Z",
							id: "conv_created",
							messages: [
								{
									conversationId: "conv_created",
									createdAt: "2026-06-24T01:00:00.000Z",
									id: "msg_user",
									kind: null,
									requestId: "req_01",
									retryable: null,
									role: "user",
									structuredParts: [],
									text: "奖学金怎么申请？",
								},
								{
									conversationId: "conv_created",
									createdAt: "2026-06-24T01:00:02.000Z",
									id: "msg_answer",
									kind: "answer",
									requestId: "req_01",
									retryable: null,
									role: "assistant",
									structuredParts: [],
									text: finalAnswer,
								},
							],
							pinnedAt: null,
							title: "奖学金申请",
							updatedAt: "2026-06-24T01:00:02.000Z",
						},
						result: {
							kind: "answer",
							requestId: "req_01",
							text: finalAnswer,
							traceId: "trace_01",
						},
					},
					occurredAt: "2026-06-24T01:00:02.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 3,
					status: "completed",
					traceId: "trace_01",
				},
				event: "request.completed",
			} satisfies ChatRequestStreamEvent;
		});

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);

			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "奖学金怎么申请？", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			expect(readAssistantText()).toBe("");
			await act(async () => {
				await vi.advanceTimersByTimeAsync(16);
			});
			expect(readAssistantText()).toBe(finalAnswer);

			releaseTerminal();
			await act(async () => {
				await submitPromise;
			});

			expect(assistantUiMock.externalStoreInput?.messages).toEqual([
				expect.objectContaining({ id: "msg_user", role: "user" }),
				expect.objectContaining({
					content: [{ text: finalAnswer, type: "text" }],
					id: "msg_answer",
					role: "assistant",
				}),
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("batches burst deltas into one animation frame", async () => {
		vi.useFakeTimers();
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_delta",
					runId: "run_delta",
					sequence: 1,
					status: "accepted",
					traceId: "trace_delta",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			yield {
				data: {
					delta: "按学校",
					messageId: "msg_delta",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_delta",
					runId: "run_delta",
					sequence: 2,
					status: "streaming",
					traceId: "trace_delta",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			yield {
				data: {
					delta: "奖学金通知",
					messageId: "msg_delta",
					occurredAt: "2026-06-24T01:00:02.000Z",
					requestId: "req_delta",
					runId: "run_delta",
					sequence: 3,
					status: "streaming",
					traceId: "trace_delta",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield {
				data: {
					error: { code: "execution_failed", message: "测试结束。", retryable: false },
					occurredAt: "2026-06-24T01:00:03.000Z",
					requestId: "req_delta",
					runId: "run_delta",
					sequence: 4,
					status: "failed",
					traceId: "trace_delta",
				},
				event: "request.failed",
			} satisfies ChatRequestStreamEvent;
		});

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "奖学金通知", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			expect(readAssistantText()).toBe("");
			expect(requestAnimationFrame).toHaveBeenCalledOnce();
			await act(async () => {
				await vi.advanceTimersByTimeAsync(16);
			});
			expect(readAssistantText()).toBe("按学校奖学金通知");

			await act(async () => {
				releaseTerminal();
				await submitPromise;
			});
			expect(hasMessageId("msg_delta")).toBe(false);
			expect(readAssistantText()).toBe("测试结束。");
		} finally {
			vi.useRealTimers();
		}
	});

	it("flushes a pending answer frame synchronously when the terminal event arrives", async () => {
		vi.useFakeTimers();
		assistantUiMock.initialize.mockResolvedValue({ remoteId: undefined });
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_terminal_flush",
						runId: "run_terminal_flush",
						sequence: 1,
						status: "accepted",
						traceId: "trace_terminal_flush",
					},
					event: "request.accepted",
				},
				{
					data: {
						delta: "终态前完整文本",
						messageId: "msg_terminal_flush",
						occurredAt: "2026-06-24T01:00:01.000Z",
						requestId: "req_terminal_flush",
						runId: "run_terminal_flush",
						sequence: 2,
						status: "streaming",
						traceId: "trace_terminal_flush",
					},
					event: "answer.delta",
				},
				{
					data: {
						occurredAt: "2026-06-24T01:00:02.000Z",
						requestId: "req_terminal_flush",
						runId: "run_terminal_flush",
						sequence: 3,
						status: "completed",
						traceId: "trace_terminal_flush",
					},
					event: "request.completed",
				},
			]),
		);

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			await act(async () => {
				await assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "立即完成", type: "text" }],
				});
			});

			expect(readAssistantText()).toBe("终态前完整文本");
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("suppresses answer deltas while Stop cancellation is requesting and acknowledged", async () => {
		vi.useFakeTimers();
		let releaseRequestingDelta: () => void = () => {
			throw new Error("requesting delta release was not initialized");
		};
		let markRequestingDeltaConsumed: () => void = () => {
			throw new Error("requesting delta marker was not initialized");
		};
		const requestingDeltaConsumed = new Promise<void>((resolve) => {
			markRequestingDeltaConsumed = resolve;
		});
		let releaseAcknowledgedDelta: () => void = () => {
			throw new Error("acknowledged delta release was not initialized");
		};
		let markAcknowledgedDeltaConsumed: () => void = () => {
			throw new Error("acknowledged delta marker was not initialized");
		};
		const acknowledgedDeltaConsumed = new Promise<void>((resolve) => {
			markAcknowledgedDeltaConsumed = resolve;
		});
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		let resolveCancellation: () => void = () => {
			throw new Error("cancellation resolution was not initialized");
		};
		conversationApiMock.cancelRun.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveCancellation = resolve;
				}),
		);
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseRequestingDelta = resolve;
			});
			yield {
				data: {
					delta: "请求取消中不可见",
					messageId: "msg_cancel_frame",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 2,
					status: "streaming",
					traceId: "trace_01",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			markRequestingDeltaConsumed();
			await new Promise<void>((resolve) => {
				releaseAcknowledgedDelta = resolve;
			});
			yield {
				data: {
					delta: "确认取消后仍不可见",
					messageId: "msg_cancel_frame",
					occurredAt: "2026-06-24T01:00:01.500Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 3,
					status: "streaming",
					traceId: "trace_01",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			markAcknowledgedDeltaConsumed();
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield cancellationTerminalEvent();
		});

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "停止渲染", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			let cancellationPromise: Promise<void> | undefined;
			await act(async () => {
				cancellationPromise = assistantUiMock.externalStoreInput?.onCancel();
				await Promise.resolve();
			});
			await act(async () => {
				releaseRequestingDelta();
				await requestingDeltaConsumed;
				await vi.advanceTimersByTimeAsync(16);
			});
			expect(hasMessageId("msg_cancel_frame")).toBe(false);

			await act(async () => {
				resolveCancellation();
				await cancellationPromise;
			});
			await act(async () => {
				releaseAcknowledgedDelta();
				await acknowledgedDeltaConsumed;
				await vi.advanceTimersByTimeAsync(16);
			});
			expect(hasMessageId("msg_cancel_frame")).toBe(false);

			releaseTerminal();
			await act(async () => {
				await submitPromise;
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("cancels a pending answer frame on unmount", async () => {
		vi.useFakeTimers();
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame");
		let streamSignal: AbortSignal | undefined;
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input) {
			streamSignal = input.signal;
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_unmount_frame",
					runId: "run_unmount_frame",
					sequence: 1,
					status: "accepted",
					traceId: "trace_unmount_frame",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			yield {
				data: {
					delta: "卸载后不渲染",
					messageId: "msg_unmount_frame",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_unmount_frame",
					runId: "run_unmount_frame",
					sequence: 2,
					status: "streaming",
					traceId: "trace_unmount_frame",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
		});

		try {
			const { unmount } = render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "卸载", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});
			cancelAnimationFrame.mockClear();

			await act(async () => {
				unmount();
				await submitPromise;
			});

			expect(cancelAnimationFrame).toHaveBeenCalledOnce();
			expect(streamSignal?.aborted).toBe(true);
			expect(conversationApiMock.resumeRunEventsStream).not.toHaveBeenCalled();
			expect(conversationApiMock.cancelRun).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("removes provisional text when an accepted run resumes into a non-retryable stream error", async () => {
		vi.useFakeTimers();
		let markDeltaConsumed: () => void = () => {
			throw new Error("delta consumption marker was not initialized");
		};
		const deltaConsumed = new Promise<void>((resolve) => {
			markDeltaConsumed = resolve;
		});
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_resume_failed",
					runId: "run_resume_failed",
					sequence: 1,
					status: "accepted",
					traceId: "trace_resume_failed",
				},
				event: "request.accepted",
			};
			yield {
				data: {
					delta: "不完整草稿",
					messageId: "msg_resume_draft",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_resume_failed",
					runId: "run_resume_failed",
					sequence: 2,
					status: "streaming",
					traceId: "trace_resume_failed",
				},
				event: "answer.delta",
			};
			markDeltaConsumed();
		});
		conversationApiMock.resumeRunEventsStream.mockImplementation(async function* () {
			yield* [] as ChatRequestStreamEvent[];
			throw new ChatStreamRequestError({
				code: "execution_failed",
				message: "恢复回答失败。",
				requestId: "req_resume_failed",
				retryable: false,
				traceId: "trace_resume_failed",
			});
		});

		try {
			render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "恢复回答", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});
			await act(async () => {
				await deltaConsumed;
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(16);
			});
			expect(hasMessageId("msg_resume_draft")).toBe(true);

			await act(async () => {
				await vi.advanceTimersByTimeAsync(250);
				await submitPromise;
			});

			expect(hasMessageId("msg_resume_draft")).toBe(false);
			expect(readAssistantText()).toBe("恢复回答失败。");
		} finally {
			vi.useRealTimers();
		}
	});

	it("waits for durable cancellation confirmation and merges duplicate stop requests", async () => {
		let observedSignal: AbortSignal | undefined;
		let resolveCancellation: () => void = () => {
			throw new Error("cancellation resolution was not initialized");
		};
		let releaseStream: () => void = () => {
			throw new Error("stream release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input: {
			signal?: AbortSignal;
		}) {
			observedSignal = input.signal;
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseStream = resolve;
			});
			yield cancellationTerminalEvent();
		});
		conversationApiMock.cancelRun.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveCancellation = resolve;
				}),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "hi 你是谁", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);
		expect(observedSignal?.aborted).toBe(false);

		let firstCancellation: Promise<void> | undefined;
		let duplicateCancellation: Promise<void> | undefined;
		await act(async () => {
			firstCancellation = assistantUiMock.externalStoreInput?.onCancel();
			duplicateCancellation = assistantUiMock.externalStoreInput?.onCancel();
			await Promise.resolve();
		});

		expect(observedSignal?.aborted).toBe(false);
		expect(conversationApiMock.cancelRun).toHaveBeenCalledWith("run_01");
		expect(conversationApiMock.cancelRun).toHaveBeenCalledTimes(1);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		await act(async () => {
			resolveCancellation();
			await Promise.all([firstCancellation, duplicateCancellation]);
		});

		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		releaseStream();
		await act(async () => {
			await submitPromise;
		});
		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
	});

	it("reveals the complete accumulated answer when cancellation fails and continues streaming", async () => {
		vi.useFakeTimers();
		let observedSignal: AbortSignal | undefined;
		let releaseSuppressedDelta: () => void = () => {
			throw new Error("suppressed delta release was not initialized");
		};
		let markSuppressedDeltaConsumed: () => void = () => {
			throw new Error("suppressed delta marker was not initialized");
		};
		const suppressedDeltaConsumed = new Promise<void>((resolve) => {
			markSuppressedDeltaConsumed = resolve;
		});
		let releaseVisibleDelta: () => void = () => {
			throw new Error("visible delta release was not initialized");
		};
		let markVisibleDeltaConsumed: () => void = () => {
			throw new Error("visible delta marker was not initialized");
		};
		const visibleDeltaConsumed = new Promise<void>((resolve) => {
			markVisibleDeltaConsumed = resolve;
		});
		let rejectCancellation: (error: Error) => void = () => {
			throw new Error("cancellation rejection was not initialized");
		};
		let releaseStream: () => void = () => {
			throw new Error("stream release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input: {
			signal?: AbortSignal;
		}) {
			observedSignal = input.signal;
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseSuppressedDelta = resolve;
			});
			yield {
				data: {
					delta: "取消期间累计的回答",
					messageId: "msg_cancel_failure",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 2,
					status: "streaming",
					traceId: "trace_01",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			markSuppressedDeltaConsumed();
			await new Promise<void>((resolve) => {
				releaseVisibleDelta = resolve;
			});
			yield {
				data: {
					delta: "，恢复后继续。",
					messageId: "msg_cancel_failure",
					occurredAt: "2026-06-24T01:00:01.500Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 3,
					status: "streaming",
					traceId: "trace_01",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			markVisibleDeltaConsumed();
			await new Promise<void>((resolve) => {
				releaseStream = resolve;
			});
			yield cancellationTerminalEvent();
		});
		conversationApiMock.cancelRun.mockImplementation(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectCancellation = reject;
				}),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "hi 你是谁", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		let cancellationPromise: Promise<void> | undefined;
		await act(async () => {
			cancellationPromise = assistantUiMock.externalStoreInput?.onCancel();
			await Promise.resolve();
		});
		await act(async () => {
			releaseSuppressedDelta();
			await suppressedDeltaConsumed;
			await vi.advanceTimersByTimeAsync(16);
		});
		expect(hasMessageId("msg_cancel_failure")).toBe(false);
		await act(async () => {
			rejectCancellation(new Error("cancel transport failed"));
			await cancellationPromise;
		});

		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);
		expect(readMessageText("msg_cancel_failure")).toBe("取消期间累计的回答");
		expect(readAssistantText()).toBe("取消期间累计的回答");
		expect(conversationApiMock.cancelRun).toHaveBeenNthCalledWith(1, "run_01");

		await act(async () => {
			releaseVisibleDelta();
			await visibleDeltaConsumed;
			await vi.advanceTimersByTimeAsync(16);
		});
		expect(readMessageText("msg_cancel_failure")).toBe("取消期间累计的回答，恢复后继续。");
		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		releaseStream();
		await act(async () => {
			await submitPromise;
		});
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		vi.useRealTimers();
	});

	it("keeps a terminal result when it wins the race with cancellation confirmation", async () => {
		let observedSignal: AbortSignal | undefined;
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		let resolveCancellation: () => void = () => {
			throw new Error("cancellation resolution was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input: {
			signal?: AbortSignal;
		}) {
			observedSignal = input.signal;
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield {
				data: {
					delta: "自然完成前的片段",
					messageId: "msg_answer",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 2,
					status: "streaming",
					traceId: "trace_01",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			yield completedTerminalEvent("自然完成的完整答案。");
		});
		conversationApiMock.cancelRun.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveCancellation = resolve;
				}),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "hi 你是谁", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		let cancellationPromise: Promise<void> | undefined;
		await act(async () => {
			cancellationPromise = assistantUiMock.externalStoreInput?.onCancel();
			await Promise.resolve();
		});
		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		await act(async () => {
			releaseTerminal();
			await submitPromise;
		});

		expect(readAssistantText()).toBe("自然完成的完整答案。");
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(observedSignal?.aborted).toBe(false);

		await act(async () => {
			resolveCancellation();
			await cancellationPromise;
		});

		expect(readAssistantText()).toBe("自然完成的完整答案。");
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(observedSignal?.aborted).toBe(false);
	});

	it("continues consuming the natural terminal result when cancel reports it already won", async () => {
		let observedSignal: AbortSignal | undefined;
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input: {
			signal?: AbortSignal;
		}) {
			observedSignal = input.signal;
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield {
				data: {
					error: {
						code: "execution_failed",
						message: "运行已自然结束。",
						retryable: false,
					},
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 2,
					status: "failed",
					traceId: "trace_01",
				},
				event: "request.failed",
			} satisfies ChatRequestStreamEvent;
		});
		conversationApiMock.cancelRun.mockRejectedValue(
			new ChatStreamRequestError({
				code: "run_already_terminal",
				message: "Run is already terminal.",
				retryable: false,
			}),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "hi 你是谁", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onCancel();
		});
		await act(async () => {
			await assistantUiMock.externalStoreInput?.onCancel();
		});
		expect(conversationApiMock.cancelRun).toHaveBeenCalledTimes(1);
		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);
		expect(readAssistantText()).toBe("");

		await act(async () => {
			releaseTerminal();
			await submitPromise;
		});

		expect(readAssistantText()).toBe("运行已自然结束。");
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(observedSignal?.aborted).toBe(false);
	});

	it("keeps the active stream when cancellation requires a fresh login", async () => {
		let observedSignal: AbortSignal | undefined;
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input: {
			signal?: AbortSignal;
		}) {
			observedSignal = input.signal;
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield {
				data: {
					error: { code: "execution_failed", message: "运行已结束。", retryable: false },
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 2,
					status: "failed",
					traceId: "trace_01",
				},
				event: "request.failed",
			} satisfies ChatRequestStreamEvent;
		});
		conversationApiMock.cancelRun.mockRejectedValue(new UnauthorizedError());
		const onLoginRequired = vi.fn();
		render(<RuntimeProbe onLoginRequired={onLoginRequired} />);

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "hi 你是谁", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => {
			await assistantUiMock.externalStoreInput?.onCancel();
		});

		expect(onLoginRequired).toHaveBeenCalledTimes(1);
		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		await act(async () => {
			releaseTerminal();
			await submitPromise;
		});
		expect(readAssistantText()).toBe("运行已结束。");
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
	});

	it("cancels the durable run after accepted when stop is clicked before run identity arrives", async () => {
		let observedSignal: AbortSignal | undefined;
		let releaseAccepted: () => void = () => {
			throw new Error("accepted release was not initialized");
		};
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input: {
			signal?: AbortSignal;
		}) {
			observedSignal = input.signal;
			await new Promise<void>((resolve) => {
				releaseAccepted = resolve;
			});
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield cancellationTerminalEvent();
		});
		conversationApiMock.cancelRun.mockResolvedValue(undefined);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "hi 你是谁", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);
		expect(observedSignal?.aborted).toBe(false);

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onCancel();
		});

		expect(observedSignal?.aborted).toBe(false);
		expect(conversationApiMock.cancelRun).not.toHaveBeenCalled();

		await act(async () => {
			releaseAccepted();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(conversationApiMock.cancelRun).toHaveBeenCalledWith("run_01");
		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		await act(async () => {
			releaseTerminal();
			await submitPromise;
		});
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
	});

	it("keeps consuming when pending cancellation requires a fresh login", async () => {
		let observedSignal: AbortSignal | undefined;
		let releaseAccepted: () => void = () => {
			throw new Error("accepted release was not initialized");
		};
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input: {
			signal?: AbortSignal;
		}) {
			observedSignal = input.signal;
			await new Promise<void>((resolve) => {
				releaseAccepted = resolve;
			});
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield {
				data: {
					error: { code: "execution_failed", message: "运行已结束。", retryable: false },
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 2,
					status: "failed",
					traceId: "trace_01",
				},
				event: "request.failed",
			} satisfies ChatRequestStreamEvent;
		});
		conversationApiMock.cancelRun.mockRejectedValue(new UnauthorizedError());
		const onLoginRequired = vi.fn();
		render(<RuntimeProbe onLoginRequired={onLoginRequired} />);

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "hi 你是谁", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => {
			await assistantUiMock.externalStoreInput?.onCancel();
			releaseAccepted();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(conversationApiMock.cancelRun).toHaveBeenCalledWith("run_01");
		expect(onLoginRequired).toHaveBeenCalledTimes(1);
		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		await act(async () => {
			releaseTerminal();
			await submitPromise;
		});
		expect(readAssistantText()).toBe("运行已结束。");
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(observedSignal?.aborted).toBe(false);
	});

	it("requests login when the initial lifecycle stream is unauthorized", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield* [] as ChatRequestStreamEvent[];
			throw new UnauthorizedError();
		});
		const onLoginRequired = vi.fn();
		render(<RuntimeProbe onLoginRequired={onLoginRequired} />);

		await act(async () => {
			await expect(
				assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "登录状态是否有效？", type: "text" }],
				}),
			).resolves.toBeUndefined();
		});

		expect(onLoginRequired).toHaveBeenCalledTimes(1);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledTimes(1);
	});

	it("does not retry a resume stream after authentication expires", async () => {
		vi.useFakeTimers();
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
		});
		conversationApiMock.resumeRunEventsStream.mockImplementation(async function* () {
			yield* [] as ChatRequestStreamEvent[];
			throw new UnauthorizedError();
		});
		const onLoginRequired = vi.fn();
		render(<RuntimeProbe onLoginRequired={onLoginRequired} />);

		try {
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "断线后继续", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(250);
				await submitPromise;
			});

			expect(onLoginRequired).toHaveBeenCalledTimes(1);
			expect(conversationApiMock.resumeRunEventsStream).toHaveBeenCalledTimes(1);
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders failed stream startup as an assistant error message without throwing", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield* [] as ChatRequestStreamEvent[];
			throw new ChatStreamRequestError({
				code: "execution_failed",
				message: "请求失败。",
				requestId: "req_failed",
				retryable: false,
				traceId: "trace_failed",
			});
		});

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		await act(async () => {
			await expect(
				assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "这次会失败吗？", type: "text" }],
				}),
			).resolves.toBeUndefined();
		});

		await waitFor(() => expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false));
		expect(assistantUiMock.externalStoreInput?.messages).toEqual([
			expect.objectContaining({ role: "user" }),
			expect.objectContaining({
				content: [{ text: "请求失败。", type: "text" }],
				id: "local-error-req_failed",
				role: "assistant",
			}),
		]);
		expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();
	});

	it("renders a failed stream terminal event as an assistant error message", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_failed",
						runId: "run_failed",
						sequence: 1,
						status: "accepted",
						traceId: "trace_failed",
					},
					event: "request.accepted",
				},
				{
					data: {
						error: {
							code: "execution_failed",
							message: "请求失败。",
							retryable: true,
						},
						occurredAt: "2026-06-24T01:00:01.000Z",
						requestId: "req_failed",
						runId: "run_failed",
						sequence: 2,
						status: "failed",
						traceId: "trace_failed",
					},
					event: "request.failed",
				},
			]),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		await act(async () => {
			await expect(
				assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "这次会失败吗？", type: "text" }],
				}),
			).resolves.toBeUndefined();
		});

		await waitFor(() => expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false));
		expect(assistantUiMock.externalStoreInput?.messages).toEqual([
			expect.objectContaining({ role: "user" }),
			expect.objectContaining({
				content: [{ text: "请求失败。", type: "text" }],
				id: "local-error-req_failed",
				role: "assistant",
			}),
		]);
		expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();
	});

	it("keeps local streaming messages when assistant-ui publishes the newly initialized remote thread", async () => {
		vi.useFakeTimers();
		const finalAnswer = "我是中央民族大学校园问答助手。";
		let markDeltaConsumed: () => void = () => {
			throw new Error("delta consumption marker was not initialized");
		};
		const deltaConsumed = new Promise<void>((resolve) => {
			markDeltaConsumed = resolve;
		});
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		conversationApiMock.getConversationDetail.mockResolvedValue({
			archivedAt: null,
			createdAt: "2026-06-24T01:00:00.000Z",
			id: "conv_created",
			messages: [],
			pinnedAt: null,
			title: "新对话",
			updatedAt: "2026-06-24T01:00:00.000Z",
		});
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 1,
					status: "accepted",
					traceId: "trace_01",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			yield {
				data: {
					delta: finalAnswer,
					messageId: "msg_answer",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 2,
					status: "streaming",
					traceId: "trace_01",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			markDeltaConsumed();
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield {
				data: {
					answer: {
						conversation: {
							archivedAt: null,
							createdAt: "2026-06-24T01:00:00.000Z",
							id: "conv_created",
							messages: [
								{
									conversationId: "conv_created",
									createdAt: "2026-06-24T01:00:00.000Z",
									id: "msg_user",
									kind: null,
									requestId: "req_01",
									retryable: null,
									role: "user",
									structuredParts: [],
									text: "hi 你是谁",
								},
								{
									conversationId: "conv_created",
									createdAt: "2026-06-24T01:00:02.000Z",
									id: "msg_answer",
									kind: "answer",
									requestId: "req_01",
									retryable: null,
									role: "assistant",
									structuredParts: [],
									text: finalAnswer,
								},
							],
							pinnedAt: null,
							title: "hi 你是谁",
							updatedAt: "2026-06-24T01:00:02.000Z",
						},
						result: {
							kind: "answer",
							requestId: "req_01",
							text: finalAnswer,
							traceId: "trace_01",
						},
					},
					occurredAt: "2026-06-24T01:00:02.000Z",
					requestId: "req_01",
					runId: "run_01",
					sequence: 3,
					status: "completed",
					traceId: "trace_01",
				},
				event: "request.completed",
			} satisfies ChatRequestStreamEvent;
		});

		try {
			const { rerender } = render(<RuntimeProbe onLoginRequired={vi.fn()} />);

			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "hi 你是谁", type: "text" }],
				});
				await Promise.resolve();
				await Promise.resolve();
			});
			await act(async () => {
				await deltaConsumed;
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(16);
			});

			const streamingPreview = readAssistantText();
			expect(streamingPreview).toBe(finalAnswer);

			assistantUiMock.remoteId = "conv_created";
			await act(async () => {
				rerender(<RuntimeProbe onLoginRequired={vi.fn()} />);
				await Promise.resolve();
			});

			expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();
			expect(readAssistantText()).toBe(streamingPreview);

			releaseTerminal();
			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
			});

			await act(async () => {
				vi.runAllTimers();
				await submitPromise;
			});

			expect(assistantUiMock.externalStoreInput?.messages).toEqual([
				expect.objectContaining({ id: "msg_user", role: "user" }),
				expect.objectContaining({ id: "msg_answer", role: "assistant" }),
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("reloads a newly initialized conversation after switching away and back", async () => {
		let releaseStream: () => void = () => {
			throw new Error("stream release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_switch_back",
					runId: "run_switch_back",
					sequence: 1,
					status: "accepted",
					traceId: "trace_switch_back",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseStream = resolve;
			});
		});
		conversationApiMock.getConversationDetail.mockImplementation(
			async (conversationId: string) => ({
				archivedAt: null,
				createdAt: "2026-06-24T01:00:00.000Z",
				id: conversationId,
				messages: [
					{
						conversationId,
						createdAt: "2026-06-24T01:00:00.000Z",
						id: `msg_${conversationId}`,
						kind: "answer",
						requestId: null,
						retryable: null,
						role: "assistant",
						structuredParts: [],
						text: `loaded ${conversationId}`,
					},
				],
				pinnedAt: null,
				title: conversationId,
				updatedAt: "2026-06-24T01:00:00.000Z",
			}),
		);
		const { rerender } = render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		await act(async () => {
			void assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "初始化后切换", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
		});
		assistantUiMock.remoteId = "conv_created";
		await act(async () => {
			rerender(<RuntimeProbe onLoginRequired={vi.fn()} />);
			await Promise.resolve();
		});
		expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();

		assistantUiMock.threadId = "conv_other";
		assistantUiMock.remoteId = "conv_other";
		await act(async () => {
			rerender(<RuntimeProbe onLoginRequired={vi.fn()} />);
		});
		await waitFor(() => expect(readAssistantText()).toBe("loaded conv_other"));

		assistantUiMock.threadId = "__LOCALID_new";
		assistantUiMock.remoteId = "conv_created";
		await act(async () => {
			rerender(<RuntimeProbe onLoginRequired={vi.fn()} />);
		});
		await waitFor(() => expect(readAssistantText()).toBe("loaded conv_created"));
		expect(conversationApiMock.getConversationDetail).toHaveBeenNthCalledWith(
			2,
			"conv_created",
			expect.any(AbortSignal),
		);

		releaseStream();
	});
});
