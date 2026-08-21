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
	answer?: string;
	conversationId: string;
	retrievedContextIds?: string[];
	retrievedContexts?: string[];
	runId: string;
	traceId: string;
}): Response {
	const trajectory = {
		available_tools: [],
		conversation_id: input.conversationId,
		decision_kind: "direct_answer",
		request_id: "request-001",
		run_id: input.runId,
		schema_version: "tool_trajectory.v3",
		tool_calls: [],
		trace_id: input.traceId,
	};
	return jsonResponse({
		agentRuntimeEvalProjection: {
			rag: {
				...(input.answer === undefined ? {} : { answer: input.answer }),
				retrieved_context_ids: input.retrievedContextIds ?? [],
				retrieved_contexts: input.retrievedContexts ?? [],
			},
			run: { run_id: input.runId, trace_id: input.traceId },
			schema_version: "agent_runtime_eval_projection.v3",
			tool_trajectory: trajectory,
		},
	});
}

function casesPayload(): JsonObject {
	return {
		cases: [
			{
				argument_mode: "name_only",
				case_id: "case-001",
				expected_outcome: "answer",
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

		expect(result.case_count).toBe(10);
		expect(result.cases[0]).toMatchObject({
			case_id: "routing-direct-greeting",
			surface_key: "app-api.chat",
		});
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

	it("rejects duplicate cases and unsafe argument-mode references", () => {
		const duplicate = casesPayload();
		duplicate.cases = [
			...(duplicate.cases as JsonObject[]),
			{ ...(duplicate.cases as JsonObject[])[0] },
		];
		expect(() => validateAgentToolEvalCases(duplicate)).toThrow("case_id is duplicated");

		const unsafe = casesPayload();
		unsafe.cases = [
			{
				...(unsafe.cases as JsonObject[])[0],
				argument_mode: "eval_safe_args",
				reference_tool_calls: [{ args: {}, name: "personal_memory_recall" }],
			},
		];
		expect(() => validateAgentToolEvalCases(unsafe)).toThrow(
			"eval_safe_args requires non-empty reference tool args",
		);
	});
});

describe("agent product eval runner", () => {
	it("executes cases through App API and writes a product result", async () => {
		const directory = mkdtempSync(join(tmpdir(), "agent-product-eval-test-"));
		try {
			const casesPath = join(directory, "cases.json");
			const outputPath = join(directory, "product-result.json");
			writeFileSync(casesPath, JSON.stringify(casesPayload()), "utf-8");
			const requests: Array<{ body: unknown; url: string }> = [];
			let streamCount = 0;

			const fetchImpl: typeof fetch = async (input, init) => {
				const url = String(input);
				if (url.endsWith("/api/chat/requests/stream")) {
					const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
					requests.push({ body, url });
					streamCount += 1;
					const setup = streamCount === 1;
					const requestId = setup ? "request-setup" : "request-001";
					const runId = setup ? "run-setup" : "run-001";
					const traceId = setup ? "trace-setup" : "trace-001";
					return new Response(
						sse("request.accepted", { requestId, runId, status: "accepted", traceId }) +
							sse("request.completed", {
								answer: {
									conversation: { id: "conversation-001", messages: [] },
									result: {
										kind: "answer",
										requestId,
										text: setup ? "准备查询。" : "图书馆 8 点开门。",
										traceId,
									},
								},
								requestId,
								status: "completed",
								traceId,
							}),
						{ headers: { "content-type": "text/event-stream" } },
					);
				}
				if (url.endsWith("/api/chat/runs/run-001/steps")) {
					return runStepsResponse({
						answer: "图书馆 8 点开门。",
						conversationId: "conversation-001",
						runId: "run-001",
						traceId: "trace-001",
					});
				}
				throw new Error(`unexpected App API request: ${url}`);
			};

			const summary = await runAgentToolEval({
				appApiBaseUrl: "https://app-api.example",
				casesPath,
				cookieHeader: "session=test",
				fetchImpl,
				outputPath,
			});

			expect(summary).toMatchObject({
				case_count: 1,
			});
			expect(requests.map((request) => request.body)).toEqual([
				{ prompt: "请准备查询图书馆信息。" },
				{ conversationId: "conversation-001", prompt: "图书馆几点开门？" },
			]);
			const result = loadAgentProductEvalResult(outputPath);
			expect(result.items[0]).toMatchObject({
				case: { case_id: "case-001" },
				projection: {
					retrievedContexts: [],
					runId: "run-001",
					traceId: "trace-001",
				},
				terminal: { answer: "图书馆 8 点开门。", runId: "run-001" },
			});
			expect(readFileSync(outputPath, "utf-8")).toContain("agent_product_eval_result.v1");
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});
});
