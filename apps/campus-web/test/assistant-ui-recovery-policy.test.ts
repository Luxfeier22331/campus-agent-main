import { describe, expect, it } from "vitest";
import {
	isPersistedConversationMessageId,
	isTerminalRunStatus,
} from "../src/features/conversation/assistant-ui-recovery-policy";

describe("assistant-ui recovery policy", () => {
	it("only enables destructive message actions for persisted ids", () => {
		expect(isPersistedConversationMessageId("msg_user_01")).toBe(true);
		expect(isPersistedConversationMessageId("local-user-01")).toBe(false);
		expect(isPersistedConversationMessageId("local-error-01")).toBe(false);
		expect(isPersistedConversationMessageId(null)).toBe(false);
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
});
