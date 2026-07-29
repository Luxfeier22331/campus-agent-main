import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
	initialize: vi.fn(),
	remoteId: undefined as string | undefined,
}));

const conversationApiMock = vi.hoisted(() => ({
	cancelRun: vi.fn(),
	ChatStreamRequestError: class ChatStreamRequestError extends Error {
		code: string;
		requestId?: string;
		retryable: boolean;
		traceId?: string;

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
	resumeRunEventsStream: vi.fn(),
	submitChatRequestStream: vi.fn(),
}));

const telemetryMock = vi.hoisted(() => ({
	recordChatBrowserTtft: vi.fn(),
}));

vi.mock("@assistant-ui/react", () => ({
	useAui: () => ({
		threadListItem: () => ({
			initialize: assistantUiMock.initialize,
		}),
	}),
	useAuiState: (selector: (state: { threadListItem: { remoteId?: string } }) => unknown) =>
		selector({ threadListItem: { remoteId: assistantUiMock.remoteId } }),
	useExternalStoreRuntime: (input: typeof assistantUiMock.externalStoreInput) => {
		assistantUiMock.externalStoreInput = input;
		return input;
	},
}));

vi.mock("../src/features/conversation/api", () => conversationApiMock);
vi.mock("@/platform/telemetry/sentry-browser-loader", () => telemetryMock);

function RuntimeProbe({
	hasSession = true,
	onLoginRequired,
}: {
	hasSession?: boolean;
	onLoginRequired: () => void;
}) {
	const useRuntime = createCampusAssistantRuntimeHook({ hasSession, onLoginRequired });
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

describe("assistant-ui runtime lifecycle bridge", () => {
	beforeEach(() => {
		assistantUiMock.externalStoreInput = null;
		assistantUiMock.remoteId = undefined;
		assistantUiMock.initialize.mockReset();
		assistantUiMock.initialize.mockResolvedValue({ remoteId: "conv_created" });
		conversationApiMock.cancelRun.mockReset();
		conversationApiMock.deleteTrailingMessages.mockReset();
		conversationApiMock.getConversationDetail.mockReset();
		conversationApiMock.resumeRunEventsStream.mockReset();
		conversationApiMock.submitChatRequestStream.mockReset();
		telemetryMock.recordChatBrowserTtft.mockReset();
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
			expect(telemetryMock.recordChatBrowserTtft).not.toHaveBeenCalled();
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

	it("reveals answer delta text incrementally before terminal closeout is applied", async () => {
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

			expect(readAssistantText().length).toBeGreaterThan(0);
			expect(readAssistantText().length).toBeLessThan(finalAnswer.length);

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

	it("accumulates raw deltas after the typewriter catches up and records TTFT once", async () => {
		vi.useFakeTimers();
		let releaseSecondDelta: () => void = () => {
			throw new Error("second delta release was not initialized");
		};
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
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
			await new Promise<void>((resolve) => {
				releaseSecondDelta = resolve;
			});
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

			await act(async () => {
				vi.runAllTimers();
			});
			expect(readAssistantText()).toBe("按学校");

			await act(async () => {
				releaseSecondDelta();
				await vi.advanceTimersByTimeAsync(250);
			});
			expect(readAssistantText()).toBe("按学校奖学金通知");
			expect(telemetryMock.recordChatBrowserTtft).toHaveBeenCalledTimes(1);
			expect(telemetryMock.recordChatBrowserTtft).toHaveBeenCalledWith(expect.any(Number));

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

	it("removes provisional text when an accepted run resumes into a non-retryable stream error", async () => {
		vi.useFakeTimers();
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_resume_failed",
						runId: "run_resume_failed",
						sequence: 1,
						status: "accepted",
						traceId: "trace_resume_failed",
					},
					event: "request.accepted",
				},
				{
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
				},
			]),
		);
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

	it("keeps the active run consumable when cancellation fails and allows retry", async () => {
		let observedSignal: AbortSignal | undefined;
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
		conversationApiMock.cancelRun
			.mockRejectedValueOnce(new Error("cancel transport failed"))
			.mockResolvedValueOnce(undefined);

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

		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);
		expect(readAssistantText()).toBe("取消请求失败，当前回答仍在继续。");
		expect(conversationApiMock.cancelRun).toHaveBeenNthCalledWith(1, "run_01");

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onCancel();
		});

		expect(conversationApiMock.cancelRun).toHaveBeenNthCalledWith(2, "run_01");
		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		releaseStream();
		await act(async () => {
			await submitPromise;
		});
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
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

		expect(readAssistantText()).toBe("运行已自然结束。");
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(observedSignal?.aborted).toBe(false);

		await act(async () => {
			resolveCancellation();
			await cancellationPromise;
		});

		expect(readAssistantText()).toBe("运行已自然结束。");
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

			const streamingPreview = readAssistantText();
			expect(streamingPreview.length).toBeGreaterThan(0);
			expect(streamingPreview.length).toBeLessThan(finalAnswer.length);

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
});
