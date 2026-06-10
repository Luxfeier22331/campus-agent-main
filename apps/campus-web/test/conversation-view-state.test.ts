import { describe, expect, it } from "vitest";
import type { ConversationDetail } from "../src/features/conversation/model";
import {
	applyConversationStreamEvent,
	beginConversationRequest,
} from "../src/features/conversation/view-state";

const baseConversation: ConversationDetail = {
	archivedAt: null,
	createdAt: "2026-06-09T00:00:00.000Z",
	id: "conv_01",
	messages: [],
	pinnedAt: null,
	title: "奖学金",
	updatedAt: "2026-06-09T00:00:00.000Z",
};

describe("conversation view state", () => {
	it("adds optimistic user and pending assistant messages when a request starts", () => {
		const state = beginConversationRequest({
			conversation: baseConversation,
			createdAt: "2026-06-09T00:00:01.000Z",
			prompt: "奖学金怎么申请？",
			requestKey: "local_01",
		});

		expect(state.conversation.messages).toMatchObject([
			{ id: "local_01:user", role: "user", text: "奖学金怎么申请？" },
			{ id: "local_01:assistant", role: "assistant", text: "正在连接校园助手。" },
		]);
		expect(state.activeRequest?.statusLabel).toBe("正在连接校园助手。");
	});

	it("updates the pending assistant card from lifecycle stream events", () => {
		const started = beginConversationRequest({
			conversation: baseConversation,
			createdAt: "2026-06-09T00:00:01.000Z",
			prompt: "奖学金怎么申请？",
			requestKey: "local_01",
		});

		const running = applyConversationStreamEvent(started, {
			data: {
				occurredAt: "2026-06-09T00:00:02.000Z",
				requestId: "req_01",
				status: "running",
				traceId: "trace_01",
			},
			event: "execution.running",
		});

		expect(running.activeRequest?.requestId).toBe("req_01");
		expect(running.activeRequest?.statusLabel).toBe("正在处理");
		expect(running.conversation.messages.at(-1)?.text).toBe("正在处理");
	});

	it("replaces the pending assistant card with completed answer payloads", () => {
		const started = beginConversationRequest({
			conversation: baseConversation,
			createdAt: "2026-06-09T00:00:01.000Z",
			prompt: "奖学金怎么申请？",
			requestKey: "local_01",
		});

		const completed = applyConversationStreamEvent(started, {
			data: {
				answer: {
					conversation: {
						...baseConversation,
						messages: [],
					},
					result: {
						kind: "clarification",
						requestId: "req_01",
						text: "需要补充你所在年级。",
						traceId: "trace_01",
					},
				},
				occurredAt: "2026-06-09T00:00:03.000Z",
				requestId: "req_01",
				status: "completed",
				traceId: "trace_01",
			},
			event: "request.completed",
		});

		expect(completed.activeRequest).toBeNull();
		expect(completed.conversation.messages).toMatchObject([
			{ role: "user", text: "奖学金怎么申请？" },
			{ kind: "clarification", role: "assistant", text: "需要补充你所在年级。" },
		]);
	});

	it("turns failed lifecycle events into retryable assistant error cards", () => {
		const started = beginConversationRequest({
			conversation: baseConversation,
			createdAt: "2026-06-09T00:00:01.000Z",
			prompt: "奖学金怎么申请？",
			requestKey: "local_01",
		});

		const failed = applyConversationStreamEvent(started, {
			data: {
				error: {
					code: "runtime_unavailable",
					message: "执行服务暂不可用。",
					retryable: true,
				},
				occurredAt: "2026-06-09T00:00:03.000Z",
				requestId: "req_01",
				status: "failed",
				traceId: "trace_01",
			},
			event: "request.failed",
		});

		expect(failed.activeRequest).toMatchObject({
			errorMessage: "回答暂时没有生成，请稍后再试。",
			retryable: true,
			statusLabel: "请求失败",
		});
		expect(failed.conversation.messages.at(-1)).toMatchObject({
			kind: "error",
			retryable: true,
			text: "回答暂时没有生成，请稍后再试。",
		});
		expect(failed.activeRequest?.errorMessage).not.toBe("执行服务暂不可用。");
	});
});
