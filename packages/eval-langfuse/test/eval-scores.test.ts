import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateAgentToolEvalCases } from "../src/agent-tool-eval";
import { loadAgentEvalScoreBatch, scoreAgentProductResult } from "../src/eval-scores";
import type { JsonObject } from "../src/json";
import { loadJsonObject, writeJsonObject } from "../src/json";
import { type AgentProductEvalResult, writeAgentProductEvalResult } from "../src/product-result";
import type { ToolTrajectory } from "../src/tool-trajectory";

function productResult(): AgentProductEvalResult {
	const validation = validateAgentToolEvalCases({
		cases: [
			{
				argument_mode: "name_only",
				case_id: "case-with-rag",
				forbidden_context_ids: [],
				query: "图书馆几点开门？",
				reference: "图书馆 8 点开门。",
				reference_context_ids: ["doc:library"],
				reference_contexts: ["图书馆开放时间。"],
				reference_tool_calls: [],
			},
			{
				argument_mode: "name_only",
				case_id: "case-without-rag",
				forbidden_context_ids: [],
				query: "你好",
				reference: "直接回答问候。",
				reference_context_ids: [],
				reference_contexts: [],
				reference_tool_calls: [],
			},
		],
		schema_version: "agent_routing_eval_cases.v1",
	});
	return {
		evalRunId: "eval-001",
		items: validation.cases.map((caseItem, index) => {
			const toolTrajectory: ToolTrajectory = {
				decision_kind: "direct_answer",
				schema_version: "tool_trajectory.v4",
				tool_calls: [],
			};
			return {
				answer: index === 0 ? "没有召回到上下文。" : "你好！",
				case: caseItem,
				requestId: `request-${index + 1}`,
				retrievedContextIds: [],
				retrievedContexts: [],
				toolTrajectory,
			};
		}),
	};
}

function writeAgentScores(inputPath: string, outputPath: string): void {
	const input = loadJsonObject(inputPath);
	writeJsonObject(outputPath, {
		items: (input.items as JsonObject[]).map((item) => ({
			case_id: item.case_id,
			errors: [],
			scores: { "ragas.tool_call_f1.name_only": 0.5 },
		})),
		schema_version: "ragas_agent_score_batch.v3",
	});
}

describe("product result scoring adapter", () => {
	it("keeps empty retrieval in the Ragas sample and merges complete batches", () => {
		const directory = mkdtempSync(join(tmpdir(), "eval-score-adapter-test-"));
		try {
			const productPath = join(directory, "product.json");
			const scoresPath = join(directory, "scores.json");
			writeAgentProductEvalResult(productPath, productResult());
			const ragSamples: JsonObject[] = [];

			const summary = scoreAgentProductResult({
				inputPath: productPath,
				outputPath: scoresPath,
				runPythonAgent: ({ inputPath, outputPath }) => writeAgentScores(inputPath, outputPath),
				runPythonRag: ({ inputPath, outputPath }) => {
					const input = loadJsonObject(inputPath);
					ragSamples.push(input);
					writeJsonObject(outputPath, {
						items: [
							{
								case_id: "case-with-rag",
								errors: [],
								scores: { "ragas.faithfulness": 0.25 },
							},
						],
						schema_version: "ragas_score_batch.v3",
					});
				},
			});

			expect(summary).toMatchObject({ case_count: 2, error_count: 0 });
			expect(ragSamples).toHaveLength(1);
			expect(ragSamples[0]).toMatchObject({
				items: [
					{
						case_id: "case-with-rag",
						retrieved_contexts: [],
					},
				],
				schema_version: "ragas_sample_batch.v3",
			});
			const scores = loadAgentEvalScoreBatch(scoresPath);
			expect(scores.items).toHaveLength(2);
			expect(scores.items[0]).toMatchObject({
				case_id: "case-with-rag",
				scores: {
					"ragas.faithfulness": 0.25,
					"ragas.tool_call_f1.name_only": 0.5,
					"retrieval.context_present": 0,
				},
			});
			expect(scores.items[1]?.scores).toEqual({ "ragas.tool_call_f1.name_only": 0.5 });
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});

	it("rejects a Ragas batch that silently omits a product case", () => {
		const directory = mkdtempSync(join(tmpdir(), "eval-score-coverage-test-"));
		try {
			const productPath = join(directory, "product.json");
			const scoresPath = join(directory, "scores.json");
			writeAgentProductEvalResult(productPath, productResult());
			expect(() =>
				scoreAgentProductResult({
					inputPath: productPath,
					outputPath: scoresPath,
					runPythonAgent: ({ outputPath }) =>
						writeJsonObject(outputPath, {
							items: [{ case_id: "case-with-rag", errors: [], scores: {} }],
							schema_version: "ragas_agent_score_batch.v3",
						}),
					runPythonRag: () => {
						throw new Error("RAG runner must not run after incomplete agent batch");
					},
				}),
			).toThrow("Ragas score is missing case_id: case-without-rag");
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});
});
