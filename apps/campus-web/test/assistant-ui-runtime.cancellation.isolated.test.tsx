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
		runId: "run_01",
		startedAt: "2026-06-24T01:00:01.000Z",
		status: "running",
		traceId: "trace_01",
	};
}

describe("assistant-ui runtime cancellation and rendering races", () => {
	installAssistantUiRuntimeTestHarness();

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
							activeRunId: null,
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
		const canonical = completedTerminalEvent("测试结束。").data.answer?.conversation;
		if (!canonical) {
			throw new Error("Expected a canonical conversation fixture.");
		}
		conversationApiMock.getConversationDetail.mockResolvedValue(canonical);

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
			expect(readMessageText("msg_answer")).toBe("测试结束。");
			expect(hasMessageId("local-error-req_delta")).toBe(false);
			expect(assistantUiMock.externalStoreInput?.messages).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: "msg_answer",
						metadata: {
							custom: expect.objectContaining({
								campusRun: expect.objectContaining({ status: "failed" }),
							}),
						},
					}),
				]),
			);
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
				resolveCancellation(runningCancellationStatus());
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
		expect(conversationApiMock.cancelRun).toHaveBeenCalledWith("run_01");
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
		expect(readAssistantText()).toBe("取消期间累计的回答");
		expect(conversationApiMock.cancelRun).toHaveBeenNthCalledWith(1, "run_01");

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
});
