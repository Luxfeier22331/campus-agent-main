import { LangfuseClient } from "@langfuse/client";

import { loadAgentEvalScoreBatch } from "./eval-scores";
import { stableId } from "./identifiers";
import { type JsonObject, loadJsonObject, stringField } from "./json";
import { loadAgentProductEvalResult } from "./product-result";
import { assertCompleteSettings, type LangfuseSettings } from "./settings";

const SCORE_DATA_TYPES = {
	"ragas.agent_goal_accuracy.with_reference": "NUMERIC",
	"ragas.answer_relevancy": "NUMERIC",
	"ragas.context_precision": "NUMERIC",
	"ragas.context_recall": "NUMERIC",
	"ragas.faithfulness": "NUMERIC",
	"ragas.tool_call_accuracy.args": "NUMERIC",
	"ragas.tool_call_accuracy.name_only": "NUMERIC",
	"ragas.tool_call_f1.args": "NUMERIC",
	"ragas.tool_call_f1.name_only": "NUMERIC",
	"retrieval.context_present": "BOOLEAN",
	"retrieval.forbidden_context_absent": "BOOLEAN",
} as const;

export async function publishLangfuseScores(input: {
	client?: LangfuseClient;
	productResultPath: string;
	scorePath: string;
	settings: LangfuseSettings;
	traceMapPath: string;
}): Promise<JsonObject> {
	assertCompleteSettings(input.settings);
	const productResult = loadAgentProductEvalResult(input.productResultPath);
	const scoreBatch = loadAgentEvalScoreBatch(input.scorePath);
	const traceIdsByCase = loadTraceIdsByCase(input.traceMapPath);
	const productByCase = new Map(
		productResult.items.map((item) => [item.case.case_id, item] as const),
	);
	if (scoreBatch.items.length !== productByCase.size) {
		throw new Error("score batch must contain exactly one item for every product case");
	}
	const client =
		input.client ??
		new LangfuseClient({
			baseUrl: input.settings.baseUrl,
			publicKey: input.settings.publicKey,
			secretKey: input.settings.secretKey,
			...(input.settings.timeoutSeconds === undefined
				? {}
				: { timeout: input.settings.timeoutSeconds }),
		});
	let published = 0;
	let errorCount = 0;
	for (const item of scoreBatch.items) {
		if (!productByCase.has(item.case_id)) {
			throw new Error(`score batch contains unknown case_id: ${item.case_id}`);
		}
		const traceId = traceIdsByCase.get(item.case_id);
		if (!traceId) {
			throw new Error(`trace map is missing case_id: ${item.case_id}`);
		}
		for (const [name, value] of Object.entries(item.scores)) {
			const dataType = scoreDataType(name, value);
			client.score.create({
				dataType,
				id: stableId("lfscore", productResult.evalRunId, item.case_id, name),
				metadata: { case_id: item.case_id },
				name,
				traceId,
				value,
			});
			published += 1;
		}
		errorCount += item.errors.length;
		productByCase.delete(item.case_id);
		traceIdsByCase.delete(item.case_id);
	}
	if (productByCase.size > 0) {
		throw new Error("score batch is missing product cases");
	}
	if (traceIdsByCase.size > 0) {
		throw new Error(`trace map contains unknown case_id: ${[...traceIdsByCase.keys()].join(", ")}`);
	}
	await client.score.flush();
	return {
		error_count: errorCount,
		eval_run_id: productResult.evalRunId,
		published,
	};
}

function loadTraceIdsByCase(path: string): Map<string, string> {
	return new Map(
		Object.entries(loadJsonObject(path)).map(([caseId, traceId]) => [
			stringField(caseId, "trace map case_id"),
			stringField(traceId, `trace map ${caseId}`),
		]),
	);
}

function scoreDataType(
	name: string,
	value: number,
): (typeof SCORE_DATA_TYPES)[keyof typeof SCORE_DATA_TYPES] {
	const dataType = SCORE_DATA_TYPES[name as keyof typeof SCORE_DATA_TYPES];
	if (!dataType) {
		throw new Error(`unsupported Langfuse score name: ${name}`);
	}
	if (dataType === "BOOLEAN" && value !== 0 && value !== 1) {
		throw new Error(`${name} must be 0 or 1`);
	}
	return dataType;
}
