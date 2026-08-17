import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { runRagasDatasetScoring, runRagasTraceScoring } from "../src/index";

describe("Ragas Langfuse official pipeline", () => {
	it("scores Langfuse traces through Ragas and writes Langfuse scores", async () => {
		const requests: Array<{ body: unknown; url: string }> = [];
		const result = await runRagasTraceScoring({
			environment: "staging",
			fetchImpl: async (input, init) => {
				const url = String(input);
				if (init?.body) {
					requests.push({ body: JSON.parse(String(init.body)), url });
				}
				if (url.includes("/api/public/traces")) {
					return new Response(
						JSON.stringify({
							data: [
								{
									id: "trace-001",
									metadata: {
										"eval.answer": "图书馆开放时间为 08:00 到 22:00。",
										"eval.question": "图书馆开放时间是什么？",
										"eval.retrieved_contexts": ["图书馆开放时间为 08:00-22:00。"],
										"eval.surface_key": "app-api.chat",
									},
								},
							],
							meta: { totalPages: 1 },
						}),
					);
				}
				return new Response(JSON.stringify({ id: "score-001" }), { status: 200 });
			},
			runPythonRagasScoreBatch: ({ outputPath }) => {
				writeFileSync(
					outputPath,
					JSON.stringify({
						eval_run_id: "ragas-trace-run",
						items: [
							{
								case_id: "trace-001",
								errors: [],
								metadata: { surface_key: "app-api.chat" },
								observation_id: null,
								scores: { "ragas.faithfulness": 0.9 },
								trace_id: "trace-001",
							},
						],
						schema_version: "ragas_score_batch.v1",
					}),
					"utf-8",
				);
			},
			settings: {
				baseUrl: "https://langfuse.example",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
			validateOnly: false,
		});

		expect(result.source_kind).toBe("langfuse_trace");
		expect(result.published).toBe(1);
		expect(requests[0]).toMatchObject({
			body: {
				metadata: {
					source_kind: "langfuse_trace",
				},
				name: "ragas.faithfulness",
				traceId: "trace-001",
			},
			url: "https://langfuse.example/api/public/scores",
		});
		const scoreRequestBody = requests[0]?.body as
			| { metadata?: Record<string, unknown> }
			| undefined;
		expect(scoreRequestBody?.metadata).not.toHaveProperty("source_artifact_path");
	});

	it("scores Langfuse dataset items and preserves dataset score identity", async () => {
		const requests: Array<{ body: unknown; url: string }> = [];
		const writtenSamples: unknown[] = [];
		const result = await runRagasDatasetScoring({
			datasetName: "campus-agent-golden",
			environment: "staging",
			fetchImpl: async (input, init) => {
				const url = String(input);
				if (init?.body) {
					requests.push({ body: JSON.parse(String(init.body)), url });
				}
				if (url.includes("/api/public/datasets/campus-agent-golden")) {
					return new Response(
						JSON.stringify({
							items: [
								{
									expectedOutput: {
										reference: "图书馆开放时间为 08:00-22:00。",
										reference_context_ids: ["doc:library-hours"],
										reference_contexts: ["图书馆开放时间为 08:00-22:00。"],
									},
									id: "dataset-item-001",
									input: {
										question: "图书馆开放时间是什么？",
									},
									metadata: {
										case_id: "library-hours",
										dataset_run_id: "dataset-run-001",
										observation_id: "obs-001",
										trace_id: "trace-001",
									},
								},
							],
						}),
					);
				}
				if (url.includes("/api/public/traces/trace-001")) {
					return new Response(
						JSON.stringify({
							id: "trace-001",
							observations: [
								{
									id: "obs-001",
									metadata: {
										"eval.answer": "图书馆开放时间为 08:00 到 22:00。",
										"eval.retrieved_context_ids": ["doc:library-hours"],
										"eval.retrieved_contexts": ["图书馆开放时间为 08:00-22:00。"],
									},
								},
							],
						}),
					);
				}
				return new Response(JSON.stringify({ id: "score-001" }), { status: 200 });
			},
			runPythonRagasScoreBatch: ({ inputPath, outputPath }) => {
				writtenSamples.push(JSON.parse(readFileSync(inputPath, "utf-8")));
				writeFileSync(
					outputPath,
					JSON.stringify({
						eval_run_id: "ragas-dataset-run",
						items: [
							{
								case_id: "library-hours",
								dataset_item_id: "dataset-item-001",
								dataset_run_id: "dataset-run-001",
								errors: [],
								metadata: {},
								scores: { "ragas.context_precision": 1 },
								trace_id: "trace-001",
							},
						],
						schema_version: "ragas_score_batch.v1",
					}),
					"utf-8",
				);
			},
			settings: {
				baseUrl: "https://langfuse.example",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
		});

		expect(result.source_kind).toBe("langfuse_dataset");
		expect(requests[0]?.body).toMatchObject({
			metadata: {
				source_kind: "langfuse_dataset",
			},
			name: "ragas.context_precision",
			traceId: "trace-001",
		});
		expect(requests[0]?.body).not.toHaveProperty("datasetItemId");
		expect(requests[0]?.body).not.toHaveProperty("datasetRunId");
		expect(writtenSamples[0]).toMatchObject({
			items: [
				{
					answer: "图书馆开放时间为 08:00 到 22:00。",
					contexts: ["图书馆开放时间为 08:00-22:00。"],
					observation_id: "obs-001",
					reference_context_ids: ["doc:library-hours"],
					retrieved_context_ids: ["doc:library-hours"],
				},
			],
		});
	});

	it("fails closed when a dataset item is not materialized into Ragas inputs", async () => {
		await expect(
			runRagasDatasetScoring({
				datasetName: "campus/rag/student_rules",
				environment: "staging",
				fetchImpl: async () =>
					new Response(
						JSON.stringify({
							items: [
								{
									expectedOutput: {
										reference_context_ids: ["doc:student-rules"],
									},
									id: "dataset-item-unmaterialized",
									input: {
										case_id: "synthetic-policy-title-medical",
										question: "示例学生医疗报销管理办法",
									},
									metadata: {
										case_id: "synthetic-policy-title-medical",
									},
								},
							],
						}),
					),
				runPythonRagasScoreBatch: () => {
					throw new Error("Ragas runner must not be invoked for unmaterialized items");
				},
				settings: {
					baseUrl: "https://langfuse.example",
					publicKey: "pk-test",
					secretKey: "sk-test",
				},
			}),
		).rejects.toThrow(
			"synthetic-policy-title-medical is not materialized for Ragas scoring; missing trace_id, answer, retrieved_contexts",
		);
	});

	it("fails closed when a materialized dataset item points to a missing observation", async () => {
		await expect(
			runRagasDatasetScoring({
				datasetName: "campus-agent-golden",
				environment: "staging",
				fetchImpl: async (input) => {
					const url = String(input);
					if (url.includes("/api/public/datasets/campus-agent-golden")) {
						return new Response(
							JSON.stringify({
								items: [
									{
										id: "dataset-item-missing-observation",
										input: {
											question: "图书馆开放时间是什么？",
										},
										metadata: {
											case_id: "library-hours",
											observation_id: "obs-missing",
											trace_id: "trace-001",
										},
									},
								],
							}),
						);
					}
					if (url.includes("/api/public/traces/trace-001")) {
						return new Response(
							JSON.stringify({
								id: "trace-001",
								observations: [
									{
										id: "obs-other",
										metadata: {
											"eval.answer": "图书馆开放时间为 08:00 到 22:00。",
											"eval.retrieved_contexts": ["图书馆开放时间为 08:00-22:00。"],
										},
									},
								],
							}),
						);
					}
					return new Response(JSON.stringify({ id: "score-001" }), { status: 200 });
				},
				runPythonRagasScoreBatch: () => {
					throw new Error("Ragas runner must not be invoked when observation is missing");
				},
				settings: {
					baseUrl: "https://langfuse.example",
					publicKey: "pk-test",
					secretKey: "sk-test",
				},
			}),
		).rejects.toThrow(
			"trace-001.obs-missing is not materialized for Ragas scoring; missing observation_id.",
		);
	});
});
