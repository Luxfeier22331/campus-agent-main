import type { NoticeCategory } from "@campus-agent/notices";
import { calculateModelMetrics, ratio } from "./eval-metrics";
import type {
	EvalPrediction,
	RegressionCase,
	RegressionCaseResult,
	RegressionEvaluationCheckResult,
	RegressionModelCaseResult,
	RegressionRepeatResult,
} from "./eval-types";
import {
	inferStabilityIds,
	resolvePredictionResult,
	toRegressionSamples,
	validateEvalSamples,
	validateRegressionCases,
	validateRegressionPredictions,
} from "./eval-validation";

export function buildRegressionEvaluationCheckResult(
	cases: readonly RegressionCase[],
	predictions: readonly EvalPrediction[],
	models: readonly string[],
	stabilityIds: readonly number[] = inferStabilityIds(predictions),
): RegressionEvaluationCheckResult {
	validateRegressionCases(cases);
	const samples = toRegressionSamples(cases);
	validateEvalSamples(samples);
	validateRegressionPredictions(samples, predictions, models, stabilityIds);
	const stabilitySet = new Set(stabilityIds);
	const caseResults = cases.map(
		(value): RegressionCaseResult => ({
			boundary_group: value.boundary_group,
			models: Object.fromEntries(
				models.map((model) => {
					const repeats = stabilitySet.has(value.notice_id) ? ([1, 2, 3] as const) : ([1] as const);
					const repeatResults = repeats.map((repeat) =>
						toRegressionRepeatResult(
							resolvePredictionResult(predictions, value.notice_id, model, repeat),
							value.product_expected_category,
						),
					);
					const repeated = repeats.length === 3;
					const repeatComplete = repeated
						? repeatResults.every((result) => result.status === "ok")
						: null;
					return [
						model,
						{
							primary: repeatResults[0] as RegressionRepeatResult,
							repeat_complete: repeatComplete,
							repeat_results: repeatResults,
							stable_complete:
								repeatComplete === null
									? null
									: repeatComplete &&
										new Set(repeatResults.map((result) => result.category)).size === 1,
						},
					];
				}),
			) as Record<string, RegressionModelCaseResult>,
			notice_id: value.notice_id,
			notice_title: value.notice_title,
			product_expected_category: value.product_expected_category,
		}),
	);
	const modelResults = Object.fromEntries(
		models.map((model) => {
			const agreement = calculateRegressionAgreement(cases, predictions, model);
			const metrics = calculateModelMetrics(predictions, model, stabilityIds);
			return [
				model,
				{
					outcomes: metrics.outcomes,
					primary_agreement: {
						agreed: agreement.agreed,
						rate: ratio(agreement.agreed, agreement.scoreable),
						scoreable: agreement.scoreable,
					},
					repeat: metrics.repeat,
				},
			];
		}),
	) as RegressionEvaluationCheckResult["models"];
	return {
		candidate_models: [...models],
		cases: caseResults,
		evidence_status: Object.values(modelResults).every(
			(value) => value.outcomes.provider_error_count === 0,
		)
			? "complete"
			: "partial",
		models: modelResults,
		regression_case_count: cases.length,
		stability_case_count: stabilityIds.length,
	};
}
function calculateRegressionAgreement(
	cases: readonly RegressionCase[],
	predictions: readonly EvalPrediction[],
	model: string,
): { agreed: number; scoreable: number } {
	let agreed = 0;
	let scoreable = 0;
	for (const value of cases) {
		const outcome = resolvePredictionResult(predictions, value.notice_id, model, 1);
		if (outcome?.status !== "ok") {
			continue;
		}
		scoreable += 1;
		if (outcome.category === value.product_expected_category) {
			agreed += 1;
		}
	}
	return { agreed, scoreable };
}

function toRegressionRepeatResult(
	prediction: EvalPrediction | undefined,
	expected: NoticeCategory,
): RegressionRepeatResult {
	return {
		category: prediction?.category ?? null,
		matches_product_expected: prediction?.status === "ok" ? prediction.category === expected : null,
		status: prediction?.status ?? "provider_error",
	};
}
