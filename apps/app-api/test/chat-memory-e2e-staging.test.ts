// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	type ChatMemoryE2eStagingDependencies,
	runChatMemoryE2eStaging,
} from "../scripts/chat-memory-e2e-staging";

function jsonResult<T>(
	payload: T,
	response = new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json" },
	}),
): { payload: T; response: Response } {
	return {
		payload,
		response,
	};
}

function sseResponse(blocks: string[]): Response {
	return new Response(blocks.join(""), {
		headers: { "content-type": "text/event-stream" },
		status: 200,
	});
}

describe("chat memory staging e2e runner", () => {
	it("proves explicit memory write and Temporal memory recall through sanitized run steps", async () => {
		const calls: Array<{ body?: unknown; method?: string; url: string }> = [];
		const result = await runChatMemoryE2eStaging(
			[
				"--chat-base-url",
				"https://campus.example.com",
				"--app-api-readyz-url",
				"https://api.example.com/readyz",
			],
			{
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv,
			{
				async fetchReadyz(url) {
					calls.push({ url });
					return {
						payload: { ok: true },
						status: 200,
					};
				},
				async fetchJsonWithCookie<T>(
					input: Parameters<
						NonNullable<ChatMemoryE2eStagingDependencies["fetchJsonWithCookie"]>
					>[0],
				) {
					calls.push({ body: input.body, method: input.method, url: input.url });
					if (input.url.endsWith("/api/me")) {
						return jsonResult({
							permissions: {
								chat: true,
								operator: false,
							},
							principal: {
								email: "help_bot@outlook.com",
								principalId: "user_staging",
								type: "user",
							},
							session: {
								expiresAt: "2099-01-01T00:00:00Z",
								sessionId: "session_staging",
							},
						} as T);
					}
					if (input.url.endsWith("/api/me/profile-memory")) {
						return jsonResult({
							profileMemory: {
								enabled: true,
								items: [],
							},
						} as T);
					}
					if (input.url.endsWith("/api/me/profile-memory/items") && input.method === "POST") {
						return jsonResult({
							item: {
								confidence: "low",
								itemId: "mem_01HQ",
								key: "smoke_memory_probe",
								lastVerifiedAt: "2026-06-04T00:00:00.000Z",
								sourceType: "user_declared",
								updatedAt: "2026-06-04T00:00:00.000Z",
								value: "smoke memory sentinel",
								visibility: "user_visible",
							},
						} as T);
					}
					if (input.url.endsWith("/api/chat/runs/run_01HQ/steps")) {
						return jsonResult({
							attempts: [],
							results: [
								{
									attemptId: "attempt-memory",
									createdAt: "2026-06-04T01:02:05.000Z",
									payloadSchemaVersion: "step-result-projection-v1",
									projectionRef: "projection://runs/run_01HQ/memory/recall",
									resultId: "result-memory",
									resultKind: "memory_recall_result",
									runId: "run_01HQ",
									sanitizedPayload: {
										memory_ref: "projection://runs/run_01HQ/memory/recall",
										selected_memory_count: 1,
									},
									status: "completed",
									stepId: "memory.recall",
								},
							],
							run: {
								conversationId: "conv_01HQ",
								phase: "completed",
								requestId: "req_01HQ",
								runId: "run_01HQ",
								status: "completed",
								traceId: "trace_01HQ",
							},
							steps: [
								{
									capability: "any",
									completedAt: "2026-06-04T01:02:05.000Z",
									conversationId: "conv_01HQ",
									parentStepId: "",
									payloadSchemaVersion: "run-step-projection-v1",
									runId: "run_01HQ",
									sanitizedPayload: {
										memory_ref: "projection://runs/run_01HQ/memory/recall",
										selected_memory_count: 1,
									},
									startedAt: "2026-06-04T01:02:04.000Z",
									status: "completed",
									stepId: "memory.recall",
									stepKind: "memory",
									taskQueue: "context",
									updatedAt: "2026-06-04T01:02:05.000Z",
									workerId: "test-worker",
								},
							],
						} as T);
					}
					if (
						input.url.endsWith("/api/me/profile-memory/items/mem_01HQ") &&
						input.method === "DELETE"
					) {
						return jsonResult({ deleted: true } as T);
					}
					throw new Error(`unexpected json request: ${input.url}`);
				},
				async mintSmokeSession() {
					return "session=staging";
				},
				async openSubmitStream(input) {
					calls.push({ body: input.body, method: "POST", url: input.url });
					return sseResponse([
						'event: request.accepted\ndata: {"occurredAt":"2026-06-04T00:00:00.000Z","requestId":"req_01HQ","runId":"run_01HQ","status":"accepted","traceId":"trace_01HQ"}\n\n',
						'event: request.completed\ndata: {"occurredAt":"2026-06-04T00:00:02.000Z","requestId":"req_01HQ","status":"completed","traceId":"trace_01HQ","answer":{"conversation":{"id":"conv_01HQ"},"result":{"kind":"answer","requestId":"req_01HQ","traceId":"trace_01HQ"}}}\n\n',
					]);
				},
			},
		);

		expect(result.passed).toBe(true);
		expect(result.memory.itemId).toBe("mem_01HQ");
		expect(result.memory.deleted).toBe(true);
		expect(result.submit).toEqual({
			requestId: "req_01HQ",
			resultKind: "answer",
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
		expect(result.recall).toEqual({
			memoryRef: "projection://runs/run_01HQ/memory/recall",
			selectedMemoryCount: 1,
			stepId: "memory.recall",
			status: "completed",
		});
		expect(calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					body: {
						key: "smoke_memory_probe",
						value: expect.stringContaining("smoke memory sentinel"),
					},
					method: "POST",
					url: "https://campus.example.com/api/me/profile-memory/items",
				}),
				expect.objectContaining({
					method: "POST",
					url: "https://campus.example.com/api/chat/requests/stream",
				}),
				{
					method: "GET",
					url: "https://campus.example.com/api/chat/runs/run_01HQ/steps",
				},
				{
					method: "DELETE",
					url: "https://campus.example.com/api/me/profile-memory/items/mem_01HQ",
				},
			]),
		);
	});
});
