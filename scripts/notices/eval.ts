import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NOTICE_CATEGORIES, type NoticeCategory } from "@campus-agent/notices";
import OpenAI, { APIConnectionError, APIError } from "openai";
import { formatRawError } from "../../packages/ingestion-contracts/src/raw-error";
import type { NoticeClassificationTask } from "../../packages/notice-classifier-core/src/batch";
import {
	NoticeClassificationInvalidOutputError,
	NoticeClassificationProviderError,
} from "./classifier";
import { mapWithConcurrency } from "./concurrency";
import {
	createNoticeModelFetch,
	createOpenAINoticeModelClassifierWithRawResponse,
	isRetryableNoticeProviderCause,
	NOTICE_CLASSIFIER_SYSTEM_PROMPT,
	NOTICE_CLASSIFIER_TEMPERATURE,
	resolveNoticeClassifierGatewayConfig,
	toModelInput,
} from "./model";
import {
	createNoticeSourceObjectStoreFromEnv,
	listNoticeSourceIds,
	loadLocalNoticeSourceEnvironment,
	loadNoticeClassificationInputs,
} from "./source";

export const BALANCED_DIAGNOSTIC_PROFILE = "balanced_diagnostic_v1";
export const RANDOM_DIAGNOSTIC_PROFILE = "random_diagnostic_v1";

type ConcreteNoticeCategory = Exclude<NoticeCategory, "unclassified">;

const CONCRETE_CATEGORIES = NOTICE_CATEGORIES.filter(
	(category): category is ConcreteNoticeCategory => category !== "unclassified",
);
const CONCRETE_CATEGORY_SET = new Set<string>(CONCRETE_CATEGORIES);
const CATEGORY_SET = new Set<string>(NOTICE_CATEGORIES);
const EXACT_CLASSIFICATION_INSTRUCTION =
	'只输出单行 JSON 对象，且只能包含 category 字段，例如 {"category":"campus_operations"}。不要输出 Markdown、解释或其他文字。';
const CLASSIFICATION_SYSTEM_PROMPT = `${NOTICE_CLASSIFIER_SYSTEM_PROMPT}\n${EXACT_CLASSIFICATION_INSTRUCTION}`;
const CHAT_COMPLETIONS_INFERENCE_API = "chat.completions";
const RESPONSES_INFERENCE_API = "responses";

export type EvalProfile = typeof BALANCED_DIAGNOSTIC_PROFILE | typeof RANDOM_DIAGNOSTIC_PROFILE;
export type EvalSplit = "balanced" | "random" | "regression";
export type EvalReviewGroup =
	| "category_consensus"
	| "category_disagreement"
	| "regression"
	| "random";
export type PredictionStatus = "invalid_output" | "ok" | "provider_error";

export interface EvalSample {
	notice_id: number;
	notice_title: string;
	review_group: EvalReviewGroup;
	split: EvalSplit;
}

export interface LabelGoldEntry {
	category: NoticeCategory;
	notice_id: number;
}

export interface EvalPrediction {
	attempt: 1;
	category: NoticeCategory | null;
	elapsed_ms: number;
	error?: string;
	model: string;
	notice_id: number;
	raw_response?: string;
	repeat: 1 | 2 | 3;
	status: PredictionStatus;
}

export type StratificationPrediction = EvalPrediction;

export interface EvalSampleOptions {
	categoryCount: number;
	categoryCountOverrides?: Partial<Record<ConcreteNoticeCategory, number>>;
	randomCount: number;
	seed: string;
	stratificationModels: readonly string[];
}

export interface RegressionCase {
	boundary_group: string;
	notice_id: number;
	notice_title: string;
	product_expected_category: NoticeCategory;
	rationale: string;
}

interface RegressionFixture {
	cases: RegressionCase[];
}

interface RegressionEvidence {
	cases: RegressionCase[];
	samples: EvalSample[];
}

interface CategoryAgreementMetrics {
	agreed: number;
	agreement_rate: number | null;
	confusion: Record<string, Record<string, number>>;
	invalid_output_count: number;
	macro_f1: number | null;
	per_category: Record<
		string,
		{ f1: number | null; precision: number | null; recall: number | null; support: number }
	>;
	provider_error_count: number;
	scoreable: number;
}

interface ModelOutcomeMetrics {
	invalid_output_count: number;
	ok_count: number;
	provider_error_count: number;
	provider_error_rate: number | null;
	response_received_count: number;
	response_valid_rate: number | null;
	total_task_count: number;
}

interface RepeatMetrics {
	repeat_complete_count: number;
	repeat_incomplete_count: number;
	selected_repeat_consistency: number | null;
	stable_complete_count: number;
}

interface ModelEvaluationMetrics {
	latency_p50_ms: number | null;
	latency_p90_ms: number | null;
	outcomes: ModelOutcomeMetrics;
	repeat: RepeatMetrics;
}

interface AgreementBySample {
	all: Record<string, CategoryAgreementMetrics>;
	balanced: Record<string, CategoryAgreementMetrics>;
	random: Record<string, CategoryAgreementMetrics>;
}

export interface CandidateEvaluationReport {
	agreement: AgreementBySample;
	generated_at: string;
	models: Record<string, ModelEvaluationMetrics>;
	profile: EvalProfile;
}

export interface CandidateEvaluationCheckResult extends CandidateEvaluationReport {
	evidence_status: "complete" | "partial";
}

interface RegressionRepeatResult {
	category: NoticeCategory | null;
	matches_product_expected: boolean | null;
	status: PredictionStatus;
}

interface RegressionModelCaseResult {
	primary: RegressionRepeatResult;
	repeat_complete: boolean | null;
	repeat_results: RegressionRepeatResult[];
	stable_complete: boolean | null;
}

interface RegressionCaseResult {
	boundary_group: string;
	models: Record<string, RegressionModelCaseResult>;
	notice_id: number;
	notice_title: string;
	product_expected_category: NoticeCategory;
}

export interface RegressionEvaluationCheckResult {
	candidate_models: string[];
	cases: RegressionCaseResult[];
	evidence_status: "complete" | "partial";
	models: Record<
		string,
		{
			outcomes: ModelOutcomeMetrics;
			primary_agreement: { agreed: number; rate: number | null; scoreable: number };
			repeat: RepeatMetrics;
		}
	>;
	regression_case_count: number;
	stability_case_count: number;
}

interface StratificationSummary {
	categories: ReadonlySet<NoticeCategory>;
	consensus: NoticeCategory | null;
	disagreement: boolean;
}

interface SelectedInput {
	input: NoticeClassificationTask;
	reviewGroup: EvalReviewGroup;
}

export interface EvaluationAttemptOptions {
	invoke: () => Promise<{
		category: NoticeCategory;
		raw_response: string;
	}>;
	model: string;
	notice_id: number;
	repeat: 1 | 2 | 3;
}

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

export function buildEvalSample(
	inputs: readonly NoticeClassificationTask[],
	predictions: readonly StratificationPrediction[],
	options: EvalSampleOptions,
): EvalSample[] {
	if (options.randomCount < 1 || options.categoryCount < 1) {
		throw new Error("eval sample counts must be positive");
	}
	const categoryCounts = resolveCategoryCounts(options);
	const inputIds = new Set<number>();
	for (const input of inputs) {
		if (inputIds.has(input.noticeId)) {
			throw new Error(`duplicate notice input: ${input.noticeId}`);
		}
		inputIds.add(input.noticeId);
	}
	const summaries = summarizeStratification(inputs, predictions, options.stratificationModels);
	const randomInputs = rankByHash(inputs, options.seed, "random").slice(0, options.randomCount);
	if (randomInputs.length !== options.randomCount) {
		throw new Error("not enough inputs for the random sample");
	}
	const selectedIds = new Set(randomInputs.map((input) => input.noticeId));
	const selected: SelectedInput[] = randomInputs.map((input) => ({
		input,
		reviewGroup: "random",
	}));
	const candidates = inputs.filter((input) => !selectedIds.has(input.noticeId));
	const categoryOrder = [...CONCRETE_CATEGORIES].sort((left, right) => {
		const leftSlack = countCategoryCandidates(candidates, summaries, left) - categoryCounts[left];
		const rightSlack =
			countCategoryCandidates(candidates, summaries, right) - categoryCounts[right];
		return (
			leftSlack - rightSlack ||
			CONCRETE_CATEGORIES.indexOf(left) - CONCRETE_CATEGORIES.indexOf(right)
		);
	});

	for (const category of categoryOrder) {
		const categoryCount = categoryCounts[category];
		const consensusTarget = Math.ceil(categoryCount / 2);
		const disagreementTarget = Math.floor(categoryCount / 3);
		const categorySelected: SelectedInput[] = [];
		selectFromPool(
			candidates.filter((input) => summaries.get(input.noticeId)?.consensus === category),
			consensusTarget,
			"category_consensus",
			categorySelected,
			selectedIds,
			options.seed,
			`${category}:consensus`,
		);
		selectFromPool(
			candidates.filter((input) => {
				const summary = summaries.get(input.noticeId);
				return summary?.disagreement === true && summary.categories.has(category);
			}),
			disagreementTarget,
			"category_disagreement",
			categorySelected,
			selectedIds,
			options.seed,
			`${category}:disagreement`,
		);
		selectFromPool(
			candidates.filter(
				(input) => summaries.get(input.noticeId)?.categories.has(category) === true,
			),
			categoryCount - categorySelected.length,
			"category_consensus",
			categorySelected,
			selectedIds,
			options.seed,
			`${category}:fill`,
		);
		if (categorySelected.length !== categoryCount) {
			throw new Error(`not enough stratification candidates for category: ${category}`);
		}
		selected.push(...categorySelected);
	}

	return selected
		.map(({ input, reviewGroup }) =>
			toEvalSample(input, reviewGroup === "random" ? "random" : "balanced", reviewGroup),
		)
		.sort(
			(left, right) =>
				hashRank(options.seed, "review-order", left.notice_id).localeCompare(
					hashRank(options.seed, "review-order", right.notice_id),
				) || left.notice_id - right.notice_id,
		);
}

export function selectRandomDiagnosticIds(
	sourceIds: readonly number[],
	excludedIds: ReadonlySet<number>,
	count: number,
	seed: string,
): number[] {
	if (!Number.isSafeInteger(count) || count < 1) {
		throw new Error("diagnostic sample count must be a positive integer");
	}
	const uniqueIds = new Set<number>();
	for (const noticeId of sourceIds) {
		if (!Number.isSafeInteger(noticeId) || noticeId < 1) {
			throw new Error(`source contains an invalid notice id: ${String(noticeId)}`);
		}
		if (uniqueIds.has(noticeId)) {
			throw new Error(`source contains a duplicate notice id: ${noticeId}`);
		}
		uniqueIds.add(noticeId);
	}
	const selected = [...uniqueIds]
		.filter((noticeId) => !excludedIds.has(noticeId))
		.sort(
			(left, right) =>
				hashRank(seed, "random", left).localeCompare(hashRank(seed, "random", right)) ||
				left - right,
		)
		.slice(0, count);
	if (selected.length !== count) {
		throw new Error(`expected ${count} unseen notices, found ${selected.length}`);
	}
	return selected;
}

export function buildRandomDiagnosticSample(
	inputs: readonly NoticeClassificationTask[],
	seed: string,
): EvalSample[] {
	if (new Set(inputs.map((input) => input.noticeId)).size !== inputs.length) {
		throw new Error("diagnostic inputs contain duplicate notice ids");
	}
	return inputs
		.map((input) => toEvalSample(input, "random", "random"))
		.sort(
			(left, right) =>
				hashRank(seed, "review-order", left.notice_id).localeCompare(
					hashRank(seed, "review-order", right.notice_id),
				) || left.notice_id - right.notice_id,
		);
}

export function parseCategoryCountOverrides(
	values: readonly string[],
): Partial<Record<ConcreteNoticeCategory, number>> {
	const overrides: Partial<Record<ConcreteNoticeCategory, number>> = {};
	for (const value of values) {
		const match = /^([a-z_]+)=([1-9][0-9]*)$/u.exec(value.trim());
		if (!match) {
			throw new Error("--category-count-override must use category=positive-integer");
		}
		const category = match[1];
		if (!(category && CONCRETE_CATEGORY_SET.has(category))) {
			throw new Error(`--category-count-override contains an invalid category: ${category}`);
		}
		const concreteCategory = category as ConcreteNoticeCategory;
		if (overrides[concreteCategory] !== undefined) {
			throw new Error(`duplicate category count override: ${concreteCategory}`);
		}
		overrides[concreteCategory] = Number(match[2]);
	}
	return overrides;
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

function validateRegressionPredictions(
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

function validatePredictionRecords(
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

function validateEvalSamples(samples: readonly EvalSample[]): void {
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

function isClassificationRepeat(value: number): value is 1 | 2 | 3 {
	return value === 1 || value === 2 || value === 3;
}

function summarizeStratification(
	inputs: readonly NoticeClassificationTask[],
	predictions: readonly StratificationPrediction[],
	stratificationModels: readonly string[],
): Map<number, StratificationSummary> {
	const samples = inputs.map((input) => toEvalSample(input, "random", "random"));
	validatePredictionRecords(samples, predictions, stratificationModels, () => [1]);
	const summaries = new Map<number, StratificationSummary>();
	for (const input of inputs) {
		const categories = predictions.flatMap((prediction) =>
			prediction.notice_id === input.noticeId && prediction.status === "ok" && prediction.category
				? [prediction.category]
				: [],
		);
		summaries.set(input.noticeId, {
			categories: new Set(categories),
			consensus:
				categories.length === stratificationModels.length && new Set(categories).size === 1
					? (categories[0] ?? null)
					: null,
			disagreement:
				categories.length === stratificationModels.length && new Set(categories).size > 1,
		});
	}
	return summaries;
}

function resolveCategoryCounts(
	options: Pick<EvalSampleOptions, "categoryCount" | "categoryCountOverrides">,
): Record<ConcreteNoticeCategory, number> {
	return Object.fromEntries(
		CONCRETE_CATEGORIES.map((category) => {
			const count = options.categoryCountOverrides?.[category] ?? options.categoryCount;
			if (!Number.isInteger(count) || count < 1) {
				throw new Error(`category sample count must be a positive integer: ${category}`);
			}
			return [category, count];
		}),
	) as Record<ConcreteNoticeCategory, number>;
}

function countCategoryCandidates(
	inputs: readonly NoticeClassificationTask[],
	summaries: ReadonlyMap<number, StratificationSummary>,
	category: ConcreteNoticeCategory,
): number {
	return inputs.filter((input) => summaries.get(input.noticeId)?.categories.has(category) === true)
		.length;
}

function selectFromPool(
	pool: readonly NoticeClassificationTask[],
	count: number,
	reviewGroup: EvalReviewGroup,
	selected: SelectedInput[],
	selectedIds: Set<number>,
	seed: string,
	scope: string,
): void {
	if (count <= 0) {
		return;
	}
	let remaining = count;
	for (const input of rankByHash(pool, seed, scope)) {
		if (selectedIds.has(input.noticeId)) {
			continue;
		}
		selectedIds.add(input.noticeId);
		selected.push({ input, reviewGroup });
		remaining -= 1;
		if (remaining === 0) {
			break;
		}
	}
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

function resolvePredictionResult(
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

function calculateModelMetrics(
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

function toRegressionSamples(cases: readonly RegressionCase[]): EvalSample[] {
	return cases.map((value) => ({
		notice_id: value.notice_id,
		notice_title: value.notice_title,
		review_group: "regression",
		split: "regression",
	}));
}

function validateRegressionCases(cases: readonly RegressionCase[]): void {
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

function inferStabilityIds(predictions: readonly EvalPrediction[]): number[] {
	return [
		...new Set(
			predictions
				.filter((prediction) => prediction.repeat !== 1)
				.map((prediction) => prediction.notice_id),
		),
	].sort((left, right) => left - right);
}

function predictionModels(predictions: readonly EvalPrediction[]): string[] {
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

export function resolveExplicitModels(
	configuredModels: readonly string[] | undefined,
	role: string,
): string[] {
	const models = configuredModels?.map((model) => model.trim()) ?? [];
	validateModelList(models, role);
	return models;
}

function inferEvalProfile(samples: readonly EvalSample[]): EvalProfile {
	validateEvalSamples(samples);
	if (samples.some((sample) => sample.split === "regression")) {
		throw new Error("regression samples do not use a candidate eval profile");
	}
	return samples.some((sample) => sample.split === "balanced")
		? BALANCED_DIAGNOSTIC_PROFILE
		: RANDOM_DIAGNOSTIC_PROFILE;
}

async function runStratifyCommand(options: EvalCliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const predictionsPath = resolve(directory, "strata-predictions.jsonl");
	const excludedIds = await readExcludedIds(options);
	const concurrency = positiveIntegerOption(options, "concurrency", 2);
	const timeoutMs = positiveIntegerOption(options, "timeout-ms", 60_000);
	const models = resolveExplicitModels(options.model, "stratification");
	const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
	loadLocalNoticeSourceEnvironment(repositoryRoot);
	const store = createNoticeSourceObjectStoreFromEnv();
	let inputs: NoticeClassificationTask[];
	try {
		const sourceIds = await listNoticeSourceIds(store);
		inputs = await loadNoticeClassificationInputs(
			store,
			sourceIds.filter((id) => !excludedIds.has(id)),
			{ concurrency: 4 },
		);
	} finally {
		store.close();
	}
	const gateway = resolveNoticeClassifierGatewayConfig(process.env);
	const client = new OpenAI({
		apiKey: gateway.apiKey,
		baseURL: gateway.baseUrl,
		fetch: createNoticeModelFetch(),
		maxRetries: 0,
		timeout: timeoutMs,
	});
	const tasks = inputs.flatMap((input) => models.map((model) => ({ input, model })));
	let completed = 0;
	const predictions = await mapWithConcurrency(tasks, concurrency, async ({ input, model }) => {
		const prediction = await classifyForStratification(client, model, input);
		completed += 1;
		if (completed % 60 === 0 || completed === tasks.length) {
			process.stderr.write(`stratification progress ${completed}/${tasks.length}\n`);
		}
		return prediction;
	});
	await mkdir(directory, { recursive: true });
	await writeJsonLines(predictionsPath, predictions);
	process.stdout.write(
		`${JSON.stringify({ eligible_count: inputs.length, inference_api: CHAT_COMPLETIONS_INFERENCE_API, models, predictions: predictions.length, temperature: NOTICE_CLASSIFIER_TEMPERATURE })}\n`,
	);
}

async function runSampleCommand(options: EvalCliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const samplePath = resolve(directory, "sample.jsonl");
	const predictions = await readJsonLines<StratificationPrediction>(
		resolve(directory, "strata-predictions.jsonl"),
	);
	const models = predictionModels(predictions);
	const noticeIds = [...new Set(predictions.map((prediction) => prediction.notice_id))].sort(
		(left, right) => left - right,
	);
	const randomCount = requiredPositiveIntegerOption(options, "random-count");
	const categoryCount = requiredPositiveIntegerOption(options, "category-count");
	const categoryCountOverrides = parseCategoryCountOverrides(
		options["category-count-override"] ?? [],
	);
	const seed = requiredOption(options, "seed");
	const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
	loadLocalNoticeSourceEnvironment(repositoryRoot);
	const store = createNoticeSourceObjectStoreFromEnv();
	let inputs: NoticeClassificationTask[];
	try {
		inputs = await loadNoticeClassificationInputs(store, noticeIds, { concurrency: 4 });
	} finally {
		store.close();
	}
	const samples = buildEvalSample(inputs, predictions, {
		categoryCount,
		categoryCountOverrides,
		randomCount,
		seed,
		stratificationModels: models,
	});
	await mkdir(directory, { recursive: true });
	await writeJsonLines(samplePath, samples);
	process.stdout.write(
		`${JSON.stringify({ profile: BALANCED_DIAGNOSTIC_PROFILE, sample_count: samples.length, seed })}\n`,
	);
}

async function runRandomSampleCommand(options: EvalCliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const samplePath = resolve(directory, "sample.jsonl");
	const count = requiredPositiveIntegerOption(options, "count");
	const seed = requiredOption(options, "seed");
	const concurrency = positiveIntegerOption(options, "concurrency", 2);
	const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
	const excludedIds = await readExcludedIds(options);
	loadLocalNoticeSourceEnvironment(repositoryRoot);
	const store = createNoticeSourceObjectStoreFromEnv();
	let inputs: NoticeClassificationTask[];
	let sourceCount = 0;
	try {
		const sourceIds = await listNoticeSourceIds(store);
		sourceCount = sourceIds.length;
		const selectedIds = selectRandomDiagnosticIds(sourceIds, excludedIds, count, seed);
		inputs = await loadNoticeClassificationInputs(store, selectedIds, { concurrency });
	} finally {
		store.close();
	}
	const samples = buildRandomDiagnosticSample(inputs, seed);
	await mkdir(directory, { recursive: true });
	await writeJsonLines(samplePath, samples);
	process.stdout.write(
		`${JSON.stringify({ excluded: excludedIds.size, profile: RANDOM_DIAGNOSTIC_PROFILE, sample_count: samples.length, seed, source_count: sourceCount })}\n`,
	);
}

async function runGenerateLabelGoldCommand(options: EvalCliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const samples = await loadEvaluationSample(directory);
	const models = resolveExplicitModels(options.model, "label-gold");
	if (models.length !== 1) {
		throw new Error("generating label-gold requires exactly one model");
	}
	const model = models[0] as string;
	const concurrency = positiveIntegerOption(options, "concurrency", 2);
	const timeoutMs = positiveIntegerOption(options, "timeout-ms", 60_000);
	const gateway = resolveNoticeClassifierGatewayConfig(process.env);
	const client = new OpenAI({
		apiKey: gateway.apiKey,
		baseURL: gateway.baseUrl,
		fetch: createNoticeModelFetch(),
		maxRetries: 0,
		timeout: timeoutMs,
	});
	let completed = 0;
	const predictions = await mapWithConcurrency(samples, concurrency, async (sample) => {
		const prediction = await runEvaluationAttempt({
			invoke: () => requestExactChatClassification(client, model, sample.notice_title),
			model,
			notice_id: sample.notice_id,
			repeat: 1,
		});
		completed += 1;
		if (completed % 60 === 0 || completed === samples.length) {
			process.stderr.write(`label-gold progress ${completed}/${samples.length}\n`);
		}
		return prediction;
	});
	await mkdir(directory, { recursive: true });
	await writeJsonLines(resolve(directory, "label-gold-predictions.jsonl"), predictions);
	const labelGold = buildLabelGold(samples, predictions, model);
	await writeJsonLines(resolve(directory, "label-gold.jsonl"), labelGold);
	process.stdout.write(
		`${JSON.stringify({ inference_api: CHAT_COMPLETIONS_INFERENCE_API, label_gold_entries: labelGold.length, model, predictions: predictions.length, temperature: NOTICE_CLASSIFIER_TEMPERATURE })}\n`,
	);
}

async function runEvaluateCandidatesCommand(options: EvalCliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const { labelGold, samples } = await loadLabelGold(directory);
	const models = resolveExplicitModels(options.model, "candidate");
	const concurrency = positiveIntegerOption(options, "concurrency", 2);
	const stabilityIds = await readRequestedStabilityIds(options, samples);
	const predictions = await evaluateResponseModels(
		samples,
		models,
		stabilityIds,
		concurrency,
		"eval",
	);
	validateLabelGold(samples, labelGold);
	validateCandidatePredictions(samples, predictions, models, stabilityIds);
	await mkdir(directory, { recursive: true });
	await Promise.all([
		writeJsonLines(resolve(directory, "candidate-predictions.jsonl"), predictions),
		writeJsonFile(resolve(directory, "stability-ids.json"), stabilityIds),
	]);
	process.stdout.write(
		`${JSON.stringify({ candidate_models: models, candidate_predictions: predictions.length, inference_api: RESPONSES_INFERENCE_API, stability_count: stabilityIds.length, temperature: NOTICE_CLASSIFIER_TEMPERATURE })}\n`,
	);
}

async function runEvaluateRegressionCommand(options: EvalCliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
	const evidence = await loadRegressionEvidence(repositoryRoot);
	const models = resolveExplicitModels(options.model, "candidate");
	const concurrency = positiveIntegerOption(options, "concurrency", 2);
	const stabilityIds = await readRequestedStabilityIds(options, evidence.samples);
	const predictions = await evaluateResponseModels(
		evidence.samples,
		models,
		stabilityIds,
		concurrency,
		"regression",
	);
	validateRegressionPredictions(evidence.samples, predictions, models, stabilityIds);
	await mkdir(directory, { recursive: true });
	await Promise.all([
		writeJsonLines(resolve(directory, "regression-predictions.jsonl"), predictions),
		writeJsonFile(resolve(directory, "stability-ids.json"), stabilityIds),
	]);
	process.stdout.write(
		`${JSON.stringify({ candidate_models: models, candidate_predictions: predictions.length, inference_api: RESPONSES_INFERENCE_API, regression_case_count: evidence.cases.length, stability_count: stabilityIds.length, temperature: NOTICE_CLASSIFIER_TEMPERATURE })}\n`,
	);
}

async function evaluateResponseModels(
	samples: readonly EvalSample[],
	models: readonly string[],
	stabilityIds: readonly number[],
	concurrency: number,
	progressLabel: string,
): Promise<EvalPrediction[]> {
	const stabilitySet = new Set(stabilityIds);
	const classifiers = new Map(
		models.map((model) => [
			model,
			createOpenAINoticeModelClassifierWithRawResponse({
				...process.env,
				INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL: model,
			}),
		]),
	);
	const tasks = samples.flatMap((sample) =>
		models.flatMap((model) => {
			const repeats = stabilitySet.has(sample.notice_id) ? ([1, 2, 3] as const) : ([1] as const);
			return repeats.map((repeat) => ({ model, repeat, sample }));
		}),
	);
	let completed = 0;
	return mapWithConcurrency(tasks, concurrency, async (task) => {
		const classifier = classifiers.get(task.model) as (
			noticeTitle: string,
		) => Promise<{ category: NoticeCategory; rawResponse: string }>;
		const prediction = await runEvaluationAttempt({
			invoke: async () => {
				const result = await classifier(task.sample.notice_title);
				return { category: result.category, raw_response: result.rawResponse };
			},
			model: task.model,
			notice_id: task.sample.notice_id,
			repeat: task.repeat,
		});
		completed += 1;
		if (completed % 60 === 0 || completed === tasks.length) {
			process.stderr.write(`${progressLabel} progress ${completed}/${tasks.length}\n`);
		}
		return prediction;
	});
}

async function runCheckCommand(options: EvalCliOptions): Promise<boolean> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const kind = requiredOption(options, "kind");
	if (kind === "candidate") {
		const { labelGold, samples } = await loadLabelGold(directory);
		const predictions = await readJsonLines<EvalPrediction>(
			resolve(directory, "candidate-predictions.jsonl"),
		);
		const stabilityIds = await readStoredStabilityIds(directory, samples);
		const models = predictionModels(predictions);
		validateCandidatePredictions(samples, predictions, models, stabilityIds);
		const result = buildCandidateEvaluationCheckResult(
			buildCandidateEvaluationReport(samples, labelGold, predictions),
		);
		process.stdout.write(`${JSON.stringify(result)}\n`);
		return result.evidence_status === "complete";
	}
	if (kind === "regression") {
		const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
		const evidence = await loadRegressionEvidence(repositoryRoot);
		const predictions = await readJsonLines<EvalPrediction>(
			resolve(directory, "regression-predictions.jsonl"),
		);
		const stabilityIds = await readStoredStabilityIds(directory, evidence.samples);
		const models = predictionModels(predictions);
		const result = buildRegressionEvaluationCheckResult(
			evidence.cases,
			predictions,
			models,
			stabilityIds,
		);
		process.stdout.write(`${JSON.stringify(result)}\n`);
		return result.evidence_status === "complete";
	}
	throw new Error("--kind must be candidate or regression");
}

async function loadEvaluationSample(directory: string): Promise<EvalSample[]> {
	const samples = await readJsonLines<EvalSample>(resolve(directory, "sample.jsonl"));
	validateEvalSamples(samples);
	if (samples.some((sample) => sample.split === "regression")) {
		throw new Error("candidate evaluation cannot use regression samples");
	}
	return samples;
}

async function loadLabelGold(
	directory: string,
): Promise<{ labelGold: LabelGoldEntry[]; samples: EvalSample[] }> {
	const samples = await loadEvaluationSample(directory);
	const labelGold = await readJsonLines<LabelGoldEntry>(resolve(directory, "label-gold.jsonl"));
	validateLabelGold(samples, labelGold);
	return { labelGold, samples };
}

async function loadRegressionEvidence(repositoryRoot: string): Promise<RegressionEvidence> {
	const metadataPath = resolve(
		repositoryRoot,
		"scripts/notices/regression/classification-badcases.json",
	);
	let parsedFixture: unknown;
	try {
		parsedFixture = JSON.parse(await readFile(metadataPath, "utf8")) as unknown;
	} catch (error) {
		throw new Error(`${metadataPath} is not valid JSON`, { cause: error });
	}
	assertExactObjectKeys(parsedFixture, ["cases"], "regression fixture");
	const fixture = parsedFixture as unknown as RegressionFixture;
	if (!Array.isArray(fixture.cases)) {
		throw new Error("regression fixture must contain cases");
	}
	validateRegressionCases(fixture.cases);
	const samples = toRegressionSamples(fixture.cases);
	validateEvalSamples(samples);
	return { cases: fixture.cases, samples };
}

async function readRequestedStabilityIds(
	options: EvalCliOptions,
	samples: readonly EvalSample[],
): Promise<number[]> {
	const path = singleOption(options, "stability-ids-file");
	if (!path) {
		return [];
	}
	let value: unknown;
	try {
		value = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
	} catch (error) {
		throw new Error(`${resolve(path)} is not valid JSON`, { cause: error });
	}
	return validateStabilityIds(samples, value);
}

async function readStoredStabilityIds(
	directory: string,
	samples: readonly EvalSample[],
): Promise<number[]> {
	const value = await readOptionalJsonFile<unknown>(resolve(directory, "stability-ids.json"));
	return resolveCandidateStabilityIds(samples, value);
}

async function classifyForStratification(
	client: OpenAI,
	model: string,
	input: NoticeClassificationTask,
): Promise<StratificationPrediction> {
	return runEvaluationAttempt({
		invoke: () => requestExactChatClassification(client, model, input.noticeTitle),
		model,
		notice_id: input.noticeId,
		repeat: 1,
	});
}

export async function runEvaluationAttempt(
	options: EvaluationAttemptOptions,
): Promise<EvalPrediction> {
	const startedAt = performance.now();
	try {
		const result = await options.invoke();
		return {
			attempt: 1,
			category: result.category,
			elapsed_ms: Math.round(performance.now() - startedAt),
			model: options.model,
			notice_id: options.notice_id,
			raw_response: result.raw_response,
			repeat: options.repeat,
			status: "ok",
		};
	} catch (error) {
		if (error instanceof NoticeClassificationInvalidOutputError) {
			return {
				attempt: 1,
				category: null,
				elapsed_ms: Math.round(performance.now() - startedAt),
				error: formatRawError(error),
				model: options.model,
				notice_id: options.notice_id,
				raw_response: error.rawResponse ?? "",
				repeat: options.repeat,
				status: "invalid_output",
			};
		}
		if (error instanceof NoticeClassificationProviderError) {
			return {
				attempt: 1,
				category: null,
				elapsed_ms: Math.round(performance.now() - startedAt),
				error: formatRawError(error),
				model: options.model,
				notice_id: options.notice_id,
				repeat: options.repeat,
				status: "provider_error",
			};
		}
		throw error;
	}
}

async function requestExactChatClassification(
	client: OpenAI,
	model: string,
	noticeTitle: string,
): Promise<{
	category: NoticeCategory;
	raw_response: string;
}> {
	const response = await requestClassification(client, model, toModelInput(noticeTitle));
	const category = parseExactClassification(response.raw);
	if (!category) {
		throw new NoticeClassificationInvalidOutputError(
			`model returned an invalid exact classification: ${String(response.raw)}`,
			{ rawResponse: response.raw ?? "" },
		);
	}
	return {
		category,
		raw_response: response.raw ?? "",
	};
}

async function requestClassification(
	client: OpenAI,
	model: string,
	input: Record<string, unknown>,
): Promise<{
	raw: string | null;
}> {
	try {
		const response = await client.chat.completions.create({
			messages: [
				{ content: CLASSIFICATION_SYSTEM_PROMPT, role: "system" },
				{ content: JSON.stringify(input), role: "user" },
			],
			model,
			stream: false,
			temperature: NOTICE_CLASSIFIER_TEMPERATURE,
		});
		return {
			raw: response.choices[0]?.message.content ?? null,
		};
	} catch (error) {
		if (!(error instanceof APIConnectionError || error instanceof APIError)) {
			throw error;
		}
		throw new NoticeClassificationProviderError("model provider request failed", {
			cause: error,
			retryable: isRetryableNoticeProviderCause(error),
		});
	}
}

function toEvalSample(
	input: NoticeClassificationTask,
	split: EvalSplit,
	reviewGroup: EvalReviewGroup,
): EvalSample {
	return {
		notice_id: input.noticeId,
		notice_title: input.noticeTitle,
		review_group: reviewGroup,
		split,
	};
}

function rankByHash(
	values: readonly NoticeClassificationTask[],
	seed: string,
	scope: string,
): NoticeClassificationTask[] {
	return [...values].sort(
		(left, right) =>
			hashRank(seed, scope, left.noticeId).localeCompare(hashRank(seed, scope, right.noticeId)) ||
			left.noticeId - right.noticeId,
	);
}

function hashRank(seed: string, scope: string, noticeId: number): string {
	return createHash("sha256").update(`${seed}:${scope}:${noticeId}`).digest("hex");
}

export type EvalCommand =
	| "check"
	| "evaluate-candidates"
	| "evaluate-regression"
	| "generate-label-gold"
	| "sample"
	| "sample-random"
	| "stratify";

export type EvalCliOptions = Record<string, string[] | undefined>;

const EVAL_COMMANDS = new Set<EvalCommand>([
	"check",
	"evaluate-candidates",
	"evaluate-regression",
	"generate-label-gold",
	"sample",
	"sample-random",
	"stratify",
]);

export function parseEvalCliOptions(argv: readonly string[]): {
	command: EvalCommand;
	options: EvalCliOptions;
} {
	const command = argv[0];
	if (!(command && EVAL_COMMANDS.has(command as EvalCommand))) {
		throw new Error(
			"Usage: pnpm notice:classify:eval <stratify|sample|sample-random|generate-label-gold|evaluate-candidates|evaluate-regression|check> --output-dir <path>",
		);
	}
	const options: EvalCliOptions = {};
	for (let index = 1; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error("eval options must use --key value pairs");
		}
		const normalized = key.slice(2);
		options[normalized] = [...(options[normalized] ?? []), value];
	}
	return { command: command as EvalCommand, options };
}

function singleOption(options: EvalCliOptions, key: string): string | undefined {
	const values = options[key];
	if (!values || values.length === 0) {
		return;
	}
	if (values.length !== 1) {
		throw new Error(`--${key} may only be provided once`);
	}
	return values[0];
}

function requiredOption(options: EvalCliOptions, key: string): string {
	const value = singleOption(options, key)?.trim();
	if (!value) {
		throw new Error(`--${key} is required`);
	}
	return value;
}

function positiveIntegerOption(options: EvalCliOptions, key: string, fallback: number): number {
	const raw = singleOption(options, key);
	if (raw === undefined) {
		return fallback;
	}
	return parsePositiveInteger(raw, key);
}

function requiredPositiveIntegerOption(options: EvalCliOptions, key: string): number {
	return parsePositiveInteger(requiredOption(options, key), key);
}

function parsePositiveInteger(raw: string, key: string): number {
	if (!/^[1-9][0-9]*$/u.test(raw)) {
		throw new Error(`--${key} must be a positive integer`);
	}
	return Number(raw);
}

async function readExcludedIds(options: EvalCliOptions): Promise<Set<number>> {
	const ids = new Set<number>();
	for (const value of options["exclude-ids"] ?? []) {
		for (const raw of value.split(",")) {
			if (!raw.trim()) {
				continue;
			}
			const id = Number(raw.trim());
			if (!Number.isSafeInteger(id) || id < 1) {
				throw new Error("--exclude-ids contains an invalid notice id");
			}
			ids.add(id);
		}
	}
	for (const path of options["exclude-file"] ?? []) {
		const resolvedPath = resolve(path);
		for (const value of parseJsonLines<{ notice_id: number }>(
			await readFile(resolvedPath, "utf8"),
			resolvedPath,
		)) {
			if (!Number.isSafeInteger(value.notice_id) || value.notice_id < 1) {
				throw new Error(`exclude file contains an invalid notice id: ${path}`);
			}
			ids.add(value.notice_id);
		}
	}
	return ids;
}

async function writeJsonLines(path: string, values: readonly unknown[]): Promise<void> {
	await writeFile(path, serializeJsonLines(values), { encoding: "utf8" });
}

function serializeJsonLines(values: readonly unknown[]): string {
	return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}

async function readJsonLines<Value>(path: string): Promise<Value[]> {
	return parseJsonLines<Value>(await readFile(path, "utf8"), path);
}

function parseJsonLines<Value>(input: string, path: string): Value[] {
	return input
		.split(/\r?\n/u)
		.filter(Boolean)
		.map((line, index) => {
			try {
				return JSON.parse(line) as Value;
			} catch (error) {
				throw new Error(`${path}:${index + 1} is not valid JSON`, { cause: error });
			}
		});
}

async function readOptionalJsonFile<Value>(path: string): Promise<Value | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as Value;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}
		throw error;
	}
}

function ratio(numerator: number, denominator: number): number | null {
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

function assertExactObjectKeys(
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

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const { command, options } = parseEvalCliOptions(argv);
	if (command === "stratify") {
		await runStratifyCommand(options);
	}
	if (command === "sample") {
		await runSampleCommand(options);
	}
	if (command === "sample-random") {
		await runRandomSampleCommand(options);
	}
	if (command === "generate-label-gold") {
		await runGenerateLabelGoldCommand(options);
	}
	if (command === "evaluate-candidates") {
		await runEvaluateCandidatesCommand(options);
	}
	if (command === "evaluate-regression") {
		await runEvaluateRegressionCommand(options);
	}
	if (command === "check" && !(await runCheckCommand(options))) {
		process.exitCode = 1;
	}
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
	main().catch((error) => {
		console.error(formatRawError(error));
		process.exitCode = 1;
	});
}
