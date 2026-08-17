import { describe, expect, it } from "vitest";
import {
	isTerminalRunStatus,
	nextResumeDelay,
	RESUME_MAX_DELAY_MS,
	streamRecoveryExhausted,
} from "../src/features/conversation/assistant-ui-recovery-policy";

describe("assistant-ui recovery policy", () => {
	it.each(["completed", "failed", "canceled", "expired"] as const)(
		"treats %s as terminal",
		(phase) => {
			expect(
				isTerminalRunStatus({
					conversationId: "conv_01",
					phase,
					requestId: "req_01",
					runId: "run_01",
					status: phase,
					traceId: "trace_01",
				}),
			).toBe(true);
		},
	);

	it("caps exponential resume delay", () => {
		expect(nextResumeDelay(250)).toBe(500);
		expect(nextResumeDelay(RESUME_MAX_DELAY_MS)).toBe(RESUME_MAX_DELAY_MS);
	});

	it("preserves request identity in exhausted recovery errors", () => {
		expect(streamRecoveryExhausted({ requestId: "req_01", traceId: "trace_01" })).toMatchObject({
			code: "chat_stream_connection_lost",
			requestId: "req_01",
			retryable: true,
			traceId: "trace_01",
		});
	});
});
