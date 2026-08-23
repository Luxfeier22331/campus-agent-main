import { afterEach, beforeEach, vi } from "vitest";

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
			sourceId?: string | null;
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
	getRunEvents: vi.fn(),
	getRunStatus: vi.fn(),
	resumeRunEventsStream: vi.fn(),
	submitChatRequestStream: vi.fn(),
}));

export const assistantUiTestState = assistantUiMock;
export const conversationApiTestMock = conversationApiMock;
export const TestChatStreamRequestError = conversationApiMock.ChatStreamRequestError;
export const TestUnauthorizedError = UnauthorizedError;

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

export function RuntimeProbe({
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

export async function* streamEvents(events: ChatRequestStreamEvent[]) {
	for (const event of events) {
		yield event;
		await Promise.resolve();
	}
}

export function cancellationTerminalEvent(): ChatRequestStreamEvent {
	return {
		data: {
			answer: {
				conversation: {
					archivedAt: null,
					activeRunId: null,
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

export function completedTerminalEvent(answerText: string): ChatRequestStreamEvent {
	return {
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

export function readAssistantText(): string {
	const message = assistantUiMock.externalStoreInput?.messages.find(
		(item): item is { content: { text: string; type: "text" }[]; role: "assistant" } =>
			typeof item === "object" &&
			item !== null &&
			"role" in item &&
			item.role === "assistant" &&
			"content" in item &&
			Array.isArray(item.content) &&
			item.content.some(
				(part) =>
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string" &&
					part.text.length > 0,
			),
	);
	return message?.content.find((part) => part.type === "text")?.text ?? "";
}

export function hasMessageId(messageId: string): boolean {
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

export function readMessageText(messageId: string): string {
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

export function installAssistantUiRuntimeTestHarness() {
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
		conversationApiMock.getRunEvents.mockReset();
		conversationApiMock.getRunStatus.mockReset();
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
		conversationApiMock.resumeRunEventsStream.mockReset();
		conversationApiMock.submitChatRequestStream.mockReset();
	});
}
