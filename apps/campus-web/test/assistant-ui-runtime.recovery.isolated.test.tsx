import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";
import {
	assistantUiTestState as assistantUiMock,
	TestChatStreamRequestError as ChatStreamRequestError,
	completedTerminalEvent,
	conversationApiTestMock as conversationApiMock,
	hasMessageId,
	installAssistantUiRuntimeTestHarness,
	RuntimeProbe,
	readAssistantText,
	readMessageText,
	streamEvents,
	TestUnauthorizedError as UnauthorizedError,
} from "./assistant-ui-runtime.test-support";

describe("assistant-ui runtime recovery and terminal handling", () => {
	installAssistantUiRuntimeTestHarness();

	it("restores an active durable run after refresh without submitting the prompt again", async () => {
		assistantUiMock.remoteId = "conv_created";
		conversationApiMock.getConversationDetail.mockResolvedValue({
			activeRunId: "run_01",
			archivedAt: null,
			createdAt: "2026-06-24T01:00:00.000Z",
			id: "conv_created",
			messages: [],
			pinnedAt: null,
			title: "正在回答",
			updatedAt: "2026-06-24T01:00:01.000Z",
		});
		conversationApiMock.getRunStatus.mockResolvedValue({
			acceptedAt: "2026-06-24T01:00:00.000Z",
			completedAt: null,
			conversationId: "conv_created",
			durationMs: null,
			phase: "running",
			requestId: "req_01",
			runId: "run_01",
			startedAt: "2026-06-24T01:00:01.000Z",
			status: "running",
			traceId: "trace_01",
		});
		conversationApiMock.getRunEvents.mockResolvedValue({
			events: [completedTerminalEvent("刷新后恢复的完整答案。")],
			nextSequence: 3,
			run: {
				acceptedAt: "2026-06-24T01:00:00.000Z",
				completedAt: null,
				conversationId: "conv_created",
				durationMs: null,
				phase: "running",
				requestId: "req_01",
				runId: "run_01",
				startedAt: "2026-06-24T01:00:01.000Z",
				status: "running",
				traceId: "trace_01",
			},
		});

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		await waitFor(() => {
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(readAssistantText()).toBe("刷新后恢复的完整答案。");
		});
		expect(conversationApiMock.submitChatRequestStream).not.toHaveBeenCalled();
		expect(conversationApiMock.getRunStatus).toHaveBeenCalledWith({
			runId: "run_01",
			signal: expect.any(AbortSignal),
		});
		expect(conversationApiMock.getRunEvents).toHaveBeenCalledWith({
			afterSequence: 0,
			runId: "run_01",
			signal: expect.any(AbortSignal),
		});
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
								activeRunId: null,
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
		expect(conversationApiMock.getConversationDetail).toHaveBeenCalledOnce();
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

	it("keeps the accepted run visible when resume fails with a non-retryable stream error", async () => {
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

			expect(hasMessageId("msg_resume_draft")).toBe(true);
			expect(readMessageText("msg_resume_draft")).toBe("不完整草稿");
			expect(readMessageText("local-error-req_resume_failed")).toBe("恢复回答失败。");
			expect(assistantUiMock.externalStoreInput?.messages).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: "msg_resume_draft",
						metadata: {
							custom: {
								campusRun: expect.objectContaining({
									connection: "disconnected",
									runId: "run_resume_failed",
								}),
							},
						},
					}),
				]),
			);
		} finally {
			vi.useRealTimers();
		}
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
				metadata: {
					custom: {
						campusRun: expect.objectContaining({
							runId: "run_failed",
							status: "failed",
						}),
					},
				},
				role: "assistant",
			}),
			expect.objectContaining({
				content: [{ text: "请求失败。", type: "text" }],
				id: "local-error-req_failed",
				role: "assistant",
			}),
		]);
		expect(conversationApiMock.getConversationDetail).not.toHaveBeenCalled();
	});
});
