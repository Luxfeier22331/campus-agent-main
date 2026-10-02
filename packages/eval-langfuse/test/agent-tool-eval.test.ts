import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadAgentToolEvalCases, validateAgentToolEvalCases } from "../src/agent-tool-eval";
import { runAgentToolEval } from "../src/agent-tool-runner";
import type { JsonObject } from "../src/json";
import { loadAgentProductEvalResult } from "../src/product-result";

function sse(event: string, data: JsonObject): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json" },
	});
}

function runStepsResponse(input: {
	answer: string;
	requestId: string;
	citedContextIds?: string[];
	citedContexts?: string[];
	retrievedContextIds?: string[];
	retrievedContexts?: string[];
}): Response {
	const trajectory = {
		decision_kind: "direct_answer",
		schema_version: "tool_trajectory.v4",
		tool_calls: [],
	};
	return jsonResponse({
		agent_runtime_eval_projection: {
			answer: input.answer,
			cited_context_ids: input.citedContextIds ?? [],
			cited_contexts: input.citedContexts ?? [],
			request_id: input.requestId,
			retrieved_context_ids: input.retrievedContextIds ?? [],
			retrieved_contexts: input.retrievedContexts ?? [],
			schema_version: "agent_runtime_eval_projection.v5",
			tool_trajectory: trajectory,
		},
	});
}

function casesPayload(): JsonObject {
	return {
		cases: [
			{
				case_id: "case-001",
				forbidden_context_ids: [],
				query: "图书馆几点开门？",
				reference: "应依据本轮文档回答。",
				reference_context_ids: ["doc:library"],
				reference_contexts: ["图书馆开放时间。"],
				reference_tool_calls: [],
				setup_turns: ["请准备查询图书馆信息。"],
			},
		],
		schema_version: "agent_routing_eval_cases.v1",
		surface: "app-api.chat",
	};
}

describe("agent eval cases", () => {
	it("loads the checked-in routing cases", () => {
		const result = loadAgentToolEvalCases(
			resolve(import.meta.dirname, "../assets/agent/routing/cases.v1.json"),
		);

		expect(result.case_count).toBe(16);
		expect(result.tool_counts).toEqual({ campus_search: 8, direct_answer: 8 });
		const ragCases = result.cases.filter((item) => item.reference_context_ids.length > 0);
		expect(ragCases).toHaveLength(8);
		expect(ragCases.every((item) => item.reference_context_ids[0]?.startsWith("evidence://"))).toBe(
			true,
		);
		expect(result.cases[0]).toMatchObject({
			case_id: "routing-direct-greeting",
			surface_key: "app-api.chat",
		});
		expect(
			result.cases.find((item) => item.case_id === "routing-other-institution-policy"),
		).toMatchObject({
			reference_tool_calls: [],
		});
		expect(result.cases.find((item) => item.case_id === "routing-six-turn-context")).toMatchObject({
			setup_turns: expect.arrayContaining(["我是中央民族大学一年级本科生。"]),
		});
		expect(
			result.cases.find((item) => item.case_id === "routing-six-turn-context")?.setup_turns,
		).toHaveLength(6);
	});

	it("loads versioned cases without Langfuse identity", () => {
		const result = validateAgentToolEvalCases(casesPayload());

		expect(result).toMatchObject({
			case_count: 1,
			schema_version: "agent_routing_eval_cases.v1",
			tool_counts: { direct_answer: 1 },
		});
		expect(result.cases[0]).toMatchObject({
			case_id: "case-001",
			query: "图书馆几点开门？",
			surface_key: "app-api.chat",
		});
		expect(JSON.stringify(result)).not.toContain("dataset_run");
	});

	it("rejects duplicate cases", () => {
		const duplicate = casesPayload();
		duplicate.cases = [
			...(duplicate.cases as JsonObject[]),
			{ ...(duplicate.cases as JsonObject[])[0] },
		];
		expect(() => validateAgentToolEvalCases(duplicate)).toThrow("case_id is duplicated");
	});
});

describe("agent product eval runner", () => {
	it("executes cases through App API and writes a product result", async () => {
		const directory = mkdtempSync(join(tmpdir(), "agent-product-eval-test-"));
		try {
			const casesPath = join(directory, "cases.json");
			const outputPath = join(directory, "product-result.json");
			writeFileSync(casesPath, JSON.stringify(casesPayload()), "utf-8");
			const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
			let streamCount = 0;

			const fetchImpl: typeof fetch = async (input, init) => {
				const url = String(input);
				if (url.endsWith("/api/chat/requests/stream")) {
					const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
					requests.push({ body, headers: new Headers(init?.headers), url });
					streamCount += 1;
					const setup = streamCount === 1;
					const requestId = setup ? "request-setup" : "request-001";
					return new Response(
						sse("request.accepted", { requestId, status: "accepted" }) +
							sse("request.completed", {
								answer: {
									conversation: { id: "conversation-001", messages: [] },
									result: {
										kind: "answer",
										requestId,
										text: setup ? "准备查询。" : "图书馆 8 点开门。",
									},
								},
								requestId,
								status: "completed",
							}),
						{ headers: { "content-type": "text/event-stream" } },
					);
				}
				if (url.endsWith("/internal/execution/requests/request-001/steps")) {
					requests.push({ body: null, headers: new Headers(init?.headers), url });
					return runStepsResponse({
						answer: "图书馆 8 点开门。",
						requestId: "request-001",
					});
				}
				throw new Error(`unexpected product eval request: ${url}`);
			};

			const summary = await runAgentToolEval({
				appApiBaseUrl: "https://app-api.example",
				casesPath,
				cookieHeader: "session=test",
				executionControlAuthSecret: "execution-secret",
				executionControlBaseUrl: "https://execution-control.example",
				fetchImpl,
				outputPath,
			});

			expect(summary).toMatchObject({
				case_count: 1,
			});
			expect(requests.map((request) => request.body)).toEqual([
				{ prompt: "请准备查询图书馆信息。" },
				{ conversationId: "conversation-001", prompt: "图书馆几点开门？" },
				null,
			]);
			expect(requests[0]?.url).toBe("https://app-api.example/api/chat/requests/stream");
			expect(requests[1]?.url).toBe("https://app-api.example/api/chat/requests/stream");
			expect(requests[2]?.url).toBe(
				"https://execution-control.example/internal/execution/requests/request-001/steps",
			);
			expect(requests[2]?.headers.get("x-worker-origin-auth")).toBe("execution-secret");
			expect(requests[2]?.headers.has("cookie")).toBe(false);
			const result = loadAgentProductEvalResult(outputPath);
			expect(result.items[0]).toMatchObject({
				answer: "图书馆 8 点开门。",
				case: { case_id: "case-001" },
				requestId: "request-001",
				retrievedContexts: [],
				toolTrajectory: { decision_kind: "direct_answer", tool_calls: [] },
			});
			expect(readFileSync(outputPath, "utf-8")).toContain("agent_product_eval_result.v3");
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});

	it("waits for the final execution projection after product completion", async () => {
		const directory = mkdtempSync(join(tmpdir(), "agent-product-eval-projection-wait-test-"));
		try {
			const casesPath = join(directory, "cases.json");
			const outputPath = join(directory, "product-result.json");
			writeFileSync(casesPath, JSON.stringify(casesPayload()), "utf-8");
			let streamCount = 0;
			let projectionReads = 0;

			const fetchImpl: typeof fetch = async (input) => {
				const url = String(input);
				if (url.endsWith("/api/chat/requests/stream")) {
					streamCount += 1;
					const setup = streamCount === 1;
					const requestId = setup ? "request-setup" : "request-001";
					return new Response(
						sse("request.accepted", { requestId, status: "accepted" }) +
							sse("request.completed", {
								answer: {
									conversation: { id: "conversation-001", messages: [] },
									result: {
										kind: "answer",
										requestId,
										text: setup ? "准备查询。" : "图书馆 8 点开门。",
									},
								},
								requestId,
								status: "completed",
							}),
						{ headers: { "content-type": "text/event-stream" } },
					);
				}
				if (url.endsWith("/internal/execution/requests/request-001/steps")) {
					projectionReads += 1;
					return runStepsResponse({
						answer: projectionReads === 1 ? "" : "图书馆 8 点开门。",
						requestId: "request-001",
					});
				}
				throw new Error(`unexpected projection wait request: ${url}`);
			};

			await runAgentToolEval({
				appApiBaseUrl: "https://app-api.example",
				casesPath,
				cookieHeader: "session=test",
				executionControlAuthSecret: "execution-secret",
				executionControlBaseUrl: "https://execution-control.example",
				fetchImpl,
				outputPath,
			});

			expect(projectionReads).toBe(2);
			expect(loadAgentProductEvalResult(outputPath).items[0]?.answer).toBe("图书馆 8 点开门。");
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});

	it("recovers a run when the initial stream ends after acceptance", async () => {
		const directory = mkdtempSync(join(tmpdir(), "agent-product-eval-recovery-test-"));
		try {
			const casesPath = join(directory, "cases.json");
			const outputPath = join(directory, "product-result.json");
			writeFileSync(casesPath, JSON.stringify(casesPayload()), "utf-8");
			const seen: Array<{ headers: Headers; url: string }> = [];

			const fetchImpl: typeof fetch = async (input, init) => {
				const url = String(input);
				const headers = new Headers(init?.headers);
				seen.push({ headers, url });
				if (url.endsWith("/api/chat/requests/stream")) {
					return new Response(
						sse("request.accepted", {
							requestId: "request-001",
							status: "accepted",
						}),
						{ headers: { "content-type": "text/event-stream" } },
					);
				}
				if (url.includes("/api/chat/requests/request-001/events")) {
					return jsonResponse({
						events: [
							{
								eventType: "request.completed",
								occurredAt: "2026-08-22T00:00:01.000Z",
								payload: {},
								sequence: 2,
							},
						],
						nextSequence: 3,
						run: {
							acceptedAt: "2026-08-22T00:00:00.000Z",
							completedAt: "2026-08-22T00:00:01.000Z",
							conversationId: "conversation-001",
							durationMs: 1_000,
							phase: "completed",
							requestId: "request-001",
							startedAt: "2026-08-22T00:00:00.000Z",
							status: "completed",
						},
					});
				}
				if (url.endsWith("/api/chat/conversations/conversation-001")) {
					return jsonResponse({
						conversation: {
							messages: [
								{
									kind: "answer",
									requestId: "request-001",
									role: "assistant",
									text: "图书馆 8 点开门。",
								},
							],
						},
					});
				}
				if (url.endsWith("/internal/execution/requests/request-001/steps")) {
					return runStepsResponse({
						answer: "图书馆 8 点开门。",
						requestId: "request-001",
					});
				}
				throw new Error(`unexpected recovery request: ${url}`);
			};

			const summary = await runAgentToolEval({
				appApiBaseUrl: "https://app-api.example",
				casesPath,
				cookieHeader: "session=test",
				executionControlAuthSecret: "execution-secret",
				executionControlBaseUrl: "https://execution-control.example",
				fetchImpl,
				outputPath,
			});

			expect(summary).toMatchObject({ case_count: 1 });
			const result = loadAgentProductEvalResult(outputPath);
			expect(result.items[0]).toMatchObject({
				answer: "图书馆 8 点开门。",
				requestId: "request-001",
			});
			const eventRequest = seen.find((request) =>
				request.url.includes("/api/chat/requests/request-001/events"),
			);
			const conversationRequest = seen.find((request) =>
				request.url.endsWith("/api/chat/conversations/conversation-001"),
			);
			expect(eventRequest?.headers.get("cookie")).toBe("session=test");
			expect(conversationRequest?.headers.get("cookie")).toBe("session=test");
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});
});
