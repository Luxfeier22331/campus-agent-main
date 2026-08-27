import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";
import {
	assistantUiTestState as assistantUiMock,
	conversationApiTestMock as conversationApiMock,
	hasMessageId,
	installAssistantUiRuntimeTestHarness,
	RuntimeProbe,
	readAssistantText,
	streamEvents,
} from "./assistant-ui-runtime.test-support";

describe("assistant-ui runtime initialization and thread ownership", () => {
	installAssistantUiRuntimeTestHarness();

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
						sequence: 1,
						status: "failed",
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
			expect.objectContaining({
				metadata: expect.objectContaining({
					custom: {
						campusRequest: expect.objectContaining({ provisional: true, status: "queued" }),
					},
				}),
				role: "assistant",
			}),
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
						sequence: 1,
						status: "failed",
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
			expect.objectContaining({
				metadata: expect.objectContaining({
					custom: {
						campusRequest: expect.objectContaining({ provisional: true, status: "queued" }),
					},
				}),
				role: "assistant",
			}),
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
					sequence: 1,
					status: "accepted",
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
					sequence: 2,
					status: "failed",
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
			markDeltaConsumed();
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
		let streamSignal: AbortSignal | undefined;
		conversationApiMock.submitChatRequestStream.mockImplementation(async function* (input) {
			streamSignal = input.signal;
			yield {
				data: {
					occurredAt: "2026-06-24T01:00:00.000Z",
					requestId: "req_switch_back",
					sequence: 1,
					status: "accepted",
				},
				event: "request.accepted",
			} satisfies ChatRequestStreamEvent;
			await new Promise<void>((resolve) => {
				releaseStream = resolve;
			});
			yield {
				data: {
					delta: "切换后的迟到内容",
					messageId: "msg_late_switch",
					occurredAt: "2026-06-24T01:00:01.000Z",
					requestId: "req_switch_back",
					sequence: 2,
					status: "streaming",
				},
				event: "answer.delta",
			} satisfies ChatRequestStreamEvent;
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

		let submitPromise: Promise<void> | undefined;
		await act(async () => {
			submitPromise = assistantUiMock.externalStoreInput?.onNew({
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
		expect(streamSignal?.aborted).toBe(true);

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
		await act(async () => {
			await submitPromise;
		});
		expect(readAssistantText()).toBe("loaded conv_created");
		expect(hasMessageId("msg_late_switch")).toBe(false);
	});
});
