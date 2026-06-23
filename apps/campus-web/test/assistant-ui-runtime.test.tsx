import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCampusAssistantRuntimeHook } from "../src/features/conversation/assistant-ui-runtime";
import type { ChatRequestStreamEvent } from "../src/features/conversation/model";

const assistantUiMock = vi.hoisted(() => ({
	externalStoreInput: null as null | {
		isRunning: boolean;
		messages: unknown[];
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
	}
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
		conversationApiMock.submitChatRequestStream.mockImplementation((input) =>
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
});
