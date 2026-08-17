import { describe, expect, it } from "vitest";

import { verifyLangfuseOnlineTraceEvidence } from "../src/index";

const TEST_LANGFUSE_SETTINGS = {
	baseUrl: "https://langfuse.example",
	publicKey: "pk-test",
	secretKey: "sk-test",
} as const;

function agentObservation(input: { id?: string; metadata?: Record<string, unknown> } = {}) {
	return {
		id: input.id ?? "obs-agent-001",
		name: "Campus primary assistant",
		metadata: {
			"llm.model_name": "gpt-test",
			"openinference.span.kind": "AGENT",
			request_id: "req-001",
			run_id: "run-001",
			trace_id: "trace-product-001",
			turn_id: "turn-001",
			...(input.metadata ?? {}),
		},
	};
}

function onlineTracePayload(
	overrides: {
		metadata?: Record<string, unknown>;
		observations?: unknown[];
		release?: string;
		sessionId?: string;
		tags?: string[];
		userId?: string;
	} = {},
) {
	return {
		id: "trace-001",
		name: "online-answer",
		release: overrides.release ?? "release",
		sessionId: overrides.sessionId ?? "session",
		tags: overrides.tags ?? [],
		userId: overrides.userId ?? "user",
		metadata: {
			request_id: "req-001",
			run_id: "run-001",
			trace_id: "trace-product-001",
			turn_id: "turn-001",
			...overrides.metadata,
		},
		observations: overrides.observations ?? [agentObservation()],
	};
}

function traceFetch(payload: unknown) {
	return async () => new Response(JSON.stringify(payload));
}

describe("Langfuse trace evidence", () => {
	it("verifies sanitized runtime trace evidence", async () => {
		const evidence = await verifyLangfuseOnlineTraceEvidence({
			expectedRelease: "agent-runtime@abc123",
			expectedRequestId: "req-001",
			expectedRunId: "run-001",
			expectedSessionId: "conversation-001",
			expectedTags: ["surface:agent-runtime", "env:staging"],
			expectedUserId: "user-001",
			fetchImpl: traceFetch(
				onlineTracePayload({
					observations: [
						agentObservation({
							id: "obs-001",
							metadata: {
								"llm.model_name": "gpt-test",
								"openinference.span.kind": "LLM",
							},
						}),
					],
					release: "agent-runtime@abc123",
					sessionId: "conversation-001",
					tags: ["surface:agent-runtime", "env:staging"],
					userId: "user-001",
				}),
			),
			settings: TEST_LANGFUSE_SETTINGS,
			traceId: "trace-001",
		});

		expect(evidence.observation_count).toBe(1);
		expect(evidence.forbidden_check_passed).toBe(true);
		expect((evidence.trace_identity as { request_id: string }).request_id).toBe("req-001");
		expect((evidence.trace_identity as { turn_id: string }).turn_id).toBe("turn-001");
	});

	it("rejects raw model payload fields from every trace observation", async () => {
		await expect(
			verifyLangfuseOnlineTraceEvidence({
				expectedRelease: "release",
				expectedSessionId: "session",
				expectedTags: [],
				expectedUserId: "user",
				fetchImpl: traceFetch(
					onlineTracePayload({
						observations: [
							agentObservation(),
							{
								id: "obs-llm-debug-001",
								metadata: {
									provider_raw_response: { id: "resp_001" },
									raw_answer: "debug-only answer body",
									raw_prompt: "debug-only prompt body",
								},
							},
						],
					}),
				),
				settings: TEST_LANGFUSE_SETTINGS,
				traceId: "trace-001",
			}),
		).rejects.toThrow(
			"forbidden Langfuse payload fields: provider_raw_response, raw_answer, raw_prompt",
		);
	});

	it("rejects secrets from all trace observations", async () => {
		await expect(
			verifyLangfuseOnlineTraceEvidence({
				expectedRelease: "release",
				expectedSessionId: "session",
				expectedTags: [],
				expectedUserId: "user",
				fetchImpl: traceFetch(
					onlineTracePayload({
						observations: [
							agentObservation(),
							{
								id: "obs-llm-debug-001",
								metadata: {
									authorization: "Bearer secret",
								},
							},
						],
					}),
				),
				settings: TEST_LANGFUSE_SETTINGS,
				traceId: "trace-001",
			}),
		).rejects.toThrow("forbidden Langfuse payload fields: authorization");
	});

	it("normalizes camelCase credential field names", async () => {
		await expect(
			verifyLangfuseOnlineTraceEvidence({
				expectedRelease: "release",
				expectedSessionId: "session",
				expectedTags: [],
				expectedUserId: "user",
				fetchImpl: traceFetch(
					onlineTracePayload({
						observations: [
							agentObservation(),
							{
								id: "obs-llm-debug-001",
								metadata: { clientSecret: "secret" },
							},
						],
					}),
				),
				settings: TEST_LANGFUSE_SETTINGS,
				traceId: "trace-001",
			}),
		).rejects.toThrow("forbidden Langfuse payload fields: clientSecret");
	});
});
