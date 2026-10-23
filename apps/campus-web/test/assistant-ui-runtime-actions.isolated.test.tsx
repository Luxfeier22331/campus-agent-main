import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCampusAssistantRuntimeHook } from "../src/features/conversation/assistant-ui-runtime";
import type {
	ChatRequestStreamEvent,
	ConversationDetail,
} from "../src/features/conversation/model";

const assistantUiMock = vi.hoisted(() => ({
	externalStoreInput: null as null | {
		isRunning: boolean;
		messages: unknown[];
		onCancel: () => Promise<void>;
		setMessages?: (messages: readonly unknown[]) => void;
		onEdit?: (message: {
			content: { text: string; type: "text" }[];
			parentId?: string;
			sourceId?: string | null;
		}) => Promise<void>;
		onNew: (message: { content: { text: string; type: "text" }[] }) => Promise<void>;
		onReload?: (parentId: string | null) => Promise<void>;
	},
	initialize: vi.fn(),
	remoteId: undefined as string | undefined,
}));

const conversationApiMock = vi.hoisted(() => ({
	cancelRun: vi.fn(),
	ChatStreamRequestError: class ChatStreamRequestError extends Error {
		code: string;
		requestId: string | undefined;
		retryable: boolean;

		constructor(input: {
			code: string;
			message: string;
			requestId?: string;
			retryable: boolean;
		}) {
			super(input.message);
			this.name = "ChatStreamRequestError";
			this.code = input.code;
			this.requestId = input.requestId;
			this.retryable = input.retryable;
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
	}),
	useAuiState: (
		selector: (state: { threadListItem: { remoteId?: string | undefined } }) => unknown,
	) => selector({ threadListItem: { remoteId: assistantUiMock.remoteId } }),
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

function historicalConversation(input: {
	answerId?: string;
	answerText?: string;
	userText?: string;
}): ConversationDetail {
	const userText = input.userText ?? "原问题";
	const answerText = input.answerText ?? "原回答";
	return {
		archivedAt: null,
		activeRequestId: null,
		createdAt: "2026-06-24T01:00:00.000Z",
		id: "conv_history",
		messages: [
			{
				conversationId: "conv_history",
				createdAt: "2026-06-24T01:00:01.000Z",
				id: "msg_user",
				kind: null,
				requestId: "req_01",
				retryable: null,
				role: "user",
				structuredParts: [],
				text: userText,
			},
			{
				conversationId: "conv_history",
				createdAt: "2026-06-24T01:00:02.000Z",
				id: input.answerId ?? "msg_answer",
				kind: "answer",
				requestId: "req_01",
				retryable: null,
				role: "assistant",
				structuredParts: [],
				text: answerText,
			},
		],
		pinnedAt: null,
		title: "历史对话",
		updatedAt: "2026-06-24T01:00:02.000Z",
	};
}

function completedConversationEvent(input: {
	answerId: string;
	answerText: string;
	requestId: string;
	userText: string;
}): ChatRequestStreamEvent {
	return {
		data: {
			answer: {
				conversation: historicalConversation({
					answerId: input.answerId,
					answerText: input.answerText,
					userText: input.userText,
				}),
				result: {
					kind: "answer",
					requestId: input.requestId,
					text: input.answerText,
				},
			},
			occurredAt: "2026-06-24T01:00:02.000Z",
			requestId: input.requestId,
			sequence: 2,
			status: "completed",
		},
		event: "request.completed",
	};
}

describe("assistant-ui runtime message actions", () => {
	beforeEach(() => {
		assistantUiMock.externalStoreInput = null;
		assistantUiMock.remoteId = "conv_history";
		assistantUiMock.initialize.mockReset();
		assistantUiMock.initialize.mockResolvedValue({ remoteId: "conv_created" });
		conversationApiMock.cancelRun.mockReset();
		conversationApiMock.deleteTrailingMessages.mockReset();
		conversationApiMock.getConversationDetail.mockReset();
		conversationApiMock.getConversationDetail.mockResolvedValue(historicalConversation({}));
		conversationApiMock.getRunStatus.mockReset();
		conversationApiMock.getRunStatus.mockResolvedValue({
			conversationId: "conv_history",
			phase: "running",
			requestId: "req_01",
			status: "running",
		});
		conversationApiMock.resumeRunEventsStream.mockReset();
		conversationApiMock.submitChatRequestStream.mockReset();
	});

	it("edits a historical user message by deleting the tail and streaming the edited prompt", async () => {
		conversationApiMock.deleteTrailingMessages.mockResolvedValue(undefined);
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				completedConversationEvent({
					answerId: "msg_answer_new",
					answerText: "编辑后的回答",
					requestId: "req_02",
					userText: "编辑后的问题",
				}),
			]),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		await waitFor(() =>
			expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith(
				"conv_history",
				expect.any(AbortSignal),
			),
		);

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onEdit?.({
				content: [{ text: " 编辑后的问题 ", type: "text" }],
				sourceId: "msg_user",
			});
		});

		expect(conversationApiMock.deleteTrailingMessages).toHaveBeenCalledWith({
			conversationId: "conv_history",
			messageId: "msg_user",
		});
		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledWith({
			conversationId: "conv_history",
			idempotencyKey: expect.any(String),
			prompt: "编辑后的问题",
			signal: expect.any(AbortSignal),
		});
		await waitFor(() =>
			expect(assistantUiMock.externalStoreInput?.messages).toEqual([
				expect.objectContaining({ id: "msg_user", role: "user" }),
				expect.objectContaining({ id: "msg_answer_new", role: "assistant" }),
			]),
		);
	});

	it("reloads an assistant answer from the preceding user message", async () => {
		conversationApiMock.deleteTrailingMessages.mockResolvedValue(undefined);
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				completedConversationEvent({
					answerId: "msg_answer_new",
					answerText: "重新生成回答",
					requestId: "req_02",
					userText: "原问题",
				}),
			]),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		await waitFor(() =>
			expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith(
				"conv_history",
				expect.any(AbortSignal),
			),
		);

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onReload?.("msg_user");
		});

		expect(conversationApiMock.deleteTrailingMessages).toHaveBeenCalledWith({
			conversationId: "conv_history",
			messageId: "msg_user",
		});
		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledWith({
			conversationId: "conv_history",
			idempotencyKey: expect.any(String),
			prompt: "原问题",
			signal: expect.any(AbortSignal),
		});
	});

	it("ignores reload requests whose parent message only exists in local state", async () => {
		render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		await waitFor(() =>
			expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith(
				"conv_history",
				expect.any(AbortSignal),
			),
		);

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onReload?.("local-user-01");
		});

		expect(conversationApiMock.deleteTrailingMessages).not.toHaveBeenCalled();
		expect(conversationApiMock.submitChatRequestStream).not.toHaveBeenCalled();
	});

	it("retries a failed answer from a local user message without deleting server-side history", async () => {
		conversationApiMock.submitChatRequestStream.mockImplementation(() =>
			streamEvents([
				completedConversationEvent({
					answerId: "msg_answer_new",
					answerText: "重试后的回答",
					requestId: "req_02",
					userText: "失败后重试",
				}),
			]),
		);

		render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		await waitFor(() =>
			expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith(
				"conv_history",
				expect.any(AbortSignal),
			),
		);

		await act(async () => {
			assistantUiMock.externalStoreInput?.setMessages?.([
				{
					content: [{ text: "失败后重试", type: "text" }],
					id: "local-user-01",
					role: "user",
				},
				{
					content: [{ text: "回答失败，请稍后重试。", type: "text" }],
					id: "local-error-req_01",
					metadata: {
						custom: {
							campusMessage: { kind: "error", requestId: "req_01", retryable: false },
						},
					},
					role: "assistant",
				},
			]);
		});

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onReload?.("local-user-01");
		});

		expect(conversationApiMock.deleteTrailingMessages).not.toHaveBeenCalled();
		expect(conversationApiMock.submitChatRequestStream).toHaveBeenCalledWith({
			conversationId: "conv_history",
			idempotencyKey: expect.any(String),
			prompt: "失败后重试",
			signal: expect.any(AbortSignal),
		});
	});

	it("ignores edit requests whose parent message only exists in local state", async () => {
		render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		await waitFor(() =>
			expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith(
				"conv_history",
				expect.any(AbortSignal),
			),
		);

		await act(async () => {
			await assistantUiMock.externalStoreInput?.onEdit?.({
				content: [{ text: "失败后重试", type: "text" }],
				parentId: "local-user-01",
			});
		});

		expect(conversationApiMock.deleteTrailingMessages).not.toHaveBeenCalled();
		expect(conversationApiMock.submitChatRequestStream).not.toHaveBeenCalled();
	});

	it("applies messages supplied by assistant-ui when switching branches", async () => {
		render(<RuntimeProbe onLoginRequired={vi.fn()} />);
		await waitFor(() =>
			expect(conversationApiMock.getConversationDetail).toHaveBeenCalledWith(
				"conv_history",
				expect.any(AbortSignal),
			),
		);

		const branchMessages = [
			{ content: [{ text: "分支问题", type: "text" }], id: "branch-user", role: "user" },
			{
				content: [{ text: "分支回答", type: "text" }],
				id: "branch-answer",
				role: "assistant",
			},
		] as const;

		await act(async () => {
			assistantUiMock.externalStoreInput?.setMessages?.(branchMessages);
		});

		expect(assistantUiMock.externalStoreInput?.messages).toEqual(branchMessages);
	});
});
