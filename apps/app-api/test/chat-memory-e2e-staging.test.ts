// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type ChatMemoryE2eStagingDependencies,
	openChatMemorySubmitStream,
	runChatMemoryE2eStaging,
} from "../e2e/chat-memory-staging";
import { deriveLangfuseTraceId } from "../src/modules/telemetry/trace";

const E2E_CREDENTIAL_ARGS = [
	"--email",
	"smoke-user@example.edu",
	"--password",
	"dev-smoke-password",
	"--captcha-token",
	"dev-captcha-token",
];

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
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("proves explicit memory write and SDK personal memory recall through sanitized run steps", async () => {
		const calls: Array<{
			body?: unknown;
			expectedStatus?: number;
			idempotencyKey?: string;
			method?: string;
			observabilityCanary?: unknown;
			url: string;
		}> = [];
		let signedInEmail: string | undefined;
		let memoryState: "missing" | "saving" | "synced" | "deleting" = "missing";
		let memoryPolls = 0;
		const sleep = vi.fn().mockResolvedValue(undefined);
		const result = await runChatMemoryE2eStaging(
			[
				"--chat-base-url",
				"https://campus.example.com",
				"--app-api-readyz-url",
				"https://api.example.com/readyz",
				"--memory-value",
				"body-sentinel-0001",
				"--observability-canary-header-sentinel",
				"header-sentinel-0001",
				"--observability-canary-api-key-sentinel",
				"credential-sentinel-0001",
				"--prompt",
				"query-sentinel-0001",
				...E2E_CREDENTIAL_ARGS,
			],
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
					calls.push({
						...(input.body === undefined ? {} : { body: input.body }),
						expectedStatus: input.expectedStatus,
						...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
						...(input.method ? { method: input.method } : {}),
						url: input.url,
					});
					if (input.url.endsWith("/api/me")) {
						return jsonResult({
							permissions: {
								chat: true,
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
						if (memoryState === "saving" || memoryState === "deleting") {
							memoryPolls += 1;
							if (memoryPolls % 2 === 0) {
								memoryState = memoryState === "saving" ? "synced" : "missing";
							}
						}
						return jsonResult({
							profileMemory: {
								itemCount: memoryState === "missing" ? 0 : 1,
								items:
									memoryState === "missing"
										? []
										: [
												{
													itemId: "mem_01HQ",
													key: "smoke_memory_probe",
													revision: 1,
													state: memoryState,
													updatedAt: "2026-06-04T00:00:00.000Z",
													value: "smoke memory sentinel",
												},
											],
								lifecycleState: "active",
								syncStatus:
									memoryState === "saving" || memoryState === "deleting" ? "pending" : "synced",
							},
						} as T);
					}
					if (input.url.endsWith("/api/me/profile-memory/items") && input.method === "POST") {
						memoryState = "saving";
						memoryPolls = 0;
						return jsonResult({
							profileMemory: {
								item: {
									itemId: "mem_01HQ",
									key: "smoke_memory_probe",
									state: "saving",
									value: "smoke memory sentinel",
								},
								lifecycleState: "active",
								syncStatus: "pending",
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
									projectionRef: "projection://runs/run_01HQ/sdk-tools/personal_memory_recall/1",
									resultId: "result-memory",
									resultKind: "typed_tool_result",
									runId: "run_01HQ",
									sanitizedPayload: {
										outcome: "matched",
										tool_name: "personal_memory_recall",
										tool_status: "completed",
									},
									status: "completed",
									stepId: "sdk_tool.execute.personal_memory_recall.1",
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
									tool: "personal_memory_recall",
									completedAt: "2026-06-04T01:02:05.000Z",
									conversationId: "conv_01HQ",
									parentStepId: "",
									payloadSchemaVersion: "run-step-projection-v1",
									runId: "run_01HQ",
									sanitizedPayload: {
										outcome: "matched",
										tool_name: "personal_memory_recall",
										tool_status: "completed",
									},
									startedAt: "2026-06-04T01:02:04.000Z",
									status: "completed",
									stepId: "sdk_tool.execute.personal_memory_recall.1",
									stepKind: "tool",
									taskQueue: "campus-agent.activity.agent.v3",
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
						memoryState = "deleting";
						memoryPolls = 0;
						return jsonResult({
							profileMemory: {
								item: {
									itemId: "mem_01HQ",
									key: "smoke_memory_probe",
									state: "deleting",
									value: "smoke memory sentinel",
								},
								lifecycleState: "active",
								syncStatus: "pending",
							},
						} as T);
					}
					throw new Error(`unexpected json request: ${input.url}`);
				},
				async signInIdentity(input) {
					signedInEmail = input.email;
					return "session=staging";
				},
				sleep,
				async openSubmitStream(input) {
					calls.push({
						body: input.body,
						method: "POST",
						observabilityCanary: input.observabilityCanary,
						url: input.url,
					});
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
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(result.submit).toEqual({
			requestId: "req_01HQ",
			resultKind: "answer",
			runId: "run_01HQ",
			runtimeTraceId: await deriveLangfuseTraceId("trace_01HQ"),
			traceId: "trace_01HQ",
		});
		expect(signedInEmail).toBe("smoke-user@example.edu");
		expect(result.recall).toEqual({
			outcome: "matched",
			projectionRef: "projection://runs/run_01HQ/sdk-tools/personal_memory_recall/1",
			stepId: "sdk_tool.execute.personal_memory_recall.1",
			status: "completed",
		});
		expect(calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					body: {
						key: "smoke_memory_probe",
						value: "body-sentinel-0001",
					},
					method: "POST",
					expectedStatus: 202,
					idempotencyKey: expect.stringMatching(/^chat-memory-e2e-create-/u),
					url: "https://campus.example.com/api/me/profile-memory/items",
				}),
				expect.objectContaining({
					body: { prompt: "query-sentinel-0001" },
					method: "POST",
					observabilityCanary: {
						apiKeySentinel: "credential-sentinel-0001",
						headerSentinel: "header-sentinel-0001",
					},
					url: "https://campus.example.com/api/chat/requests/stream",
				}),
				{
					expectedStatus: 200,
					method: "GET",
					url: "https://api.example.com/api/chat/runs/run_01HQ/steps",
				},
				expect.objectContaining({
					expectedStatus: 202,
					idempotencyKey: expect.stringMatching(/^chat-memory-e2e-delete-/u),
					method: "DELETE",
					url: "https://campus.example.com/api/me/profile-memory/items/mem_01HQ",
				}),
			]),
		);
	});

	it("adds only the two fixed observability canary headers when explicitly enabled", async () => {
		const captured: { requestHeaders?: Headers } = {};
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
			captured.requestHeaders = new Headers(init?.headers);
			return sseResponse([]);
		});

		await openChatMemorySubmitStream({
			body: { prompt: "query-sentinel-0001" },
			cookieHeader: "session=staging",
			observabilityCanary: {
				apiKeySentinel: "credential-sentinel-0001",
				headerSentinel: "header-sentinel-0001",
			},
			url: "https://campus.example.com/api/chat/requests/stream",
		});

		expect(captured.requestHeaders?.get("x-observability-canary")).toBe("header-sentinel-0001");
		expect(captured.requestHeaders?.get("x-observability-canary-api-key")).toBe(
			"credential-sentinel-0001",
		);
		expect([...(captured.requestHeaders?.keys() ?? [])].sort()).toEqual([
			"accept",
			"content-type",
			"cookie",
			"idempotency-key",
			"x-observability-canary",
			"x-observability-canary-api-key",
		]);

		await openChatMemorySubmitStream({
			body: { prompt: "ordinary-smoke" },
			cookieHeader: "session=staging",
			observabilityCanary: null,
			url: "https://campus.example.com/api/chat/requests/stream",
		});
		expect(captured.requestHeaders?.get("x-observability-canary")).toBeNull();
		expect(captured.requestHeaders?.get("x-observability-canary-api-key")).toBeNull();
	});

	it("rejects partial, duplicate, invalid, or aliased canary header inputs before I/O", async () => {
		const run = (...args: string[]) => runChatMemoryE2eStaging([...args, ...E2E_CREDENTIAL_ARGS]);

		await expect(
			run("--observability-canary-header-sentinel", "header-sentinel-0001"),
		).rejects.toThrow("must be provided together");
		await expect(
			run(
				"--observability-canary-header-sentinel",
				"header-sentinel-0001",
				"--observability-canary-api-key-sentinel",
				"credential-sentinel-0001",
				"--observability-canary-header-sentinel",
				"header-sentinel-0002",
			),
		).rejects.toThrow("may only be provided once");
		await expect(
			run(
				"--observability-canary-header-sentinel",
				"credential-sentinel-0001",
				"--observability-canary-api-key-sentinel",
				"header-sentinel-0001",
			),
		).rejects.toThrow("requires a valid synthetic sentinel");
		await expect(run("--header", "x-any=value")).rejects.toThrow("Unknown argument: --header");
	});
});
