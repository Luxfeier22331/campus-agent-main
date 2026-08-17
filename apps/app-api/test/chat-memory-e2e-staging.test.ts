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
	"e2e-user@example.edu",
	"--password",
	"dev-e2e-password",
	"--captcha-token",
	"dev-captcha-token",
];

function jsonResult<T>(
	payload: T,
	response = new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json" },
	}),
): { payload: T; response: Response } {
	return { payload, response };
}

function sseResponse(blocks: string[]): Response {
	return new Response(blocks.join(""), {
		headers: { "content-type": "text/event-stream" },
		status: 200,
	});
}

function runtimeTrajectory(input: {
	appendProjected: boolean;
	recallOutcome: "matched" | "no_match" | null;
	runId: string;
	visibleToolNames: string[];
}) {
	const recallStepId = "sdk_tool.execute.personal_memory_recall.1";
	const appendStatus = input.runId === "run_4" ? "skipped" : "completed";
	return {
		results:
			input.recallOutcome === null
				? []
				: [
						{
							projectionRef: `projection://runs/${input.runId}/sdk-tools/personal_memory_recall/1`,
							resultKind: "typed_tool_result",
							runId: input.runId,
							sanitizedPayload: {
								outcome: input.recallOutcome,
								tool_name: "personal_memory_recall",
								tool_status: "completed",
							},
							status: "completed",
							stepId: recallStepId,
						},
					],
		steps: [
			{
				runId: input.runId,
				sanitizedPayload: { visible_tool_names: input.visibleToolNames },
				status: "completed",
				stepId: "agent.primary",
				stepKind: "agent",
			},
			...(input.recallOutcome === null
				? []
				: [
						{
							runId: input.runId,
							sanitizedPayload: {
								outcome: input.recallOutcome,
								tool_name: "personal_memory_recall",
								tool_status: "completed",
							},
							status: "completed",
							stepId: recallStepId,
							stepKind: "tool",
						},
					]),
			...(input.appendProjected
				? [
						{
							runId: input.runId,
							sanitizedPayload: {
								skip_reasons: appendStatus === "skipped" ? ["memory_disabled"] : [],
								status: appendStatus,
							},
							status: appendStatus,
							stepId: "memory.append",
							stepKind: "memory",
						},
					]
				: []),
		],
	};
}

describe("chat memory staging e2e runner", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("proves the full personal-memory lifecycle and leaves the synthetic account active and empty", async () => {
		const calls: Array<{
			body?: unknown;
			expectedStatus?: number;
			idempotencyKey?: string;
			method?: string;
			observabilityCanary?: unknown;
			url: string;
		}> = [];
		let lifecycleState: "active" | "paused" | "erasing" | "erased" = "active";
		let syncStatus: "synced" | "pending" = "synced";
		let item: {
			itemId: string;
			key: string;
			revision: number;
			state: "saving" | "synced" | "deleting";
			updatedAt: string;
			value: string;
		} | null = {
			itemId: "mem_01HQ",
			key: "e2e_memory_probe",
			revision: 7,
			state: "synced",
			updatedAt: "2026-08-16T00:00:00.000Z",
			value: "stale-memory-value",
		};
		let pendingPolls = 0;
		let finalizeTransition: (() => void) | null = null;
		let signedInEmail: string | undefined;
		let updatedMemoryValue: string | null = null;
		let conversationMemorySentinel: string | null = null;
		let submitCount = 0;
		const runStepPolls = new Map<string, number>();
		const sleep = vi.fn().mockResolvedValue(undefined);

		function beginTransition(finalize: () => void): void {
			syncStatus = "pending";
			pendingPolls = 2;
			finalizeTransition = finalize;
		}

		function profileMemorySnapshot() {
			if (pendingPolls > 0) {
				pendingPolls -= 1;
				if (pendingPolls === 0) {
					finalizeTransition?.();
					finalizeTransition = null;
					syncStatus = "synced";
				}
			}
			return {
				itemCount: item ? 1 : 0,
				items: item ? [{ ...item }] : [],
				lifecycleState,
				syncStatus,
			};
		}

		function mutationSnapshot() {
			return {
				...(item ? { item: { ...item } } : {}),
				lifecycleState,
				syncStatus,
			};
		}

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
					return { payload: { ok: true }, status: 200 };
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
						return jsonResult({ permissions: { chat: true } } as T);
					}
					if (input.url.endsWith("/api/me/profile-memory") && input.method !== "DELETE") {
						return jsonResult({ profileMemory: profileMemorySnapshot() } as T);
					}
					if (input.url.endsWith("/api/me/profile-memory/items") && input.method === "POST") {
						const body = input.body as { key: string; value: string };
						item = {
							itemId: "mem_01HQ",
							key: body.key,
							revision: 1,
							state: "saving",
							updatedAt: "2026-08-17T00:00:00.000Z",
							value: body.value,
						};
						beginTransition(() => {
							if (item) {
								item.state = "synced";
							}
						});
						return jsonResult({ profileMemory: mutationSnapshot() } as T);
					}
					if (
						input.url.endsWith("/api/me/profile-memory/items/mem_01HQ") &&
						input.method === "PATCH"
					) {
						const body = input.body as { key: string; value: string };
						updatedMemoryValue = body.value;
						if (!item) {
							throw new Error("test item is missing before update");
						}
						item = { ...item, key: body.key, revision: 2, state: "saving", value: body.value };
						beginTransition(() => {
							if (item) {
								item.state = "synced";
							}
						});
						return jsonResult({ profileMemory: mutationSnapshot() } as T);
					}
					if (input.url.endsWith("/api/me/profile-memory/settings") && input.method === "PATCH") {
						const enabled = (input.body as { enabled: boolean }).enabled;
						lifecycleState = enabled ? "active" : "paused";
						beginTransition(() => undefined);
						return jsonResult({ profileMemory: mutationSnapshot() } as T);
					}
					if (
						input.url.endsWith("/api/me/profile-memory/items/mem_01HQ") &&
						input.method === "DELETE"
					) {
						if (!item) {
							throw new Error("test item is missing before delete");
						}
						item.state = "deleting";
						beginTransition(() => {
							item = null;
						});
						return jsonResult({ profileMemory: mutationSnapshot() } as T);
					}
					if (input.url.endsWith("/api/me/profile-memory") && input.method === "DELETE") {
						lifecycleState = "erasing";
						beginTransition(() => {
							item = null;
							lifecycleState = "erased";
						});
						return jsonResult({ profileMemory: mutationSnapshot() } as T);
					}
					const runMatch = input.url.match(/\/api\/chat\/runs\/(run_\d+)\/steps$/u);
					if (runMatch?.[1]) {
						const runId = runMatch[1];
						const runNumber = Number(runId.slice("run_".length));
						const pollCount = (runStepPolls.get(runId) ?? 0) + 1;
						runStepPolls.set(runId, pollCount);
						const recallOutcome =
							runNumber === 1 || runNumber === 3 || runNumber === 5
								? "matched"
								: runNumber === 6
									? "no_match"
									: null;
						return jsonResult(
							runtimeTrajectory({
								appendProjected: pollCount >= 2,
								recallOutcome,
								runId,
								visibleToolNames: runNumber === 4 ? [] : ["personal_memory_recall"],
							}) as T,
						);
					}
					throw new Error(`unexpected json request: ${input.method ?? "GET"} ${input.url}`);
				},
				async signInIdentity(input) {
					signedInEmail = input.email;
					return "session=staging";
				},
				sleep,
				async openSubmitStream(input) {
					submitCount += 1;
					calls.push({
						body: input.body,
						method: "POST",
						observabilityCanary: input.observabilityCanary,
						url: input.url,
					});
					const prompt = (input.body as { prompt: string }).prompt;
					if (submitCount === 2) {
						conversationMemorySentinel =
							prompt.match(/conversation-memory-[0-9a-f-]{36}/u)?.[0] ?? null;
					}
					if (!updatedMemoryValue) {
						throw new Error("updated memory value is missing before chat submit");
					}
					const answerText =
						submitCount === 1 || submitCount === 5
							? updatedMemoryValue
							: submitCount === 3
								? (conversationMemorySentinel ?? "missing-conversation-sentinel")
								: submitCount === 6
									? "我没有这条显式记忆。"
									: "已确认。";
					const requestId = `req_${submitCount}`;
					const runId = `run_${submitCount}`;
					const traceId = `trace_${submitCount}`;
					return sseResponse([
						`event: request.accepted\ndata: ${JSON.stringify({ requestId, runId, traceId })}\n\n`,
						`event: request.completed\ndata: ${JSON.stringify({
							answer: {
								conversation: { id: `conv_${submitCount}` },
								result: { kind: "answer", requestId, text: answerText, traceId },
							},
							requestId,
							traceId,
						})}\n\n`,
					]);
				},
			},
		);

		expect(result.passed).toBe(true);
		expect(result.readyz).toEqual({ appApiStatus: 200, chatStatus: 200 });
		expect(result.lifecycle).toEqual({
			erased: "erased",
			initial: "active",
			paused: "paused",
			reactivated: "active",
			resumed: "active",
		});
		expect(result.memory).toEqual({
			createdRevision: 1,
			deleted: true,
			itemId: "mem_01HQ",
			updatedRevision: 2,
		});
		expect(result.runs.explicitRecall).toMatchObject({
			answerContainsExpected: true,
			append: { skipReasons: [], status: "completed" },
			recall: { outcome: "matched", status: "completed" },
			requestId: "req_1",
			runId: "run_1",
			visibleToolNames: ["personal_memory_recall"],
		});
		expect(result.runs.conversationRecall).toMatchObject({
			answerContainsExpected: true,
			recall: { outcome: "matched" },
			requestId: "req_3",
			runId: "run_3",
		});
		expect(result.runs.paused).toMatchObject({
			append: { skipReasons: ["memory_disabled"], status: "skipped" },
			recall: null,
			requestId: "req_4",
			visibleToolNames: [],
		});
		expect(result.runs.resumed).toMatchObject({
			answerContainsExpected: true,
			append: { status: "completed" },
			recall: { outcome: "matched" },
			requestId: "req_5",
		});
		expect(result.runs.deletedProbe).toMatchObject({
			answerExcludesForbidden: true,
			recall: { outcome: "no_match" },
			requestId: "req_6",
		});
		expect(result.runs.explicitRecall?.runtimeTraceId).toBe(await deriveLangfuseTraceId("trace_1"));
		expect(signedInEmail).toBe("e2e-user@example.edu");
		expect(submitCount).toBe(6);
		expect(sleep).toHaveBeenCalledTimes(14);
		expect(JSON.stringify(result)).not.toContain("body-sentinel-0001");
		expect(JSON.stringify(result)).not.toContain(conversationMemorySentinel);
		expect(calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					body: { key: "e2e_memory_probe", value: "body-sentinel-0001" },
					expectedStatus: 202,
					method: "POST",
					url: "https://campus.example.com/api/me/profile-memory/items",
				}),
				expect.objectContaining({
					body: expect.objectContaining({ key: "e2e_memory_probe" }),
					expectedStatus: 202,
					method: "PATCH",
					url: "https://campus.example.com/api/me/profile-memory/items/mem_01HQ",
				}),
				expect.objectContaining({
					body: { enabled: false },
					method: "PATCH",
					url: "https://campus.example.com/api/me/profile-memory/settings",
				}),
				expect.objectContaining({
					expectedStatus: 202,
					method: "DELETE",
					url: "https://campus.example.com/api/me/profile-memory",
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
			]),
		);
	});

	it("preserves the primary and cleanup failures when final cleanup also fails", async () => {
		let profileReads = 0;
		let cleanupAttempted = false;
		try {
			await runChatMemoryE2eStaging(E2E_CREDENTIAL_ARGS, {
				async fetchReadyz() {
					return { payload: { ok: true }, status: 200 };
				},
				async fetchJsonWithCookie<T>(
					input: Parameters<
						NonNullable<ChatMemoryE2eStagingDependencies["fetchJsonWithCookie"]>
					>[0],
				) {
					if (input.url.endsWith("/api/me")) {
						return jsonResult({ permissions: { chat: true } } as T);
					}
					if (input.url.endsWith("/api/me/profile-memory") && input.method === "DELETE") {
						cleanupAttempted = true;
						throw new Error("cleanup failed");
					}
					if (input.url.endsWith("/api/me/profile-memory")) {
						profileReads += 1;
						return jsonResult({
							profileMemory: {
								items: [],
								lifecycleState: "active",
								syncStatus: "synced",
							},
						} as T);
					}
					if (input.url.endsWith("/api/me/profile-memory/items")) {
						return jsonResult({
							profileMemory: {
								lifecycleState: "active",
								syncStatus: "pending",
							},
						} as T);
					}
					throw new Error(`unexpected request: ${input.url}`);
				},
				async signInIdentity() {
					return "session=staging";
				},
			});
			throw new Error("expected runChatMemoryE2eStaging to reject");
		} catch (error) {
			expect(error).toBeInstanceOf(AggregateError);
			const errors = (error as AggregateError).errors;
			expect(errors).toHaveLength(2);
			expect(String(errors[0])).toContain("missing the accepted item");
			expect(String(errors[1])).toContain("cleanup failed");
		}
		expect(profileReads).toBe(1);
		expect(cleanupAttempted).toBe(true);
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
			body: { prompt: "ordinary-e2e" },
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
