import { describe, expect, it } from "vitest";

import {
	buildLangfuseScoresFromRagasScoreBatch,
	publishLangfuseScores,
	validateLangfuseScorePublishPlan,
} from "../src/index";

function validRagasScoreBatch() {
	return {
		schema_version: "ragas_score_batch.v1",
		eval_run_id: "ragas-smoke-001",
		items: [
			{
				case_id: "case-ok",
				trace_id: "trace-product-001",
				observation_id: "obs-001",
				scores: {
					"ragas.faithfulness": 0.91,
				},
				errors: [
					{
						metric_name: "ragas.context_recall",
						reason: "missing reference contexts",
					},
				],
				metadata: {
					surface_key: "app-api.chat",
				},
			},
		],
	};
}

describe("Langfuse score publisher", () => {
	it("builds Langfuse score items from RAGAS scores and preserves omissions", () => {
		const plan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: validRagasScoreBatch(),
		});

		expect(plan.scoreItems).toHaveLength(1);
		expect(plan.omittedItems).toHaveLength(1);
		expect(plan.sourceResultDenominator).toBe(2);
		expect(plan.scoreItems[0]).toMatchObject({
			observation_id: "obs-001",
			trace_id: null,
		});
		expect(plan.omittedItems[0]).toMatchObject({
			case_id: "case-ok",
			reason: "missing reference contexts",
		});
	});

	it("fails closed on denominator drift and forbidden metadata", () => {
		const plan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: validRagasScoreBatch(),
		});
		plan.sourceResultDenominator = 3;
		expect(() => validateLangfuseScorePublishPlan(plan)).toThrow(
			"sourceResultDenominator must equal scoreItems plus omittedItems length",
		);

		plan.sourceResultDenominator = 2;
		const scoreItem = plan.scoreItems[0];
		if (!scoreItem) {
			throw new Error("expected score item");
		}
		scoreItem.metadata = { raw_prompt: "secret" };
		expect(() => validateLangfuseScorePublishPlan(plan)).toThrow(
			"scoreItems[0].metadata.raw_prompt is forbidden Langfuse metadata",
		);
	});

	it("requires exactly one score target", () => {
		const plan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: validRagasScoreBatch(),
		});
		const scoreItem = plan.scoreItems[0];
		if (!scoreItem) {
			throw new Error("expected score item");
		}

		scoreItem.trace_id = "trace-product-001";
		expect(() => validateLangfuseScorePublishPlan(plan)).toThrow(
			"scoreItems[0] must carry exactly one of trace_id or observation_id",
		);

		scoreItem.trace_id = null;
		scoreItem.observation_id = null;
		expect(() => validateLangfuseScorePublishPlan(plan)).toThrow(
			"scoreItems[0] must carry exactly one of trace_id or observation_id",
		);
	});

	it("publishes score payloads with Basic auth and Langfuse field names", async () => {
		const requests: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
		const plan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: validRagasScoreBatch(),
		});
		const result = await publishLangfuseScores({
			evalRunId: plan.evalRunId,
			fetchImpl: async (input, init) => {
				requests.push({
					body: JSON.parse(String(init?.body)),
					headers: init?.headers as Record<string, string>,
					url: String(input),
				});
				return new Response(JSON.stringify({ id: "score-001" }), { status: 200 });
			},
			omittedItems: plan.omittedItems,
			scoreItems: plan.scoreItems,
			settings: {
				baseUrl: "https://langfuse.example",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
			sourceResultDenominator: plan.sourceResultDenominator,
		});

		expect(result.published).toBe(1);
		expect(requests[0]?.url).toBe("https://langfuse.example/api/public/scores");
		expect(requests[0]?.headers.authorization).toBe("Basic cGstdGVzdDpzay10ZXN0");
		expect(requests[0]?.body).toMatchObject({
			dataType: "NUMERIC",
			name: "ragas.faithfulness",
			observationId: "obs-001",
			source: "API",
		});
		expect(requests[0]?.body).not.toHaveProperty("traceId");
		expect(requests[0]?.body).not.toHaveProperty("datasetItemId");
		expect(requests[0]?.body).not.toHaveProperty("datasetRunId");
	});

	it("builds score items from RAGAS scores", () => {
		const plan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: {
				schema_version: "ragas_score_batch.v1",
				eval_run_id: "ragas-smoke-001",
				items: [
					{
						case_id: "case-001",
						trace_id: "trace-001",
						observation_id: "obs-001",
						scores: {
							"ragas.faithfulness": 0.91,
							"ragas.answer_relevancy": 0.82,
						},
						errors: [
							{
								metric_name: "ragas.context_recall",
								reason: "missing reference contexts",
							},
						],
						metadata: {
							surface_key: "app-api.chat",
						},
					},
				],
			},
		});

		expect(plan.scoreItems).toHaveLength(2);
		expect(plan.sourceResultDenominator).toBe(3);
		expect(plan.scoreItems.map((item) => item.name)).toEqual([
			"ragas.faithfulness",
			"ragas.answer_relevancy",
		]);
		expect(plan.scoreItems[0]).toMatchObject({
			case_id: "case-001",
			data_type: "NUMERIC",
			observation_id: "obs-001",
			trace_id: null,
			value: 0.91,
		});
		expect(plan.scoreItems[0]?.metadata).toMatchObject({
			case_id: "case-001",
			eval_kind: "ragas",
			metric_key: "ragas.faithfulness",
			schema_version: "ragas_score_batch.v1",
			source_artifact_path: "ragas-scores.json",
			surface_key: "app-api.chat",
		});
		expect(plan.omittedItems).toHaveLength(1);
		expect(plan.omittedItems[0]).toMatchObject({
			case_id: "case-001",
			reason: "missing reference contexts",
			source_result_id: "case-001:ragas.context_recall",
		});
	});
});
