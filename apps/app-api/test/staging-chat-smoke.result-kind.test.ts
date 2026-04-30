// @vitest-environment node

import { describe, expect, it } from "vitest";

import { assertExpectedStagingChatSmokeResultKind } from "../scripts/staging-chat-smoke.result-kind";

describe("staging chat smoke result kind gate", () => {
	it("allows the expected answer result kind", () => {
		expect(() =>
			assertExpectedStagingChatSmokeResultKind({
				actual: "answer",
				expected: "answer",
				requestId: "req_answer",
				traceId: "trace_answer",
			}),
		).not.toThrow();
	});

	it("fails closed when a live smoke request returns an error result kind", () => {
		expect(() =>
			assertExpectedStagingChatSmokeResultKind({
				actual: "error",
				expected: "answer",
				requestId: "req_error",
				traceId: "trace_error",
			}),
		).toThrow(
			"Expected staging chat smoke result kind answer, got error (requestId=req_error traceId=trace_error).",
		);
	});

	it("allows typed outcomes only when explicitly configured as a transport smoke", () => {
		expect(() =>
			assertExpectedStagingChatSmokeResultKind({
				actual: "error",
				expected: "any",
				requestId: "req_any",
				traceId: "trace_any",
			}),
		).not.toThrow();
	});
});
