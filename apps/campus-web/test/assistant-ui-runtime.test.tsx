import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCampusAssistantRuntimeHook } from "../src/features/conversation/assistant-ui-runtime";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";

const assistantUiMock = vi.hoisted(() => ({
	externalStoreInput: null as null | {
		isRunning: boolean;
		messages: unknown[];
		onCancel: () => Promise<void>;
		onNew: (message: { content: { text: string; type: "text" }[] }) => Promise<void>;
	},
	initialize: vi.fn(),
	remoteId: undefined as string | undefined,
}));

const conversationApiMock = vi.hoisted(() => ({
	cancelRun: vi.fn(),
	getConversationDetail: vi.fn(),
	resumeRunEventsStream: vi.fn(),
	submitChatRequestStream: vi.fn(),
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

function RuntimeProbe({ onLoginRequired }: { onLoginRequired: () => void }) {
	const useRuntime = createCampusAssistantRuntimeHook({ onLoginRequired });
	useRuntime();
	return null;
}

async function* streamEvents(events: ChatRequestStreamEvent[]) {
	for (const event of events) {
		yield event;
		await Promise.resolve();
	}
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

describe("assistant-ui runtime lifecycle bridge", () => {
	beforeEach(() => {
		assistantUiMock.externalStoreInput = null;
		assistantUiMock.remoteId = undefined;
		assistantUiMock.initialize.mockReset();
		assistantUiMock.initialize.mockResolvedValue({ remoteId: "conv_created" });
		conversationApiMock.cancelRun.mockReset();
		conversationApiMock.getConversationDetail.mockReset();
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
					accumulatedText: finalAnswer,
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
				await Promise.resolve();
				await Promise.resolve();
			});

			expect(readAssistantText().length).toBeLessThan(finalAnswer.length);

			await act(async () => {
				vi.runAllTimers();
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

	it("aborts the active stream and requests durable run cancellation", async () => {
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

		expect(observedSignal?.aborted).toBe(true);
		expect(conversationApiMock.cancelRun).toHaveBeenCalledWith("run_01");
		expect(assistantUiMock.externalStoreInput?.isRunning).toBe(false);

		releaseStream();
		await act(async () => {
			await submitPromise;
		});
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
					accumulatedText: finalAnswer,
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
