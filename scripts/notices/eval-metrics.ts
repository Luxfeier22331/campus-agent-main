import { NOTICE_CATEGORIES, type NoticeCategory } from "@campus-agent/notices";

import type {
	CandidateEvaluationCheckResult,
	CandidateEvaluationReport,
	CategoryAgreementMetrics,
	EvalPrediction,
	EvalProfile,
	EvalSample,
	LabelGoldEntry,
	ModelEvaluationMetrics,
	ModelOutcomeMetrics,
	RepeatMetrics,
} from "./eval-types";
import {
	inferEvalProfile,
	inferStabilityIds,
	predictionModels,
	resolvePredictionResult,
	validateCandidatePredictions,
	validateLabelGold,
} from "./eval-validation";

export function buildCandidateEvaluationReport(
	samples: readonly EvalSample[],
	labelGold: readonly LabelGoldEntry[],
	predictions: readonly EvalPrediction[],
	profile: EvalProfile = inferEvalProfile(samples),
): CandidateEvaluationReport {
	validateLabelGold(samples, labelGold);
	const models = predictionModels(predictions);
	const stabilityIds = inferStabilityIds(predictions);
	validateCandidatePredictions(samples, predictions, models, stabilityIds);
	const labelGoldById = new Map(labelGold.map((entry) => [entry.notice_id, entry]));
	const metricsFor = (
		filter: (sample: EvalSample) => boolean,
	): Record<string, CategoryAgreementMetrics> =>
		Object.fromEntries(
			models.map((model) => [
				model,
				calculateCategoryAgreementMetrics(
					samples.filter(filter),
					labelGoldById,
					resolveModelPredictions(samples, predictions, model),
				),
			]),
		);
	return {
		agreement: {
			all: metricsFor(() => true),
			balanced: metricsFor((sample) => sample.split === "balanced"),
			random: metricsFor((sample) => sample.split === "random"),
		},
		generated_at: new Date().toISOString(),
		models: Object.fromEntries(
			models.map((model) => [model, calculateModelMetrics(predictions, model, stabilityIds)]),
		),
		profile,
	};
}

export function buildCandidateEvaluationCheckResult(
	report: CandidateEvaluationReport,
): CandidateEvaluationCheckResult {
	return {
		...report,
		evidence_status: Object.values(report.models).every(
			(metrics) => metrics.outcomes.provider_error_count === 0,
		)
			? "complete"
			: "partial",
	};
}

function calculateCategoryAgreementMetrics(
	samples: readonly EvalSample[],
	labelGold: ReadonlyMap<number, LabelGoldEntry>,
	predictions: ReadonlyMap<number, EvalPrediction>,
): CategoryAgreementMetrics {
	const counters = Object.fromEntries(
		NOTICE_CATEGORIES.map((category) => [category, { fn: 0, fp: 0, support: 0, tp: 0 }]),
	) as Record<NoticeCategory, { fn: number; fp: number; support: number; tp: number }>;
	const confusion: Record<string, Record<string, number>> = {};
	let agreed = 0;
	let scoreable = 0;
	let invalidOutputCount = 0;
	let providerErrorCount = 0;
	for (const sample of samples) {
		const expected = labelGold.get(sample.notice_id)?.category;
		const prediction = predictions.get(sample.notice_id);
		if (!(expected && prediction) || prediction.status === "provider_error") {
			providerErrorCount += 1;
			continue;
		}
		if (prediction.status === "invalid_output") {
			invalidOutputCount += 1;
			continue;
		}
		const actual = prediction.category;
		if (!actual) {
			throw new Error(`successful prediction has no category: ${sample.notice_id}`);
		}
		scoreable += 1;
		counters[expected].support += 1;
		confusion[expected] ??= {};
		confusion[expected][actual] = (confusion[expected][actual] ?? 0) + 1;
		if (actual === expected) {
			agreed += 1;
			counters[expected].tp += 1;
		} else {
			counters[expected].fn += 1;
			counters[actual].fp += 1;
		}
	}
	const perCategory: CategoryAgreementMetrics["per_category"] = {};
	const f1Values: number[] = [];
	for (const category of NOTICE_CATEGORIES) {
		const values = counters[category];
		const precision = ratio(values.tp, values.tp + values.fp);
		const recall = ratio(values.tp, values.tp + values.fn);
		const f1 =
			precision === null || recall === null || precision + recall === 0
				? precision === 0 || recall === 0
					? 0
					: null
				: (2 * precision * recall) / (precision + recall);
		if (values.support > 0 && f1 !== null) {
			f1Values.push(f1);
		}
		perCategory[category] = { f1, precision, recall, support: values.support };
	}
	return {
		agreed,
		agreement_rate: ratio(agreed, scoreable),
		confusion,
		invalid_output_count: invalidOutputCount,
		macro_f1: f1Values.length > 0 ? average(f1Values) : null,
		per_category: perCategory,
		provider_error_count: providerErrorCount,
		scoreable,
	};
}

function resolveModelPredictions(
	samples: readonly EvalSample[],
	predictions: readonly EvalPrediction[],
	model: string,
): ReadonlyMap<number, EvalPrediction> {
	return new Map(
		samples.map((sample) => [
			sample.notice_id,
			resolvePredictionResult(predictions, sample.notice_id, model, 1) as EvalPrediction,
		]),
	);
}

export function calculateModelMetrics(
	predictions: readonly EvalPrediction[],
	model: string,
	stabilityIds: readonly number[],
): ModelEvaluationMetrics {
	const values = predictions.filter((prediction) => prediction.model === model);
	return {
		latency_p50_ms: percentile(
			values.map((prediction) => prediction.elapsed_ms),
			0.5,
		),
		latency_p90_ms: percentile(
			values.map((prediction) => prediction.elapsed_ms),
			0.9,
		),
		outcomes: buildOutcomeMetrics(values),
		repeat: calculateRepeatMetrics(values, model, stabilityIds),
	};
}

function buildOutcomeMetrics(predictions: readonly EvalPrediction[]): ModelOutcomeMetrics {
	const okCount = predictions.filter((prediction) => prediction.status === "ok").length;
	const invalidOutputCount = predictions.filter(
		(prediction) => prediction.status === "invalid_output",
	).length;
	const providerErrorCount = predictions.filter(
		(prediction) => prediction.status === "provider_error",
	).length;
	const responseReceivedCount = okCount + invalidOutputCount;
	return {
		invalid_output_count: invalidOutputCount,
		ok_count: okCount,
		provider_error_count: providerErrorCount,
		provider_error_rate: ratio(providerErrorCount, predictions.length),
		response_received_count: responseReceivedCount,
		response_valid_rate: ratio(okCount, responseReceivedCount),
		total_task_count: predictions.length,
	};
}

function calculateRepeatMetrics(
	predictions: readonly EvalPrediction[],
	model: string,
	stabilityIds: readonly number[],
): RepeatMetrics {
	let repeatCompleteCount = 0;
	let stableCompleteCount = 0;
	for (const noticeId of stabilityIds) {
		const outcomes = ([1, 2, 3] as const).map((repeat) =>
			resolvePredictionResult(predictions, noticeId, model, repeat),
		);
		const complete = outcomes.every((outcome) => outcome?.status === "ok");
		if (complete) {
			repeatCompleteCount += 1;
			if (new Set(outcomes.map((outcome) => outcome?.category)).size === 1) {
				stableCompleteCount += 1;
			}
		}
	}
	return {
		repeat_complete_count: repeatCompleteCount,
		repeat_incomplete_count: stabilityIds.length - repeatCompleteCount,
		selected_repeat_consistency: ratio(stableCompleteCount, repeatCompleteCount),
		stable_complete_count: stableCompleteCount,
	};
}

export function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

function average(values: readonly number[]): number {
	return sum(values) / values.length;
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function percentile(values: readonly number[], percentileValue: number): number | null {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue))] ?? null;
}
