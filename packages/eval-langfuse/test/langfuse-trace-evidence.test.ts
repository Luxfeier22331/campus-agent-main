import type { LangfuseClient } from "@langfuse/client";
import { describe, expect, it } from "vitest";

import { verifyLangfuseOnlineTraceEvidence } from "../src/trace-evidence";

const settings = {
	baseUrl: "https://langfuse.example",
	publicKey: "pk-test",
	secretKey: "sk-test",
} as const;

function tracePayload(overrides: { requestId?: string; tags?: string[] } = {}) {
	return {
		id: "trace-001",
		name: "online-answer",
		release: "agent-runtime@abc123",
		sessionId: "conversation-001",
		tags: overrides.tags ?? ["surface:agent-runtime", "env:staging"],
		userId: "user-001",
		metadata: {
			request_id: overrides.requestId ?? "request-001",
			run_id: "run-001",
			trace_id: "trace-product-001",
			turn_id: "turn-001",
		},
		observations: [
			{
				id: "observation-001",
				metadata: {
					request_id: overrides.requestId ?? "request-001",
					run_id: "run-001",
					trace_id: "trace-product-001",
					turn_id: "turn-001",
				},
			},
		],
	};
}

function clientFor(payload: unknown): LangfuseClient {
	return {
		api: { trace: { get: async () => payload } },
	} as unknown as LangfuseClient;
}

describe("Langfuse trace evidence", () => {
	it("checks runtime identity through the official SDK client", async () => {
		const evidence = await verifyLangfuseOnlineTraceEvidence({
			client: clientFor(tracePayload()),
			expectedRelease: "agent-runtime@abc123",
			expectedRequestId: "request-001",
			expectedRunId: "run-001",
			expectedSessionId: "conversation-001",
			expectedTags: ["surface:agent-runtime", "env:staging"],
			expectedUserId: "user-001",
			settings,
			traceId: "trace-001",
		});

		expect(evidence).toMatchObject({
			observation_count: 1,
			release: "agent-runtime@abc123",
			trace_id: "trace-001",
		});
		expect(evidence.trace_identity).toEqual({
			request_id: "request-001",
			run_id: "run-001",
			trace_id: "trace-product-001",
			turn_id: "turn-001",
		});
	});

	it("rejects identity drift instead of accepting a partially matching trace", async () => {
		await expect(
			verifyLangfuseOnlineTraceEvidence({
				client: clientFor(tracePayload({ requestId: "request-other" })),
				expectedRelease: "agent-runtime@abc123",
				expectedRequestId: "request-001",
				expectedRunId: "run-001",
				expectedSessionId: "conversation-001",
				expectedTags: [],
				expectedUserId: "user-001",
				settings,
				traceId: "trace-001",
			}),
		).rejects.toThrow("trace evidence request_id mismatch");
	});
});
