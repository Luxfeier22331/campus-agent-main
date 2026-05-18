// @vitest-environment node

import { describe, expect, it } from "vitest";

import { assertExpectedChatE2eResultKind } from "../scripts/chat-e2e.result-kind";

describe("chat e2e result kind gate", () => {
	it("allows the expected answer result kind", () => {
		expect(() =>
			assertExpectedChatE2eResultKind({
				actual: "answer",
				expected: "answer",
				requestId: "req_answer",
				traceId: "trace_answer",
			}),
		).not.toThrow();
	});

	it("fails closed when a live request returns an error result kind", () => {
		expect(() =>
			assertExpectedChatE2eResultKind({
				actual: "error",
				expected: "answer",
				requestId: "req_error",
				traceId: "trace_error",
			}),
		).toThrow(
			"Expected chat e2e result kind answer, got error (requestId=req_error traceId=trace_error).",
		);
	});

	it("allows typed outcomes only when explicitly configured as a transport smoke", () => {
		expect(() =>
			assertExpectedChatE2eResultKind({
				actual: "error",
				expected: "any",
				requestId: "req_any",
				traceId: "trace_any",
			}),
		).not.toThrow();
	});
});
