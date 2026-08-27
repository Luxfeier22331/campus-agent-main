import { describe, expect, it } from "vitest";
import { ChatStreamRequestError } from "../src/features/conversation/api";

import {
	isPersistedConversationMessageId,
	isStreamRecoveryExhausted,
	isTerminalRunStatus,
	nextResumeDelay,
	RESUME_MAX_DELAY_MS,
	streamRecoveryExhausted,
} from "../src/features/conversation/assistant-ui-recovery-policy";

describe("assistant-ui recovery policy", () => {
	it("only enables destructive message actions for persisted ids", () => {
		expect(isPersistedConversationMessageId("msg_user_01")).toBe(true);
		expect(isPersistedConversationMessageId("local-user-01")).toBe(false);
		expect(isPersistedConversationMessageId("local-error-01")).toBe(false);
		expect(isPersistedConversationMessageId(null)).toBe(false);
	});

	it("identifies exhausted recovery without treating other stream errors as recoverable state", () => {
		expect(
			isStreamRecoveryExhausted(
				new ChatStreamRequestError({
					code: "chat_stream_connection_lost",
					message: "连接已中断。",
					retryable: true,
				}),
			),
		).toBe(true);
		expect(
			isStreamRecoveryExhausted(
				new ChatStreamRequestError({
					code: "execution_failed",
					message: "执行失败。",
					retryable: false,
				}),
			),
		).toBe(false);
	});

	it.each(["completed", "failed", "canceled", "expired"] as const)(
		"treats %s as terminal",
		(phase) => {
			expect(
				isTerminalRunStatus({
					acceptedAt: "2026-06-24T01:00:00.000Z",
					completedAt: "2026-06-24T01:00:02.000Z",
					conversationId: "conv_01",
					durationMs: 2_000,
					phase,
					requestId: "req_01",
					startedAt: "2026-06-24T01:00:01.000Z",
					status: phase,
				}),
			).toBe(true);
		},
	);

	it("caps exponential resume delay", () => {
		expect(nextResumeDelay(250)).toBe(500);
		expect(nextResumeDelay(RESUME_MAX_DELAY_MS)).toBe(RESUME_MAX_DELAY_MS);
	});

	it("preserves request identity in exhausted recovery errors", () => {
		expect(streamRecoveryExhausted({ requestId: "req_01" })).toMatchObject({
			code: "chat_stream_connection_lost",
			requestId: "req_01",
			retryable: true,
		});
	});
});
