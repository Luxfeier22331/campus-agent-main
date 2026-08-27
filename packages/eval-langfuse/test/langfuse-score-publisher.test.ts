import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LangfuseClient } from "@langfuse/client";
import { describe, expect, it } from "vitest";

import { validateAgentToolEvalCases } from "../src/agent-tool-eval";
import { writeJsonObject } from "../src/json";
import { type AgentProductEvalResult, writeAgentProductEvalResult } from "../src/product-result";
import { publishLangfuseScores } from "../src/score-publisher";

const settings = {
	baseUrl: "https://langfuse.example",
	publicKey: "pk-test",
	secretKey: "sk-test",
} as const;

function productResult(): AgentProductEvalResult {
	const cases = validateAgentToolEvalCases({
		cases: [
			{
				argument_mode: "name_only",
				case_id: "case-001",
				forbidden_context_ids: [],
				query: "你好",
				reference_context_ids: [],
				reference_contexts: [],
				reference_tool_calls: [],
			},
		],
		schema_version: "agent_routing_eval_cases.v1",
	}).cases;
	const [firstCase] = cases;
	if (!firstCase) {
		throw new Error("expected one eval case");
	}
	const toolTrajectory = {
		decision_kind: "direct_answer" as const,
		schema_version: "tool_trajectory.v4" as const,
		tool_calls: [],
	};
	return {
		evalRunId: "eval-001",
		items: [
			{
				answer: "你好！",
				case: firstCase,
				requestId: "request-001",
				retrievedContextIds: [],
				retrievedContexts: [],
				toolTrajectory,
			},
		],
	};
}

describe("Langfuse score publisher", () => {
	it("uses the SDK score queue and flushes once", async () => {
		const directory = mkdtempSync(join(tmpdir(), "langfuse-score-test-"));
		try {
			const productPath = join(directory, "product.json");
			const scorePath = join(directory, "scores.json");
			const traceMapPath = join(directory, "trace-map.json");
			writeAgentProductEvalResult(productPath, productResult());
			writeJsonObject(traceMapPath, { "case-001": "0f5f3f3f3f3f3f3f3f3f3f3f3f3f3f3f" });
			writeJsonObject(scorePath, {
				items: [
					{
						case_id: "case-001",
						errors: [],
						scores: {
							"ragas.faithfulness": 0.75,
						},
					},
				],
				schema_version: "agent_eval_score_batch.v2",
			});

			const created: Record<string, unknown>[] = [];
			let flushCount = 0;
			const client = {
				score: {
					create: (data: Record<string, unknown>) => {
						created.push(data);
					},
					flush: async () => {
						flushCount += 1;
					},
				},
			} as unknown as LangfuseClient;

			const summary = await publishLangfuseScores({
				client,
				productResultPath: productPath,
				scorePath,
				settings,
				traceMapPath,
			});

			expect(summary).toMatchObject({ eval_run_id: "eval-001", published: 1 });
			expect(flushCount).toBe(1);
			expect(created.map((item) => item.name)).toEqual(["ragas.faithfulness"]);
			expect(created).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						dataType: "NUMERIC",
						metadata: { case_id: "case-001" },
						traceId: "0f5f3f3f3f3f3f3f3f3f3f3f3f3f3f3f",
						value: 0.75,
					}),
				]),
			);
			for (const item of created) {
				expect(item).not.toHaveProperty("datasetRunId");
				expect(item).not.toHaveProperty("observationId");
			}
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});

	it("rejects scores outside the code-owned allowlist", async () => {
		const directory = mkdtempSync(join(tmpdir(), "langfuse-score-validation-test-"));
		try {
			const productPath = join(directory, "product.json");
			const scorePath = join(directory, "scores.json");
			const traceMapPath = join(directory, "trace-map.json");
			writeAgentProductEvalResult(productPath, productResult());
			writeJsonObject(traceMapPath, { "case-001": "0f5f3f3f3f3f3f3f3f3f3f3f3f3f3f3f" });
			writeJsonObject(scorePath, {
				items: [
					{
						case_id: "case-001",
						errors: [],
						scores: { "ragas.context_precision_without_reference": 0.5 },
					},
				],
				schema_version: "agent_eval_score_batch.v2",
			});

			await expect(
				publishLangfuseScores({
					client: {
						score: { create: () => undefined, flush: async () => undefined },
					} as unknown as LangfuseClient,
					productResultPath: productPath,
					scorePath,
					settings,
					traceMapPath,
				}),
			).rejects.toThrow("unsupported Langfuse score name");
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});
});
