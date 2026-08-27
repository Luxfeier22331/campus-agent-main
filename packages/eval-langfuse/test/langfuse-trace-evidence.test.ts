import type { LangfuseClient } from "@langfuse/client";
import { describe, expect, it } from "vitest";

import { verifyLangfuseOnlineTraceEvidence } from "../src/trace-evidence";

const settings = {
	baseUrl: "https://langfuse.example",
	publicKey: "pk-test",
	secretKey: "sk-test",
} as const;

function tracePayload(overrides: { requestId?: string } = {}) {
	return {
		id: "trace-001",
		metadata: { request_id: overrides.requestId ?? "request-001" },
		observations: [
			{
				id: "observation-001",
				metadata: { request_id: overrides.requestId ?? "request-001" },
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
			expectedRequestId: "request-001",
			settings,
			traceId: "trace-001",
		});

		expect(evidence).toMatchObject({
			observation_count: 1,
			request_id: "request-001",
			trace_id: "trace-001",
		});
	});

	it("rejects identity drift instead of accepting a partially matching trace", async () => {
		await expect(
			verifyLangfuseOnlineTraceEvidence({
				client: clientFor(tracePayload({ requestId: "request-other" })),
				expectedRequestId: "request-001",
				settings,
				traceId: "trace-001",
			}),
		).rejects.toThrow("trace metadata request_id does not match");
	});
});
