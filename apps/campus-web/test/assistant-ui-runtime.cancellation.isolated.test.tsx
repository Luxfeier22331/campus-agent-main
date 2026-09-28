import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";
import type { ChatRunStatus } from "../src/features/conversation/run-client";
import {
	assistantUiTestState as assistantUiMock,
	TestChatStreamRequestError as ChatStreamRequestError,
	cancellationTerminalEvent,
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

function runningCancellationStatus(): ChatRunStatus {
	return {
		acceptedAt: "2026-06-24T01:00:00.000Z",
		completedAt: null,
		conversationId: "conv_created",
		durationMs: null,
		phase: "running",
		requestId: "req_01",
		startedAt: "2026-06-24T01:00:01.000Z",
		status: "running",
	};
}

describe("assistant-ui runtime cancellation and rendering races", () => {
	installAssistantUiRuntimeTestHarness();

	it("renders the first answer delta without an empty assistant shell", async () => {
		const finalAnswer = "按学校奖学金通知提交材料。";
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					sequence: 1,
					status: "accepted",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			yield {
				data: {
					delta: finalAnswer,
					messageId: "msg_answer",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					sequence: 2,
					status: "streaming",
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
							activeRequestId: null,
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
						},
					},
					occurredAt: "2026-06-24T01:00:02.000Z",
					requestId: "req_01",
					sequence: 3,
					status: "completed",
				},
				event: "request.completed",
			} satisfies ChatRequestStreamEvent;
		});
		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "奖学金怎么申请？", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
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
	});

	it("updates one assistant message for burst deltas", async () => {
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_delta",
					sequence: 1,
					status: "accepted",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			yield {
				data: {
					delta: "按学校",
					messageId: "msg_delta",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_delta",
					sequence: 2,
					status: "streaming",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			yield {
				data: {
					delta: "奖学金通知",
					messageId: "msg_delta",
					occurredAt: "2026-06-24T01:00:02.000Z",
					requestId: "req_delta",
					sequence: 3,
					status: "streaming",
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
					sequence: 4,
					status: "failed",
				},
				event: "request.failed",
			} satisfies ChatRequestStreamEvent;
		});
		const canonical = completedTerminalEvent("测试结束。").data.answer?.conversation;
		if (!canonical) {
			throw new Error("Expected a canonical conversation fixture.");
		}
		conversationApiMock.getConversationDetail.mockResolvedValue(canonical);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "奖学金通知", type: "text" }],
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(readAssistantText()).toBe("按学校奖学金通知");

		await act(async () => {
			releaseTerminal();
			await submitPromise;
		});
		expect(hasMessageId("msg_delta")).toBe(false);
		expect(readMessageText("msg_answer")).toBe("测试结束。");
		expect(hasMessageId("local-error-req_delta")).toBe(false);
		expect(assistantUiMock.externalStoreInput?.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "msg_answer",
				}),
			]),
		);
	});

	it("flushes a pending answer frame synchronously when the terminal event arrives", async () => {
		assistantUiMock.initialize.mockResolvedValue({ remoteId: undefined });
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_terminal_flush",
						sequence: 1,
						status: "accepted",
					},
					event: "request.accepted",
				},
				{
					data: {
						delta: "终态前完整文本",
						messageId: "msg_terminal_flush",
						occurredAt: "2026-06-24T01:00:01.000Z",
						requestId: "req_terminal_flush",
						sequence: 2,
						status: "streaming",
					},
					event: "answer.delta",
				},
				{
					data: {
						occurredAt: "2026-06-24T01:00:02.000Z",
						requestId: "req_terminal_flush",
						sequence: 3,
						status: "completed",
					},
					event: "request.completed",
				},
			]),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		await act(async () => {
			await assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "立即完成", type: "text" }],
			});
		});

		expect(readAssistantText()).toBe("终态前完整文本");
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
	});

	it("does not render answer deltas while Stop cancellation is requesting and acknowledged", async () => {
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
		let resolveCancellation: (status: ChatRunStatus) => void = () => {
			throw new Error("cancellation resolution was not initialized");
		};
		conversationApiMock.cancelRun.mockImplementation(
			() =>
				new Promise<ChatRunStatus>((resolve) => {
					resolveCancellation = resolve;
				}),
		);
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					sequence: 1,
					status: "accepted",
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
					sequence: 2,
					status: "streaming",
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
					sequence: 3,
					status: "streaming",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			markAcknowledgedDeltaConsumed();
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield cancellationTerminalEvent({ sequence: 4 });
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
			expect(readAssistantText()).toBe("");

			await act(async () => {
				resolveCancellation(runningCancellationStatus());
				await cancellationPromise;
			});
			await act(async () => {
				releaseAcknowledgedDelta();
				await acknowledgedDeltaConsumed;
				await vi.advanceTimersByTimeAsync(16);
			});
			expect(hasMessageId("msg_cancel_frame")).toBe(false);
			expect(readAssistantText()).toBe("");

			releaseTerminal();
			await act(async () => {
				await submitPromise;
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not start recovery after unmount", async () => {
		vi.useFakeTimers();
		let releaseStream!: () => void;
		const streamEnded = new Promise<void>((resolve) => {
			releaseStream = resolve;
		});
		let markDeltaConsumed!: () => void;
		const deltaConsumed = new Promise<void>((resolve) => {
			markDeltaConsumed = resolve;
		});
		let observedSignal: AbortSignal | undefined;
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input) {
			observedSignal = input.signal;
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_unmount_frame",
					sequence: 1,
					status: "accepted",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			yield {
				data: {
					delta: "卸载后不渲染",
					messageId: "msg_unmount_frame",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_unmount_frame",
					sequence: 2,
					status: "streaming",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			markDeltaConsumed();
			await streamEnded;
		});

		try {
			const { unmount } = render(<RuntimeProbe onLoginRequired={vi.fn()} />);
			let submitPromise: Promise<void> | undefined;
			await act(async () => {
				submitPromise = assistantUiMock.externalStoreInput?.onNew({
					content: [{ text: "卸载", type: "text" }],
				});
				await deltaConsumed;
			});
			unmount();
			expect(observedSignal?.aborted).toBe(true);
			await act(async () => {
				releaseStream();
				await submitPromise;
			});

			expect(conversationApiMock.getRunStatus).not.toHaveBeenCalled();
			expect(conversationApiMock.resumeRunEventsStream).not.toHaveBeenCalled();
			expect(conversationApiMock.cancelRun).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not resume when unmounted during the recovery status query", async () => {
		let resolveStatus!: (status: ChatRunStatus) => void;
		const statusResult = new Promise<ChatRunStatus>((resolve) => {
			resolveStatus = resolve;
		});
		let markStatusRequested!: () => void;
		const statusRequested = new Promise<void>((resolve) => {
			markStatusRequested = resolve;
		});
		let observedSignal: AbortSignal | undefined;
		conversationApiMock.getRunStatus.mockImplementation((input) => {
			observedSignal = input.signal;
			markStatusRequested();
			return statusResult;
		});
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				{
					data: {
						occurredAt: "2026-06-24T01:00:00.000Z",
						requestId: "req_01",
						sequence: 1,
						status: "accepted",
					},
					event: "request.accepted",
				},
			]),
		);
		const { unmount } = render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "恢复查询期间卸载", type: "text" }],
			});
			await statusRequested;
		});
		expect(conversationApiMock.getRunStatus).toHaveBeenCalledTimes(1);
		unmount();
		expect(observedSignal?.aborted).toBe(true);
		await act(async () => {
			resolveStatus(runningCancellationStatus());
			await submitPromise;
		});
		expect(conversationApiMock.resumeRunEventsStream).not.toHaveBeenCalled();
		expect(conversationApiMock.cancelRun).not.toHaveBeenCalled();
	});

	it("waits for durable cancellation confirmation and merges duplicate stop requests", async () => {
		let observedSignal: AbortSignal | undefined;
		let resolveCancellation: (status: ChatRunStatus) => void = () => {
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
					sequence: 1,
					status: "accepted",
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
				new Promise<ChatRunStatus>((resolve) => {
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
		expect(conversationApiMock.cancelRun).toHaveBeenCalledWith("req_01");
		expect(conversationApiMock.cancelRun).toHaveBeenCalledTimes(1);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		await act(async () => {
			resolveCancellation(runningCancellationStatus());
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

	it("renders the canonical cancelled message with localized text and errorCode metadata", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* () {
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_01",
					sequence: 1,
					status: "accepted",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			yield cancellationTerminalEvent({
				messages: [
					{
						conversationId: "conv_created",
						createdAt: "2026-06-24T01:00:00.000Z",
						id: "msg_user",
						kind: null,
						requestId: "req_01",
						retryable: null,
						role: "user",
						text: "帮我查一下考试安排",
					},
					{
						conversationId: "conv_created",
						createdAt: "2026-06-24T01:00:02.000Z",
						id: "msg_cancelled",
						kind: "error",
						requestId: "req_01",
						retryable: false,
						role: "assistant",
						text: "The request was cancelled.",
					},
				],
				sequence: 2,
			});
		});

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
				content: [{ text: "帮我查一下考试安排", type: "text" }],
			});
			await submitPromise;
		});

		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		expect(readMessageText("msg_cancelled")).toBe("已取消本次回答。");
		const cancelledMessage = assistantUiMock.externalStoreInput?.messages.find(
			(message) =>
				typeof message === "object" &&
				message !== null &&
				"id" in message &&
				message.id === "msg_cancelled",
		) as { metadata?: { custom?: { campusMessage?: Record<string, unknown> } } };
		expect(cancelledMessage.metadata?.custom?.campusMessage).toMatchObject({
			errorCode: "execution_cancelled",
			kind: "error",
			requestId: "req_01",
			retryable: false,
		});
	});
	it("continues rendering when cancellation fails", async () => {
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
					sequence: 1,
					status: "accepted",
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
					sequence: 2,
					status: "streaming",
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
					sequence: 3,
					status: "streaming",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			markVisibleDeltaConsumed();
			await new Promise<void>((resolve) => {
				releaseStream = resolve;
			});
			yield cancellationTerminalEvent({ sequence: 4 });
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
		expect(readAssistantText()).toBe("");
		await act(async () => {
			rejectCancellation(new Error("cancel transport failed"));
			await cancellationPromise;
		});

		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);
		expect(readAssistantText()).toBe("取消期间累计的回答");
		expect(conversationApiMock.cancelRun).toHaveBeenNthCalledWith(1, "req_01");

		await act(async () => {
			releaseVisibleDelta();
			await visibleDeltaConsumed;
			await vi.advanceTimersByTimeAsync(16);
		});
		expect(readAssistantText()).toBe("取消期间累计的回答，恢复后继续。");
		expect(observedSignal?.aborted).toBe(false);
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(true);

		releaseStream();
		await act(async () => {
			await submitPromise;
		});
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
		vi.useRealTimers();
	});

	it("abandons the run locally when stop is requested again after a failed cancellation", async () => {
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
					sequence: 1,
					status: "accepted",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseSuppressedDelta = resolve;
			});
			yield {
				data: {
					delta: "取消失败后的部分回答",
					messageId: "msg_cancel_abandon",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_01",
					sequence: 2,
					status: "streaming",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			markSuppressedDeltaConsumed();
			await new Promise<void>((resolve) => {
				releaseStream = resolve;
			});
			yield cancellationTerminalEvent({ sequence: 3 });
		});
		conversationApiMock.cancelRun.mockImplementation(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectCancellation = reject;
				}),
		);

		try {
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
			await act(async () => {
				rejectCancellation(new Error("cancel transport failed"));
				await cancellationPromise;
			});
			expect(conversationApiMock.cancelRun).toHaveBeenNthCalledWith(1, "req_01");
			expect(readMessageText("local-error-req_01")).toBe("取消请求失败，当前回答仍在继续。");

			await act(async () => {
				await assistantUiMock.externalStoreInput?.onCancel();
			});

			expect(conversationApiMock.cancelRun).toHaveBeenCalledTimes(1);
			expect(observedSignal?.aborted).toBe(true);
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(readAssistantText()).toBe("取消失败后的部分回答");

			releaseStream();
			await act(async () => {
				await submitPromise;
			});
			expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);
			expect(readAssistantText()).toBe("取消失败后的部分回答");
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps a terminal result when it wins the race with cancellation confirmation", async () => {
		let observedSignal: AbortSignal | undefined;
		let releaseTerminal: () => void = () => {
			throw new Error("terminal release was not initialized");
		};
		let resolveCancellation: (status: ChatRunStatus) => void = () => {
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
					sequence: 1,
					status: "accepted",
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
					sequence: 2,
					status: "streaming",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
			yield completedTerminalEvent("自然完成的完整答案。");
		});
		conversationApiMock.cancelRun.mockImplementation(
			() =>
				new Promise<ChatRunStatus>((resolve) => {
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
			resolveCancellation(runningCancellationStatus());
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
					sequence: 1,
					status: "accepted",
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
					sequence: 2,
					status: "failed",
				},
				event: "request.failed",
			} satisfies ChatRequestStreamEvent;
		});
		conversationApiMock.cancelRun.mockRejectedValue(
			new ChatStreamRequestError({
				code: "request_already_terminal",
				message: "Request is already terminal.",
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
					sequence: 1,
					status: "accepted",
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
					sequence: 2,
					status: "failed",
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
					sequence: 1,
					status: "accepted",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseTerminal = resolve;
			});
			yield cancellationTerminalEvent();
		});
		conversationApiMock.cancelRun.mockResolvedValue(runningCancellationStatus());

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

		expect(conversationApiMock.cancelRun).toHaveBeenCalledWith("req_01");
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
					sequence: 1,
					status: "accepted",
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
					sequence: 2,
					status: "failed",
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

		expect(conversationApiMock.cancelRun).toHaveBeenCalledWith("req_01");
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
});
