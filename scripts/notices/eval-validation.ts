import type { NoticeCategory } from "@campus-agent/notices";

import {
	BALANCED_DIAGNOSTIC_PROFILE,
	CATEGORY_SET,
	type EvalPrediction,
	type EvalProfile,
	type EvalSample,
	type LabelGoldEntry,
	RANDOM_DIAGNOSTIC_PROFILE,
	type RegressionCase,
} from "./eval-types";

export function parseExactClassification(value: unknown): NoticeCategory | null {
	if (typeof value !== "string") {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value.trim());
	} catch {
		return null;
	}
	if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
		return null;
	}
	const record = parsed as Record<string, unknown>;
	if (Object.keys(record).join(",") !== "category" || !CATEGORY_SET.has(String(record.category))) {
		return null;
	}
	return record.category as NoticeCategory;
}

export function validateLabelGold(
	samples: readonly EvalSample[],
	labelGold: readonly LabelGoldEntry[],
): void {
	validateEvalSamples(samples);
	const sampleIds = new Set(samples.map((sample) => sample.notice_id));
	const labelGoldIds = new Set<number>();
	for (const entry of labelGold) {
		if (!sampleIds.has(entry.notice_id)) {
			throw new Error(`label-gold references an unknown notice: ${entry.notice_id}`);
		}
		if (labelGoldIds.has(entry.notice_id)) {
			throw new Error(`duplicate label-gold entry: ${entry.notice_id}`);
		}
		labelGoldIds.add(entry.notice_id);
		if (!CATEGORY_SET.has(entry.category)) {
			throw new Error(`label-gold has an invalid category: ${entry.notice_id}`);
		}
	}
	if (labelGoldIds.size !== sampleIds.size) {
		throw new Error("label-gold does not cover the complete eval sample");
	}
}

export function buildLabelGold(
	samples: readonly EvalSample[],
	predictions: readonly EvalPrediction[],
	labelGoldModel: string,
): LabelGoldEntry[] {
	validatePredictionRecords(samples, predictions, [labelGoldModel], () => [1]);
	const failed = samples.flatMap((sample) => {
		const prediction = resolvePredictionResult(predictions, sample.notice_id, labelGoldModel, 1);
		return prediction?.status === "ok"
			? []
			: [`${sample.notice_id} (${prediction?.status ?? "missing"})`];
	});
	if (failed.length > 0) {
		throw new Error(`label-gold model did not classify notices: ${failed.join("; ")}`);
	}
	const labelGold = samples.map((sample) => ({
		category: resolvePredictionResult(predictions, sample.notice_id, labelGoldModel, 1)
			?.category as NoticeCategory,
		notice_id: sample.notice_id,
	}));
	validateLabelGold(samples, labelGold);
	return labelGold;
}

export function validateStabilityIds(samples: readonly EvalSample[], value: unknown): number[] {
	if (!Array.isArray(value)) {
		throw new Error("stability ids must be a JSON array");
	}
	const sampleIds = new Set(samples.map((sample) => sample.notice_id));
	const ids = new Set<number>();
	for (const noticeId of value) {
		if (!(Number.isSafeInteger(noticeId) && sampleIds.has(noticeId))) {
			throw new Error(`stability ids contain an unknown notice: ${String(noticeId)}`);
		}
		if (ids.has(noticeId)) {
			throw new Error(`stability ids contain a duplicate notice: ${noticeId}`);
		}
		ids.add(noticeId);
	}
	return [...ids];
}

export function resolveCandidateStabilityIds(
	samples: readonly EvalSample[],
	value: unknown | undefined,
): number[] {
	return value === undefined ? [] : validateStabilityIds(samples, value);
}

export function validateCandidatePredictions(
	samples: readonly EvalSample[],
	predictions: readonly EvalPrediction[],
	models: readonly string[],
	stabilityIds: readonly number[],
): void {
	const validatedIds = validateStabilityIds(samples, stabilityIds);
	const stabilitySet = new Set(validatedIds);
	validatePredictionRecords(samples, predictions, models, (sample) =>
		stabilitySet.has(sample.notice_id) ? ([1, 2, 3] as const) : ([1] as const),
	);
}

export function validateRegressionPredictions(
	samples: readonly EvalSample[],
	predictions: readonly EvalPrediction[],
	models: readonly string[],
	stabilityIds: readonly number[],
): void {
	const validatedIds = validateStabilityIds(samples, stabilityIds);
	const stabilitySet = new Set(validatedIds);
	validatePredictionRecords(samples, predictions, models, (sample) =>
		stabilitySet.has(sample.notice_id) ? ([1, 2, 3] as const) : ([1] as const),
	);
}

export function validateEvalSamples(samples: readonly EvalSample[]): void {
	if (samples.length === 0) {
		throw new Error("eval sample cannot be empty");
	}
	const ids = new Set<number>();
	for (const sample of samples) {
		if (!Number.isSafeInteger(sample.notice_id) || sample.notice_id < 1) {
			throw new Error(`eval sample has an invalid notice id: ${String(sample.notice_id)}`);
		}
		if (ids.has(sample.notice_id)) {
			throw new Error(`duplicate eval sample: ${sample.notice_id}`);
		}
		ids.add(sample.notice_id);
		if (typeof sample.notice_title !== "string" || !sample.notice_title.trim()) {
			throw new Error(`eval sample has an empty title: ${sample.notice_id}`);
		}
		const validGrouping =
			(sample.split === "random" && sample.review_group === "random") ||
			(sample.split === "balanced" &&
				(sample.review_group === "category_consensus" ||
					sample.review_group === "category_disagreement")) ||
			(sample.split === "regression" && sample.review_group === "regression");
		if (!validGrouping) {
			throw new Error(`eval sample has an invalid split or review group: ${sample.notice_id}`);
		}
	}
}

export function validateRegressionCases(cases: readonly RegressionCase[]): void {
	if (cases.length === 0) {
		throw new Error("regression fixture must contain at least one case");
	}
	const caseIds = new Set<number>();
	for (const value of cases) {
		assertExactObjectKeys(
			value,
			["boundary_group", "notice_id", "notice_title", "product_expected_category", "rationale"],
			"regression case",
		);
		if (!Number.isSafeInteger(value.notice_id) || value.notice_id < 1) {
			throw new Error(`regression case has an invalid notice id: ${String(value.notice_id)}`);
		}
		if (caseIds.has(value.notice_id)) {
			throw new Error(`duplicate regression case: ${value.notice_id}`);
		}
		caseIds.add(value.notice_id);
		if (!CATEGORY_SET.has(value.product_expected_category)) {
			throw new Error(`regression case has an invalid product category: ${value.notice_id}`);
		}
		if (!(value.boundary_group.trim() && value.notice_title.trim() && value.rationale.trim())) {
			throw new Error(`regression case is missing boundary rationale: ${value.notice_id}`);
		}
	}
}

export function toRegressionSamples(cases: readonly RegressionCase[]): EvalSample[] {
	return cases.map((value) => ({
		notice_id: value.notice_id,
		notice_title: value.notice_title,
		review_group: "regression",
		split: "regression",
	}));
}

export function resolveExplicitModels(
	configuredModels: readonly string[] | undefined,
	role: string,
): string[] {
	const models = configuredModels?.map((model) => model.trim()) ?? [];
	validateModelList(models, role);
	return models;
}

export function assertExactObjectKeys(
	value: unknown,
	expectedKeys: readonly string[],
	name: string,
): asserts value is Record<string, unknown> {
	if (!(value && typeof value === "object" && !Array.isArray(value))) {
		throw new Error(`${name} must be an object`);
	}
	const actualKeys = Object.keys(value).sort();
	const sortedExpectedKeys = [...expectedKeys].sort();
	if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpectedKeys)) {
		throw new Error(`${name} contains unsupported fields: ${actualKeys.join(",")}`);
	}
}

export function validatePredictionRecords(
	samples: readonly EvalSample[],
	predictions: readonly EvalPrediction[],
	models: readonly string[],
	expectedRepeatsForSample: (sample: EvalSample) => readonly (1 | 2 | 3)[],
): void {
	validateEvalSamples(samples);
	validateModelList(models, "prediction");
	const sampleIds = new Set(samples.map((sample) => sample.notice_id));
	const modelSet = new Set(models);
	const expectedTasks = new Set<string>();
	for (const model of models) {
		for (const sample of samples) {
			for (const repeat of expectedRepeatsForSample(sample)) {
				expectedTasks.add(`${model}:${sample.notice_id}:${repeat}`);
			}
		}
	}
	const actualTasks = new Set<string>();
	for (const prediction of predictions) {
		if (!sampleIds.has(prediction.notice_id)) {
			throw new Error(`prediction references an unknown notice: ${prediction.notice_id}`);
		}
		if (!modelSet.has(prediction.model)) {
			throw new Error(`prediction references an unknown model: ${prediction.model}`);
		}
		if (prediction.attempt !== 1 || !isClassificationRepeat(prediction.repeat)) {
			throw new Error(`prediction must contain one direct attempt: ${prediction.notice_id}`);
		}
		const taskKey = `${prediction.model}:${prediction.notice_id}:${prediction.repeat}`;
		if (!expectedTasks.has(taskKey)) {
			throw new Error(`prediction references an unrequested task: ${taskKey}`);
		}
		if (actualTasks.has(taskKey)) {
			throw new Error(`duplicate prediction: ${taskKey}`);
		}
		actualTasks.add(taskKey);
		if (
			prediction.status !== "ok" &&
			prediction.status !== "invalid_output" &&
			prediction.status !== "provider_error"
		) {
			throw new Error(`prediction has an invalid status: ${taskKey}`);
		}
		if (prediction.status === "ok") {
			if (!(prediction.category && CATEGORY_SET.has(prediction.category))) {
				throw new Error(`successful prediction has an invalid category: ${taskKey}`);
			}
			if (typeof prediction.raw_response !== "string" || prediction.raw_response.length === 0) {
				throw new Error(`successful prediction has no raw response: ${taskKey}`);
			}
		} else {
			if (prediction.category !== null) {
				throw new Error(`failed prediction has a category: ${taskKey}`);
			}
			if (!prediction.error) {
				throw new Error(`failed prediction has no raw error evidence: ${taskKey}`);
			}
			if (prediction.status === "invalid_output" && prediction.raw_response === undefined) {
				throw new Error(`invalid output prediction has no raw response: ${taskKey}`);
			}
			if (prediction.status === "provider_error" && prediction.raw_response !== undefined) {
				throw new Error(`provider error prediction contains a model response: ${taskKey}`);
			}
		}
		if (!Number.isFinite(prediction.elapsed_ms) || prediction.elapsed_ms < 0) {
			throw new Error(`prediction has an invalid elapsed time: ${taskKey}`);
		}
	}
	for (const taskKey of expectedTasks) {
		if (!actualTasks.has(taskKey)) {
			throw new Error(`missing prediction: ${taskKey}`);
		}
	}
}

function isClassificationRepeat(value: number): value is 1 | 2 | 3 {
	return value === 1 || value === 2 || value === 3;
}

export function resolvePredictionResult(
	predictions: readonly EvalPrediction[],
	noticeId: number,
	model: string,
	repeat: 1 | 2 | 3,
): EvalPrediction | undefined {
	return predictions.find(
		(prediction) =>
			prediction.notice_id === noticeId &&
			prediction.model === model &&
			prediction.repeat === repeat,
	);
}

export function inferStabilityIds(predictions: readonly EvalPrediction[]): number[] {
	return [
		...new Set(
			predictions
				.filter((prediction) => prediction.repeat !== 1)
				.map((prediction) => prediction.notice_id),
		),
	].sort((left, right) => left - right);
}

export function predictionModels(predictions: readonly EvalPrediction[]): string[] {
	const models = [...new Set(predictions.map((prediction) => prediction.model))].sort();
	validateModelList(models, "prediction");
	return models;
}

function validateModelList(models: readonly string[], name: string): void {
	if (models.length === 0) {
		throw new Error(`${name} model list cannot be empty`);
	}
	if (models.some((model) => !model)) {
		throw new Error(`${name} model list contains an empty model`);
	}
	if (new Set(models).size !== models.length) {
		throw new Error(`${name} model list contains duplicates`);
	}
}

export function inferEvalProfile(samples: readonly EvalSample[]): EvalProfile {
	validateEvalSamples(samples);
	if (samples.some((sample) => sample.split === "regression")) {
		throw new Error("regression samples do not use a candidate eval profile");
	}
	return samples.some((sample) => sample.split === "balanced")
		? BALANCED_DIAGNOSTIC_PROFILE
		: RANDOM_DIAGNOSTIC_PROFILE;
}
