import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NOTICE_CATEGORIES, type NoticeCategory } from "@campus-agent/notices";
import OpenAI from "openai";
import type { NoticeClassificationTask } from "../../packages/notice-classifier-core/src/batch";
import {
	isRetryableNoticeClassificationError,
	NOTICE_CLASSIFICATION_RETRY_DELAYS_MS,
	NoticeClassificationProviderError,
	type NoticeModelClassifier,
} from "./classifier";
import { mapWithConcurrency } from "./concurrency";
import {
	createNoticeModelFetch,
	createOpenAINoticeModelClassifier,
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

export const DEFAULT_EVAL_SEED = "notice-category-gate-2026-08-16-v1";
export const BUSINESS_ACCEPTANCE_PROFILE = "business_acceptance_v1";
export const BALANCED_COMPARISON_PROFILE = "balanced_comparison_v1";
export const BUSINESS_ACCEPTANCE_THRESHOLDS = {
	eventual_valid_rate: 1,
	first_attempt_valid_rate: 0.98,
	minimum_aggregate_agreement: 0.85,
	minimum_category_recall: 0.6,
	minimum_category_support: 5,
	minimum_primary_agreement: 0.85,
	minimum_random_labels: 60,
	minimum_stability_rate: 0.8,
	minimum_stability_samples: 60,
} as const;

type ConcreteNoticeCategory = Exclude<NoticeCategory, "unclassified">;

const CONCRETE_CATEGORIES = NOTICE_CATEGORIES.filter(
	(category): category is ConcreteNoticeCategory => category !== "unclassified",
);
const CONCRETE_CATEGORY_SET = new Set<string>(CONCRETE_CATEGORIES);
const CATEGORY_SET = new Set<string>(NOTICE_CATEGORIES);
const EXACT_CLASSIFICATION_INSTRUCTION =
	'只输出单行 JSON 对象，且只能包含 category 字段，例如 {"category":"campus_operations"}。不要输出 Markdown、解释或其他文字。';
const CLASSIFICATION_SYSTEM_PROMPT = `${NOTICE_CLASSIFIER_SYSTEM_PROMPT}\n${EXACT_CLASSIFICATION_INSTRUCTION}`;
const CLASSIFICATION_PROMPT_SHA256 = createHash("sha256")
	.update(CLASSIFICATION_SYSTEM_PROMPT)
	.digest("hex");
export const PRODUCTION_PROMPT_SHA256 = createHash("sha256")
	.update(NOTICE_CLASSIFIER_SYSTEM_PROMPT)
	.digest("hex");
const REFERENCE_INFERENCE_API = "chat.completions";
const CANDIDATE_INFERENCE_API = "responses";

export type EvalProfile = typeof BALANCED_COMPARISON_PROFILE | typeof BUSINESS_ACCEPTANCE_PROFILE;

export type EvalSplit = "balanced" | "random";
export type EvalReviewGroup =
	| "category_consensus"
	| "category_disagreement"
	| "category_shape"
	| "evidence_poor"
	| "random";
export type PredictionStatus = "invalid_output" | "ok" | "provider_error";

export interface EvalSample {
	notice_id: number;
	notice_title: string;
	review_group: EvalReviewGroup;
	split: EvalSplit;
}

export interface EvalLabel {
	category: NoticeCategory;
	notice_id: number;
}

export interface EvalPrediction {
	attempt: 1 | 2 | 3;
	category: NoticeCategory | null;
	completion_tokens?: number;
	elapsed_ms: number;
	error?: string;
	model: string;
	notice_id: number;
	prompt_tokens?: number;
	run: 1 | 2 | 3;
	status: PredictionStatus;
	total_tokens?: number;
}

export interface StratificationPrediction {
	attempts: number;
	category: NoticeCategory | null;
	completion_tokens?: number;
	elapsed_ms: number;
	error?: string;
	model: string;
	notice_id: number;
	prompt_tokens?: number;
	status: PredictionStatus;
	total_tokens?: number;
}

export interface EvalSampleOptions {
	categoryCount: number;
	categoryCountOverrides?: Partial<Record<ConcreteNoticeCategory, number>>;
	evidencePoorCount: number;
	randomCount: number;
	seed: string;
	stratificationModels: readonly string[];
}

export interface DifficultSelectionInput {
	labels: readonly EvalLabel[];
	predictions: readonly EvalPrediction[];
	samples: readonly EvalSample[];
	seed: string;
}

interface StratifyManifest {
	api: typeof REFERENCE_INFERENCE_API;
	created_at: string;
	eligible_count: number;
	excluded_notice_ids: number[];
	models: string[];
	seed: string;
	source_count: number;
	temperature: number;
}

interface EvalManifest {
	balanced_count: number;
	category_counts: Record<ConcreteNoticeCategory, number>;
	created_at: string;
	evidence_poor_count: number;
	excluded_notice_ids: number[];
	historical_sample_files?: string[];
	profile: EvalProfile;
	random_count: number;
	review_groups: Record<EvalReviewGroup, number>;
	sample_sha256: string;
	seed: string;
	source_count: number;
	stratification_models: string[];
}

export interface EvalLabelManifest {
	api: typeof REFERENCE_INFERENCE_API;
	created_at: string;
	labels_sha256: string;
	model: string;
	predictions_sha256: string;
	prompt_sha256: string;
	sample_count: number;
	sample_sha256: string;
	temperature: number;
}

export interface ReferencePredictionCheckpoint {
	api: typeof REFERENCE_INFERENCE_API;
	model: string;
	predictions: EvalPrediction[];
	prompt_sha256: string;
	sample_sha256: string;
	temperature: number;
}

export interface EvalRunManifest {
	api: typeof CANDIDATE_INFERENCE_API;
	created_at: string;
	label_manifest_sha256: string;
	labels_sha256: string;
	models: string[];
	predictions_sha256: string;
	prompt_sha256: string;
	reference_model: string;
	sample_sha256: string;
	seed: string;
	stability_count: number;
	temperature: number;
}

interface LabelMetricSet {
	agreed: number;
	agreement_rate: number | null;
	confusion: Record<string, Record<string, number>>;
	macro_f1: number | null;
	per_label: Record<
		string,
		{ f1: number | null; precision: number | null; recall: number | null; support: number }
	>;
	scoreable: number;
}

interface ModelOperationalMetrics {
	completion_tokens: number;
	eventual_valid_rate: number | null;
	failed: number;
	first_attempt_valid_rate: number | null;
	p50_ms: number | null;
	p90_ms: number | null;
	prompt_tokens: number;
	stable_difficult: number;
	stability_total: number;
	total_tokens: number;
}

interface ModelGate {
	aggregate_agreement: number | null;
	balanced_macro_f1: number | null;
	eligible_sample: boolean;
	evidence_poor_agreement: number | null;
	eventual_valid_rate: number | null;
	first_attempt_valid_rate: number | null;
	minimum_category_recall: number | null;
	model: string;
	passes: boolean;
	profile: EvalProfile;
	random_agreement: number | null;
	stability_rate: number | null;
	thresholds: {
		balanced_macro_f1: number;
		eventual_valid_rate: number;
		first_attempt_valid_rate: number;
		minimum_aggregate_agreement: number;
		minimum_category_recall: number;
		minimum_category_support: number;
		minimum_evidence_poor_agreement: number;
		minimum_primary_agreement: number;
		minimum_random_agreement: number;
		minimum_random_labels: number;
		minimum_stability_rate: number;
		minimum_stability_samples: number;
	};
}

export interface EvalReport {
	all: Record<string, LabelMetricSet>;
	balanced: Record<string, LabelMetricSet>;
	evidence_poor: Record<string, LabelMetricSet>;
	gates: Record<string, ModelGate>;
	generated_at: string;
	models: Record<string, ModelOperationalMetrics>;
	profile: EvalProfile;
	random: Record<string, LabelMetricSet>;
	reference_model: string;
	selected_model: string | null;
}

export interface EvalCheckResult {
	models: Record<
		string,
		{
			aggregate_agreement: number | null;
			balanced_macro_f1: number | null;
			eventual_valid_rate: number | null;
			evidence_poor_agreement: number | null;
			first_attempt_valid_rate: number | null;
			minimum_category_recall: number | null;
			passes: boolean;
			primary_agreement: number | null;
			stability_rate: number | null;
		}
	>;
	passes: boolean;
	profile: EvalProfile;
	reference_model: string;
	selected_model: string | null;
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

interface ResolvedPrediction {
	category: NoticeCategory | null;
	model: string;
	noticeId: number;
}

interface ReferenceLabelEvidence {
	labelManifest: EvalLabelManifest;
	labelManifestInput: string;
	labels: EvalLabel[];
	labelsInput: string;
	predictions: EvalPrediction[];
	samples: EvalSample[];
	sampleInput: string;
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
	if (options.randomCount < 1 || options.categoryCount < 1 || options.evidencePoorCount < 1) {
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
		const shapeTarget = categoryCount - consensusTarget - disagreementTarget;
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
				(input) =>
					summaries.get(input.noticeId)?.categories.has(category) === true &&
					isSourceShapeOutlier(input),
			),
			shapeTarget,
			"category_shape",
			categorySelected,
			selectedIds,
			options.seed,
			`${category}:shape`,
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

	const evidenceCandidates = candidates
		.filter((input) => !selectedIds.has(input.noticeId))
		.sort((left, right) => {
			const scoreDifference =
				evidencePoorScore(right, summaries) - evidencePoorScore(left, summaries);
			return (
				scoreDifference ||
				hashRank(options.seed, "evidence-poor", left.noticeId).localeCompare(
					hashRank(options.seed, "evidence-poor", right.noticeId),
				) ||
				left.noticeId - right.noticeId
			);
		});
	for (const input of evidenceCandidates.slice(0, options.evidencePoorCount)) {
		selectedIds.add(input.noticeId);
		selected.push({ input, reviewGroup: "evidence_poor" });
	}
	if (
		selected.filter((value) => value.reviewGroup === "evidence_poor").length !==
		options.evidencePoorCount
	) {
		throw new Error("not enough evidence-poor candidates");
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

export function selectRandomAcceptanceIds(
	sourceIds: readonly number[],
	excludedIds: ReadonlySet<number>,
	count: number,
	seed: string,
): number[] {
	if (!Number.isSafeInteger(count) || count < 1) {
		throw new Error("acceptance sample count must be a positive integer");
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

export function buildRandomAcceptanceSample(
	inputs: readonly NoticeClassificationTask[],
	seed: string,
): EvalSample[] {
	if (new Set(inputs.map((input) => input.noticeId)).size !== inputs.length) {
		throw new Error("acceptance inputs contain duplicate notice ids");
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

export function validateEvalLabels(
	samples: readonly EvalSample[],
	labels: readonly EvalLabel[],
): void {
	const sampleIds = new Set(samples.map((sample) => sample.notice_id));
	const labelIds = new Set<number>();
	for (const label of labels) {
		if (!sampleIds.has(label.notice_id)) {
			throw new Error(`label references an unknown notice: ${label.notice_id}`);
		}
		if (labelIds.has(label.notice_id)) {
			throw new Error(`duplicate reference label: ${label.notice_id}`);
		}
		labelIds.add(label.notice_id);
		if (!CATEGORY_SET.has(label.category)) {
			throw new Error(`reference label has an invalid category: ${label.notice_id}`);
		}
	}
	if (labelIds.size !== sampleIds.size) {
		throw new Error("reference labels do not cover the complete eval sample");
	}
}

export function buildReferenceLabels(
	samples: readonly EvalSample[],
	predictions: readonly EvalPrediction[],
	model: string,
): EvalLabel[] {
	const failed = samples.flatMap((sample) => {
		const category = resolvePrediction(predictions, sample.notice_id, model, 1);
		if (category) {
			return [];
		}
		const attempts = predictions
			.filter(
				(prediction) =>
					prediction.notice_id === sample.notice_id &&
					prediction.model === model &&
					prediction.run === 1,
			)
			.map((prediction) => prediction.status);
		return [`${sample.notice_id} (${attempts.join(",") || "missing"})`];
	});
	if (failed.length > 0) {
		throw new Error(`reference model did not label notices: ${failed.join("; ")}`);
	}
	const labels = samples.map((sample) => ({
		category: resolvePrediction(predictions, sample.notice_id, model, 1) as NoticeCategory,
		notice_id: sample.notice_id,
	}));
	validateEvalLabels(samples, labels);
	return labels;
}

export function buildReferencePredictionCheckpoint(
	sample: EvalSample,
	predictions: readonly EvalPrediction[],
	model: string,
): ReferencePredictionCheckpoint {
	validateReferencePredictions(sample, predictions, model);
	if (!resolvePrediction(predictions, sample.notice_id, model, 1)) {
		throw new Error(`reference prediction checkpoint is not successful: ${sample.notice_id}`);
	}
	return {
		api: REFERENCE_INFERENCE_API,
		model,
		predictions: [...predictions],
		prompt_sha256: CLASSIFICATION_PROMPT_SHA256,
		sample_sha256: sha256(serializeJsonLines([sample])),
		temperature: NOTICE_CLASSIFIER_TEMPERATURE,
	};
}

export function validateReferencePredictionCheckpoint(
	sample: EvalSample,
	checkpoint: ReferencePredictionCheckpoint,
	model: string,
): EvalPrediction[] {
	if (checkpoint.model !== model) {
		throw new Error(`reference prediction checkpoint model changed: ${sample.notice_id}`);
	}
	if (
		checkpoint.api !== REFERENCE_INFERENCE_API ||
		checkpoint.temperature !== NOTICE_CLASSIFIER_TEMPERATURE
	) {
		throw new Error(`reference prediction checkpoint request changed: ${sample.notice_id}`);
	}
	if (checkpoint.prompt_sha256 !== CLASSIFICATION_PROMPT_SHA256) {
		throw new Error(`reference prediction checkpoint prompt changed: ${sample.notice_id}`);
	}
	if (checkpoint.sample_sha256 !== sha256(serializeJsonLines([sample]))) {
		throw new Error(`reference prediction checkpoint sample changed: ${sample.notice_id}`);
	}
	validateReferencePredictions(sample, checkpoint.predictions, model);
	if (!resolvePrediction(checkpoint.predictions, sample.notice_id, model, 1)) {
		throw new Error(`reference prediction checkpoint is not successful: ${sample.notice_id}`);
	}
	return checkpoint.predictions;
}

function validateReferencePredictions(
	sample: EvalSample,
	predictions: readonly EvalPrediction[],
	model: string,
): void {
	if (predictions.length === 0) {
		throw new Error(`reference prediction checkpoint is empty: ${sample.notice_id}`);
	}
	for (const prediction of predictions) {
		if (
			prediction.notice_id !== sample.notice_id ||
			prediction.model !== model ||
			prediction.run !== 1
		) {
			throw new Error(`reference prediction checkpoint identity changed: ${sample.notice_id}`);
		}
		if (
			prediction.status === "ok" &&
			!(prediction.category && CATEGORY_SET.has(prediction.category))
		) {
			throw new Error(`reference prediction checkpoint category is invalid: ${sample.notice_id}`);
		}
	}
}

export function selectDifficultIds(input: DifficultSelectionInput, count: number): number[] {
	if (count > input.samples.length) {
		throw new Error("stability count exceeds the sample size");
	}
	const labels = new Map(input.labels.map((label) => [label.notice_id, label]));
	const models = [...new Set(input.predictions.map((prediction) => prediction.model))];
	const candidates = input.samples.map((sample) => {
		const expected = labels.get(sample.notice_id)?.category ?? null;
		const actual = models.map((model) =>
			resolvePrediction(input.predictions, sample.notice_id, model, 1),
		);
		return {
			disagreements: actual.filter((category) => category !== expected).length,
			distinct: new Set(actual.filter((category): category is NoticeCategory => category !== null))
				.size,
			errors: actual.filter((category) => category === null).length,
			noticeId: sample.notice_id,
		};
	});
	candidates.sort(
		(left, right) =>
			right.errors - left.errors ||
			right.distinct - left.distinct ||
			right.disagreements - left.disagreements ||
			hashRank(input.seed, "stability", left.noticeId).localeCompare(
				hashRank(input.seed, "stability", right.noticeId),
			) ||
			left.noticeId - right.noticeId,
	);
	return candidates.slice(0, count).map((candidate) => candidate.noticeId);
}

export function validateStabilityIds(
	samples: readonly EvalSample[],
	value: unknown,
	expectedCount: number,
): number[] {
	if (!Array.isArray(value) || value.length !== expectedCount) {
		throw new Error(`stability ids must contain exactly ${expectedCount} notices`);
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

export function buildEvalReport(
	samples: readonly EvalSample[],
	labels: readonly EvalLabel[],
	predictions: readonly EvalPrediction[],
	referenceModel: string,
	profile: EvalProfile = BALANCED_COMPARISON_PROFILE,
): EvalReport {
	validateEvalLabels(samples, labels);
	const models = [...new Set(predictions.map((prediction) => prediction.model))].sort();
	const labelsById = new Map(labels.map((label) => [label.notice_id, label]));
	const metricsFor = (filter: (sample: EvalSample) => boolean): Record<string, LabelMetricSet> =>
		Object.fromEntries(
			models.map((model) => [
				model,
				calculateLabelMetrics(
					samples.filter(filter),
					labelsById,
					resolveModelPredictions(samples, predictions, model),
				),
			]),
		);
	const all = metricsFor(() => true);
	const random = metricsFor((sample) => sample.split === "random");
	const balanced = metricsFor(
		(sample) => sample.split === "balanced" && sample.review_group !== "evidence_poor",
	);
	const evidencePoor = metricsFor((sample) => sample.review_group === "evidence_poor");
	const operations = Object.fromEntries(
		models.map((model) => [model, calculateOperationalMetrics(samples, predictions, model)]),
	);
	const aggregateAgreement = Object.fromEntries(
		models.map((model) => [
			model,
			calculateAggregateAgreement(samples, labelsById, predictions, model),
		]),
	);
	const gates = Object.fromEntries(
		models.map((model) => [
			model,
			evaluateModelGate(
				model,
				profile,
				random[model],
				balanced[model],
				evidencePoor[model],
				operations[model],
				aggregateAgreement[model],
			),
		]),
	);
	const selectedModel = selectBusinessModel(gates, operations);
	return {
		all,
		balanced,
		evidence_poor: evidencePoor,
		gates,
		generated_at: new Date().toISOString(),
		models: operations,
		profile,
		random,
		reference_model: referenceModel,
		selected_model: selectedModel,
	};
}

export function buildEvalCheckResult(report: EvalReport): EvalCheckResult {
	const models = Object.fromEntries(
		Object.keys(report.models)
			.sort()
			.map((model) => {
				const gate = report.gates[model];
				const operations = report.models[model];
				if (!(gate && operations)) {
					throw new Error(`eval report is missing model metrics: ${model}`);
				}
				return [
					model,
					{
						aggregate_agreement: gate.aggregate_agreement,
						balanced_macro_f1: gate.balanced_macro_f1,
						eventual_valid_rate: operations.eventual_valid_rate,
						evidence_poor_agreement: gate.evidence_poor_agreement,
						first_attempt_valid_rate: operations.first_attempt_valid_rate,
						minimum_category_recall: gate.minimum_category_recall,
						passes: gate.passes,
						primary_agreement: gate.random_agreement,
						stability_rate: gate.stability_rate,
					},
				];
			}),
	);
	return {
		models,
		passes: report.selected_model !== null,
		profile: report.profile,
		reference_model: report.reference_model,
		selected_model: report.selected_model,
	};
}

function summarizeStratification(
	inputs: readonly NoticeClassificationTask[],
	predictions: readonly StratificationPrediction[],
	stratificationModels: readonly string[],
): Map<number, StratificationSummary> {
	validateModelList(stratificationModels, "stratification");
	const inputIds = new Set(inputs.map((input) => input.noticeId));
	const byNotice = new Map<number, StratificationPrediction[]>();
	for (const prediction of predictions) {
		if (!inputIds.has(prediction.notice_id)) {
			throw new Error(`stratification references an unknown notice: ${prediction.notice_id}`);
		}
		const values = byNotice.get(prediction.notice_id) ?? [];
		values.push(prediction);
		byNotice.set(prediction.notice_id, values);
	}
	const summaries = new Map<number, StratificationSummary>();
	for (const input of inputs) {
		const values = byNotice.get(input.noticeId) ?? [];
		const models = values.map((prediction) => prediction.model);
		if (
			values.length !== stratificationModels.length ||
			new Set(models).size !== stratificationModels.length ||
			stratificationModels.some((model) => !models.includes(model))
		) {
			throw new Error(`incomplete stratification predictions: ${input.noticeId}`);
		}
		const categories = values.flatMap((prediction) =>
			prediction.status === "ok" && prediction.category ? [prediction.category] : [],
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

function evidencePoorScore(
	input: NoticeClassificationTask,
	summaries: ReadonlyMap<number, StratificationSummary>,
): number {
	const titleLength = [...input.noticeTitle.trim()].length;
	return (
		(summaries.get(input.noticeId)?.disagreement ? 4 : 0) +
		(titleLength <= 12 ? 2 : 0) +
		(titleLength <= 6 ? 1 : 0)
	);
}

function isSourceShapeOutlier(input: NoticeClassificationTask): boolean {
	const titleLength = [...input.noticeTitle.trim()].length;
	return titleLength <= 12 || titleLength >= 60;
}

function calculateLabelMetrics(
	samples: readonly EvalSample[],
	labels: ReadonlyMap<number, EvalLabel>,
	predictions: ReadonlyMap<number, ResolvedPrediction>,
): LabelMetricSet {
	const counters = Object.fromEntries(
		NOTICE_CATEGORIES.map((category) => [category, { fn: 0, fp: 0, support: 0, tp: 0 }]),
	) as Record<NoticeCategory, { fn: number; fp: number; support: number; tp: number }>;
	const confusion: Record<string, Record<string, number>> = {};
	let agreed = 0;
	let scoreable = 0;
	for (const sample of samples) {
		const label = labels.get(sample.notice_id);
		if (!label) {
			continue;
		}
		scoreable += 1;
		const expected = label.category;
		const actual = predictions.get(sample.notice_id)?.category ?? null;
		counters[expected].support += 1;
		const actualKey = actual ?? "__error__";
		confusion[expected] ??= {};
		confusion[expected][actualKey] = (confusion[expected][actualKey] ?? 0) + 1;
		if (actual === expected) {
			agreed += 1;
			counters[expected].tp += 1;
		} else {
			counters[expected].fn += 1;
			if (actual) {
				counters[actual].fp += 1;
			}
		}
	}
	const perLabel: LabelMetricSet["per_label"] = {};
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
		perLabel[category] = { f1, precision, recall, support: values.support };
	}
	return {
		agreed,
		agreement_rate: ratio(agreed, scoreable),
		confusion,
		macro_f1: f1Values.length > 0 ? average(f1Values) : null,
		per_label: perLabel,
		scoreable,
	};
}

function resolveModelPredictions(
	samples: readonly EvalSample[],
	predictions: readonly EvalPrediction[],
	model: string,
): ReadonlyMap<number, ResolvedPrediction> {
	return new Map(
		samples.map((sample) => [
			sample.notice_id,
			{
				category: resolvePrediction(predictions, sample.notice_id, model, 1),
				model,
				noticeId: sample.notice_id,
			},
		]),
	);
}

function resolvePrediction(
	predictions: readonly EvalPrediction[],
	noticeId: number,
	model: string,
	run: 1 | 2 | 3,
): NoticeCategory | null {
	return (
		predictions
			.filter(
				(prediction) =>
					prediction.notice_id === noticeId && prediction.model === model && prediction.run === run,
			)
			.sort((left, right) => left.attempt - right.attempt)
			.find((prediction) => prediction.status === "ok")?.category ?? null
	);
}

function calculateOperationalMetrics(
	samples: readonly EvalSample[],
	predictions: readonly EvalPrediction[],
	model: string,
): ModelOperationalMetrics {
	const values = predictions.filter((prediction) => prediction.model === model);
	const stabilityIds = new Set(
		values.filter((prediction) => prediction.run !== 1).map((prediction) => prediction.notice_id),
	);
	const tasks = [
		...samples.map((sample) => ({ noticeId: sample.notice_id, run: 1 as const })),
		...[...stabilityIds].flatMap((noticeId) => [
			{ noticeId, run: 2 as const },
			{ noticeId, run: 3 as const },
		]),
	];
	const firstValid = tasks.filter(({ noticeId, run }) =>
		values.some(
			(prediction) =>
				prediction.notice_id === noticeId &&
				prediction.run === run &&
				prediction.attempt === 1 &&
				prediction.status === "ok",
		),
	).length;
	const eventualValid = tasks.filter(
		({ noticeId, run }) => resolvePrediction(values, noticeId, model, run) !== null,
	).length;
	const latencies = values
		.filter((prediction) => prediction.status === "ok")
		.map((prediction) => prediction.elapsed_ms)
		.sort((left, right) => left - right);
	let stable = 0;
	for (const noticeId of stabilityIds) {
		const categories = ([1, 2, 3] as const).map((run) =>
			resolvePrediction(values, noticeId, model, run),
		);
		if (categories.every((category) => category !== null) && new Set(categories).size === 1) {
			stable += 1;
		}
	}
	return {
		completion_tokens: sum(values.map((prediction) => prediction.completion_tokens ?? 0)),
		eventual_valid_rate: ratio(eventualValid, tasks.length),
		failed: tasks.length - eventualValid,
		first_attempt_valid_rate: ratio(firstValid, tasks.length),
		p50_ms: percentile(latencies, 0.5),
		p90_ms: percentile(latencies, 0.9),
		prompt_tokens: sum(values.map((prediction) => prediction.prompt_tokens ?? 0)),
		stable_difficult: stable,
		stability_total: stabilityIds.size,
		total_tokens: sum(values.map((prediction) => prediction.total_tokens ?? 0)),
	};
}

function calculateAggregateAgreement(
	samples: readonly EvalSample[],
	labels: ReadonlyMap<number, EvalLabel>,
	predictions: readonly EvalPrediction[],
	model: string,
): { agreed: number; agreement_rate: number | null; scoreable: number } {
	let agreed = 0;
	let scoreable = 0;
	for (const sample of samples) {
		const label = labels.get(sample.notice_id);
		if (!label) {
			continue;
		}
		for (const run of [1, 2, 3] as const) {
			const hasRun = predictions.some(
				(prediction) =>
					prediction.model === model &&
					prediction.notice_id === sample.notice_id &&
					prediction.run === run,
			);
			if (!hasRun) {
				continue;
			}
			scoreable += 1;
			if (resolvePrediction(predictions, sample.notice_id, model, run) === label.category) {
				agreed += 1;
			}
		}
	}
	return { agreed, agreement_rate: ratio(agreed, scoreable), scoreable };
}

function evaluateModelGate(
	model: string,
	profile: EvalProfile,
	random: LabelMetricSet | undefined,
	balanced: LabelMetricSet | undefined,
	evidencePoor: LabelMetricSet | undefined,
	operations: ModelOperationalMetrics | undefined,
	aggregate: { agreement_rate: number | null; scoreable: number } | undefined,
): ModelGate {
	const thresholds =
		profile === BUSINESS_ACCEPTANCE_PROFILE
			? {
					balanced_macro_f1: 0,
					eventual_valid_rate: BUSINESS_ACCEPTANCE_THRESHOLDS.eventual_valid_rate,
					first_attempt_valid_rate: BUSINESS_ACCEPTANCE_THRESHOLDS.first_attempt_valid_rate,
					minimum_aggregate_agreement: BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_aggregate_agreement,
					minimum_category_recall: BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_category_recall,
					minimum_category_support: BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_category_support,
					minimum_evidence_poor_agreement: 0,
					minimum_primary_agreement: BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_primary_agreement,
					minimum_random_agreement: BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_primary_agreement,
					minimum_random_labels: BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_random_labels,
					minimum_stability_rate: BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_stability_rate,
					minimum_stability_samples: BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_stability_samples,
				}
			: {
					balanced_macro_f1: 0.8,
					eventual_valid_rate: 1,
					first_attempt_valid_rate: 0.98,
					minimum_aggregate_agreement: 0,
					minimum_category_recall: 0.6,
					minimum_category_support: 8,
					minimum_evidence_poor_agreement: 0.7,
					minimum_primary_agreement: 0.85,
					minimum_random_agreement: 0.85,
					minimum_random_labels: 120,
					minimum_stability_rate: 0,
					minimum_stability_samples: 0,
				};
	const categoryMetrics =
		profile === BUSINESS_ACCEPTANCE_PROFILE
			? Object.values(random?.per_label ?? {}).filter(
					(metric) => metric.support >= thresholds.minimum_category_support,
				)
			: CONCRETE_CATEGORIES.map((category) => balanced?.per_label[category]);
	const minimumRecall =
		categoryMetrics.length > 0 && categoryMetrics.every((metric) => metric?.recall !== null)
			? Math.min(...categoryMetrics.map((metric) => metric?.recall ?? 0))
			: null;
	const stability = stabilityRate(operations);
	const eligibleSample =
		profile === BUSINESS_ACCEPTANCE_PROFILE
			? (random?.scoreable ?? 0) >= thresholds.minimum_random_labels &&
				aggregate?.scoreable === (random?.scoreable ?? 0) * 3 &&
				(operations?.stability_total ?? 0) >= thresholds.minimum_stability_samples &&
				operations?.stability_total === random?.scoreable &&
				categoryMetrics.length > 0
			: (random?.scoreable ?? 0) >= thresholds.minimum_random_labels &&
				categoryMetrics.every(
					(metric) => (metric?.support ?? 0) >= thresholds.minimum_category_support,
				);
	const gate: ModelGate = {
		aggregate_agreement: aggregate?.agreement_rate ?? null,
		balanced_macro_f1: balanced?.macro_f1 ?? null,
		eligible_sample: eligibleSample,
		evidence_poor_agreement: evidencePoor?.agreement_rate ?? null,
		eventual_valid_rate: operations?.eventual_valid_rate ?? null,
		first_attempt_valid_rate: operations?.first_attempt_valid_rate ?? null,
		minimum_category_recall: minimumRecall,
		model,
		passes: false,
		profile,
		random_agreement: random?.agreement_rate ?? null,
		stability_rate: stability,
		thresholds,
	};
	gate.passes =
		profile === BUSINESS_ACCEPTANCE_PROFILE
			? eligibleSample &&
				(gate.random_agreement ?? 0) >= thresholds.minimum_primary_agreement &&
				(gate.aggregate_agreement ?? 0) >= thresholds.minimum_aggregate_agreement &&
				(gate.minimum_category_recall ?? 0) >= thresholds.minimum_category_recall &&
				(gate.stability_rate ?? 0) >= thresholds.minimum_stability_rate &&
				(gate.first_attempt_valid_rate ?? 0) >= thresholds.first_attempt_valid_rate &&
				gate.eventual_valid_rate === thresholds.eventual_valid_rate
			: eligibleSample &&
				(gate.random_agreement ?? 0) >= thresholds.minimum_random_agreement &&
				(gate.balanced_macro_f1 ?? 0) >= thresholds.balanced_macro_f1 &&
				(gate.minimum_category_recall ?? 0) >= thresholds.minimum_category_recall &&
				(gate.evidence_poor_agreement ?? 0) >= thresholds.minimum_evidence_poor_agreement &&
				(gate.first_attempt_valid_rate ?? 0) >= thresholds.first_attempt_valid_rate &&
				gate.eventual_valid_rate === thresholds.eventual_valid_rate;
	return gate;
}

function selectBusinessModel(
	gates: Readonly<Record<string, ModelGate>>,
	operations: Readonly<Record<string, ModelOperationalMetrics>>,
): string | null {
	const passed = Object.values(gates).filter((gate) => gate.passes);
	passed.sort(
		(left, right) =>
			(right.aggregate_agreement ?? -1) - (left.aggregate_agreement ?? -1) ||
			(right.balanced_macro_f1 ?? -1) - (left.balanced_macro_f1 ?? -1) ||
			(right.random_agreement ?? -1) - (left.random_agreement ?? -1) ||
			(right.minimum_category_recall ?? -1) - (left.minimum_category_recall ?? -1) ||
			stabilityRate(operations[right.model]) - stabilityRate(operations[left.model]) ||
			(right.first_attempt_valid_rate ?? -1) - (left.first_attempt_valid_rate ?? -1) ||
			(operations[left.model]?.total_tokens ?? Number.MAX_SAFE_INTEGER) -
				(operations[right.model]?.total_tokens ?? Number.MAX_SAFE_INTEGER) ||
			(operations[left.model]?.p90_ms ?? Number.MAX_SAFE_INTEGER) -
				(operations[right.model]?.p90_ms ?? Number.MAX_SAFE_INTEGER) ||
			left.model.localeCompare(right.model),
	);
	return passed[0]?.model ?? null;
}

function stabilityRate(metrics: ModelOperationalMetrics | undefined): number {
	return metrics?.stability_total ? metrics.stable_difficult / metrics.stability_total : 0;
}

async function runStratifyCommand(options: CliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const predictionsPath = resolve(directory, "strata-predictions.jsonl");
	const manifestPath = resolve(directory, "stratify-manifest.json");
	await assertOutputPathsAbsent([predictionsPath, manifestPath]);
	const seed = singleOption(options, "seed") ?? DEFAULT_EVAL_SEED;
	const excludedIds = await readExcludedIds(options);
	const concurrency = positiveIntegerOption(options, "concurrency", 2);
	const timeoutMs = positiveIntegerOption(options, "timeout-ms", 60_000);
	const models = resolveEvalModelList(
		options.model,
		process.env.INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL,
	);
	const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
	loadLocalNoticeSourceEnvironment(repositoryRoot);
	const store = createNoticeSourceObjectStoreFromEnv();
	let sourceCount: number;
	let inputs: NoticeClassificationTask[];
	try {
		const ids = await listNoticeSourceIds(store);
		sourceCount = ids.length;
		inputs = await loadNoticeClassificationInputs(
			store,
			ids.filter((id) => !excludedIds.has(id)),
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
	await writeJsonFile(manifestPath, {
		api: REFERENCE_INFERENCE_API,
		created_at: new Date().toISOString(),
		eligible_count: inputs.length,
		excluded_notice_ids: [...excludedIds].sort((left, right) => left - right),
		models,
		seed,
		source_count: sourceCount,
		temperature: NOTICE_CLASSIFIER_TEMPERATURE,
	} satisfies StratifyManifest);
	process.stdout.write(
		`${JSON.stringify({ eligible_count: inputs.length, predictions: predictions.length })}\n`,
	);
}

async function runSampleCommand(options: CliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const samplePath = resolve(directory, "sample.jsonl");
	const manifestPath = resolve(directory, "manifest.json");
	await assertOutputPathsAbsent([samplePath, manifestPath]);
	const stratifyManifest = await readJsonFile<StratifyManifest>(
		resolve(directory, "stratify-manifest.json"),
	);
	validateModelList(stratifyManifest.models, "stratification");
	if (
		stratifyManifest.api !== REFERENCE_INFERENCE_API ||
		stratifyManifest.temperature !== NOTICE_CLASSIFIER_TEMPERATURE
	) {
		throw new Error("stratification request does not match the current eval contract");
	}
	const predictions = await readJsonLines<StratificationPrediction>(
		resolve(directory, "strata-predictions.jsonl"),
	);
	const randomCount = positiveIntegerOption(options, "random-count", 120);
	const categoryCount = positiveIntegerOption(options, "category-count", 12);
	const categoryCountOverrides = parseCategoryCountOverrides(
		options["category-count-override"] ?? [],
	);
	const evidencePoorCount = positiveIntegerOption(options, "evidence-poor-count", 12);
	const seed = singleOption(options, "seed") ?? stratifyManifest.seed;
	const excludedIds = new Set(stratifyManifest.excluded_notice_ids);
	const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
	loadLocalNoticeSourceEnvironment(repositoryRoot);
	const store = createNoticeSourceObjectStoreFromEnv();
	let inputs: NoticeClassificationTask[];
	try {
		const ids = await listNoticeSourceIds(store);
		inputs = await loadNoticeClassificationInputs(
			store,
			ids.filter((id) => !excludedIds.has(id)),
			{ concurrency: 4 },
		);
	} finally {
		store.close();
	}
	const samples = buildEvalSample(inputs, predictions, {
		categoryCount,
		categoryCountOverrides,
		evidencePoorCount,
		randomCount,
		seed,
		stratificationModels: stratifyManifest.models,
	});
	const sampleInput = serializeJsonLines(samples);
	await writeFile(samplePath, sampleInput, { encoding: "utf8", flag: "wx" });
	await writeJsonFile(manifestPath, {
		balanced_count: samples.filter(
			(sample) => sample.split === "balanced" && sample.review_group !== "evidence_poor",
		).length,
		category_counts: resolveCategoryCounts({ categoryCount, categoryCountOverrides }),
		created_at: new Date().toISOString(),
		evidence_poor_count: evidencePoorCount,
		excluded_notice_ids: stratifyManifest.excluded_notice_ids,
		profile: BALANCED_COMPARISON_PROFILE,
		random_count: randomCount,
		review_groups: countReviewGroups(samples),
		sample_sha256: sha256(sampleInput),
		seed,
		source_count: stratifyManifest.source_count,
		stratification_models: stratifyManifest.models,
	} satisfies EvalManifest);
	process.stdout.write(`${JSON.stringify({ sample_count: samples.length })}\n`);
}

async function runRandomSampleCommand(options: CliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const samplePath = resolve(directory, "sample.jsonl");
	const manifestPath = resolve(directory, "manifest.json");
	await assertOutputPathsAbsent([samplePath, manifestPath]);
	const count = positiveIntegerOption(options, "count", 60);
	const seed = singleOption(options, "seed") ?? `${DEFAULT_EVAL_SEED}-acceptance`;
	const concurrency = positiveIntegerOption(options, "concurrency", 2);
	const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
	const evidenceRoot = resolve(
		singleOption(options, "evidence-root") ?? resolve(repositoryRoot, "var/notices/eval"),
	);
	const historicalSampleFiles = await findHistoricalSampleFiles(evidenceRoot);
	const badcaseSamplePath = resolve(
		repositoryRoot,
		"scripts/notices/golden/classification-badcases.sample.jsonl",
	);
	if (await pathExists(badcaseSamplePath)) {
		historicalSampleFiles.push(badcaseSamplePath);
	}
	historicalSampleFiles.sort();
	const excludedIds = await readExcludedIds(options);
	for (const path of historicalSampleFiles) {
		for (const value of await readJsonLines<{ notice_id: number }>(path)) {
			if (!Number.isSafeInteger(value.notice_id) || value.notice_id < 1) {
				throw new Error(`historical sample contains an invalid notice id: ${path}`);
			}
			excludedIds.add(value.notice_id);
		}
	}
	loadLocalNoticeSourceEnvironment(repositoryRoot);
	const store = createNoticeSourceObjectStoreFromEnv();
	let sourceIds: number[];
	let inputs: NoticeClassificationTask[];
	try {
		sourceIds = await listNoticeSourceIds(store);
		const selectedIds = selectRandomAcceptanceIds(sourceIds, excludedIds, count, seed);
		inputs = await loadNoticeClassificationInputs(store, selectedIds, { concurrency });
	} finally {
		store.close();
	}
	const samples = buildRandomAcceptanceSample(inputs, seed);
	const overlap = samples.filter((sample) => excludedIds.has(sample.notice_id));
	if (overlap.length > 0) {
		throw new Error(`acceptance sample overlaps historical evidence: ${overlap.length}`);
	}
	const sampleInput = serializeJsonLines(samples);
	await mkdir(directory, { recursive: true });
	await writeFile(samplePath, sampleInput, { encoding: "utf8", flag: "wx" });
	await writeJsonFile(manifestPath, {
		balanced_count: 0,
		category_counts: emptyCategoryCounts(),
		created_at: new Date().toISOString(),
		evidence_poor_count: 0,
		excluded_notice_ids: [...excludedIds].sort((left, right) => left - right),
		historical_sample_files: historicalSampleFiles.map((path) => relative(repositoryRoot, path)),
		profile: BUSINESS_ACCEPTANCE_PROFILE,
		random_count: samples.length,
		review_groups: countReviewGroups(samples),
		sample_sha256: sha256(sampleInput),
		seed,
		source_count: sourceIds.length,
		stratification_models: [],
	} satisfies EvalManifest);
	process.stdout.write(
		`${JSON.stringify({ excluded: excludedIds.size, historical_sample_files: historicalSampleFiles.length, sample_count: samples.length, sample_sha256: sha256(sampleInput), source_count: sourceIds.length })}\n`,
	);
}

async function runLabelCommand(options: CliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const labelsPath = resolve(directory, "labels.jsonl");
	const predictionsPath = resolve(directory, "label-predictions.jsonl");
	const manifestPath = resolve(directory, "label-manifest.json");
	await assertOutputPathsAbsent([labelsPath, predictionsPath, manifestPath]);
	const checkpointDirectory = resolve(directory, "label-checkpoints");
	await mkdir(checkpointDirectory, { recursive: true });
	const samplePath = resolve(directory, "sample.jsonl");
	const sampleInput = await readFile(samplePath, "utf8");
	const samples = parseJsonLines<EvalSample>(sampleInput, samplePath);
	const concurrency = positiveIntegerOption(options, "concurrency", 2);
	const timeoutMs = positiveIntegerOption(options, "timeout-ms", 60_000);
	const models = resolveEvalModelList(
		options.model,
		process.env.INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL,
	);
	if (models.length !== 1) {
		throw new Error("reference labeling requires exactly one model");
	}
	const referenceModel = models[0] as string;
	const gateway = resolveNoticeClassifierGatewayConfig(process.env);
	const client = new OpenAI({
		apiKey: gateway.apiKey,
		baseURL: gateway.baseUrl,
		fetch: createNoticeModelFetch(),
		maxRetries: 0,
		timeout: timeoutMs,
	});
	const predictionsById = new Map<number, EvalPrediction[]>();
	for (const sample of samples) {
		const checkpoint = await readOptionalJsonFile<ReferencePredictionCheckpoint>(
			resolve(checkpointDirectory, `${sample.notice_id}.json`),
		);
		if (checkpoint) {
			predictionsById.set(
				sample.notice_id,
				validateReferencePredictionCheckpoint(sample, checkpoint, referenceModel),
			);
		}
	}
	const pendingSamples = samples.filter((sample) => !predictionsById.has(sample.notice_id));
	if (predictionsById.size > 0) {
		process.stderr.write(`label resume ${predictionsById.size}/${samples.length}\n`);
	}
	let completed = 0;
	let providerBlocked = false;
	const attempted = await mapWithConcurrency(pendingSamples, concurrency, async (sample) => {
		if (providerBlocked) {
			return { sample, values: [] };
		}
		const values = await classifyForReferenceRun(client, referenceModel, sample, 1);
		completed += 1;
		if (resolvePrediction(values, sample.notice_id, referenceModel, 1)) {
			const checkpoint = buildReferencePredictionCheckpoint(sample, values, referenceModel);
			await writeJsonFile(resolve(checkpointDirectory, `${sample.notice_id}.json`), checkpoint);
			predictionsById.set(sample.notice_id, values);
		} else if (values.length === 3 && values.every((value) => value.status === "provider_error")) {
			providerBlocked = true;
		}
		if (completed % 60 === 0 || completed === pendingSamples.length) {
			process.stderr.write(
				`label progress ${completed}/${pendingSamples.length}; checkpoints ${predictionsById.size}/${samples.length}\n`,
			);
		}
		return { sample, values };
	});
	const failed = attempted.flatMap(({ sample, values }) => {
		if (values.length === 0) {
			return [];
		}
		if (resolvePrediction(values, sample.notice_id, referenceModel, 1)) {
			return [];
		}
		return [
			`${sample.notice_id} (${values.map((prediction) => prediction.status).join(",") || "missing"})`,
		];
	});
	if (failed.length > 0) {
		throw new Error(
			`reference model did not label notices: ${failed.join("; ")}; ${predictionsById.size}/${samples.length} successful checkpoints retained`,
		);
	}
	const predictions = samples.flatMap((sample) => {
		const values = predictionsById.get(sample.notice_id);
		if (!values) {
			throw new Error(`reference prediction checkpoint is missing: ${sample.notice_id}`);
		}
		return values;
	});
	const labels = buildReferenceLabels(samples, predictions, referenceModel);
	const labelsInput = serializeJsonLines(labels);
	const predictionsInput = serializeJsonLines(predictions);
	await writeFile(predictionsPath, predictionsInput, { encoding: "utf8", flag: "wx" });
	await writeFile(labelsPath, labelsInput, { encoding: "utf8", flag: "wx" });
	await writeJsonFile(manifestPath, {
		api: REFERENCE_INFERENCE_API,
		created_at: new Date().toISOString(),
		labels_sha256: sha256(labelsInput),
		model: referenceModel,
		predictions_sha256: sha256(predictionsInput),
		prompt_sha256: CLASSIFICATION_PROMPT_SHA256,
		sample_count: samples.length,
		sample_sha256: sha256(sampleInput),
		temperature: NOTICE_CLASSIFIER_TEMPERATURE,
	} satisfies EvalLabelManifest);
	process.stdout.write(
		`${JSON.stringify({ labels: labels.length, model: referenceModel, predictions: predictions.length })}\n`,
	);
}

async function loadReferenceLabelEvidence(directory: string): Promise<ReferenceLabelEvidence> {
	const samplePath = resolve(directory, "sample.jsonl");
	const labelsPath = resolve(directory, "labels.jsonl");
	const predictionsPath = resolve(directory, "label-predictions.jsonl");
	const manifestPath = resolve(directory, "label-manifest.json");
	const [sampleInput, labelsInput, predictionsInput, labelManifestInput] = await Promise.all([
		readFile(samplePath, "utf8"),
		readFile(labelsPath, "utf8"),
		readFile(predictionsPath, "utf8"),
		readFile(manifestPath, "utf8"),
	]);
	const samples = parseJsonLines<EvalSample>(sampleInput, samplePath);
	const labels = parseJsonLines<EvalLabel>(labelsInput, labelsPath);
	const predictions = parseJsonLines<EvalPrediction>(predictionsInput, predictionsPath);
	const labelManifest = JSON.parse(labelManifestInput) as EvalLabelManifest;
	validateModelList([labelManifest.model], "reference label");
	if (
		labelManifest.api !== REFERENCE_INFERENCE_API ||
		labelManifest.temperature !== NOTICE_CLASSIFIER_TEMPERATURE
	) {
		throw new Error("reference label request does not match the current eval contract");
	}
	if (labelManifest.sample_sha256 !== sha256(sampleInput)) {
		throw new Error("reference label sample changed after labeling");
	}
	if (labelManifest.labels_sha256 !== sha256(labelsInput)) {
		throw new Error("reference labels changed after labeling");
	}
	if (labelManifest.predictions_sha256 !== sha256(predictionsInput)) {
		throw new Error("reference label predictions changed after labeling");
	}
	if (labelManifest.prompt_sha256 !== CLASSIFICATION_PROMPT_SHA256) {
		throw new Error("reference label prompt does not match the current taxonomy contract");
	}
	if (labelManifest.sample_count !== samples.length) {
		throw new Error("reference label sample count does not match the manifest");
	}
	const predictionModels = [...new Set(predictions.map((prediction) => prediction.model))];
	if (predictionModels.length !== 1 || predictionModels[0] !== labelManifest.model) {
		throw new Error("reference label prediction model does not match the manifest");
	}
	validateEvalLabels(samples, labels);
	const generatedLabels = buildReferenceLabels(samples, predictions, labelManifest.model);
	if (serializeJsonLines(generatedLabels) !== labelsInput) {
		throw new Error("reference labels do not match the sealed model predictions");
	}
	return {
		labelManifest,
		labelManifestInput,
		labels,
		labelsInput,
		predictions,
		samples,
		sampleInput,
	};
}

async function runModelsCommand(options: CliOptions): Promise<void> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const predictionsPath = resolve(directory, "predictions.jsonl");
	const stabilityIdsPath = resolve(directory, "stability-ids.json");
	const runManifestPath = resolve(directory, "run-manifest.json");
	await assertOutputPathsAbsent([predictionsPath, stabilityIdsPath, runManifestPath]);
	const reference = await loadReferenceLabelEvidence(directory);
	const { labels, labelsInput, samples } = reference;
	const manifest = await readJsonFile<EvalManifest>(resolve(directory, "manifest.json"));
	const profile = resolveEvalProfile(manifest);
	if (manifest.sample_sha256 !== sha256(reference.sampleInput)) {
		throw new Error("eval sample does not match the sample manifest");
	}
	const models = resolveEvalModelList(
		options.model,
		process.env.INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL,
	);
	validateEvalModels(models, reference.labelManifest.model);
	const concurrency = positiveIntegerOption(options, "concurrency", 2);
	const stabilityCount = positiveIntegerOption(
		options,
		"stability-count",
		profile === BUSINESS_ACCEPTANCE_PROFILE ? samples.length : 30,
	);
	if (profile === BUSINESS_ACCEPTANCE_PROFILE && stabilityCount !== samples.length) {
		throw new Error("business acceptance must repeat every sample three times");
	}
	const classifiers = new Map(
		models.map((model) => [
			model,
			createOpenAINoticeModelClassifier({
				...process.env,
				INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL: model,
			}),
		]),
	);
	const primaryTasks = samples.flatMap((sample) =>
		models.map((model) => ({ model, run: 1 as const, sample })),
	);
	let completed = 0;
	const primary = (
		await mapWithConcurrency(primaryTasks, concurrency, async (task) => {
			const values = await classifyForCandidateRun(
				classifiers.get(task.model) as NoticeModelClassifier,
				task.model,
				task.sample,
				task.run,
			);
			completed += 1;
			if (completed % 60 === 0 || completed === primaryTasks.length) {
				process.stderr.write(`eval progress ${completed}/${primaryTasks.length}\n`);
			}
			return values;
		})
	).flat();
	const stabilityIdsFile = singleOption(options, "stability-ids-file");
	const difficultIds = stabilityIdsFile
		? validateStabilityIds(
				samples,
				await readJsonFile<unknown>(resolve(stabilityIdsFile)),
				stabilityCount,
			)
		: selectDifficultIds(
				{ labels, predictions: primary, samples, seed: manifest.seed },
				stabilityCount,
			);
	const samplesById = new Map(samples.map((sample) => [sample.notice_id, sample]));
	const stabilityTasks = difficultIds.flatMap((noticeId) => {
		const sample = samplesById.get(noticeId);
		if (!sample) {
			throw new Error(`difficult notice is missing: ${noticeId}`);
		}
		return models.flatMap((model) => [
			{ model, run: 2 as const, sample },
			{ model, run: 3 as const, sample },
		]);
	});
	let stabilityCompleted = 0;
	const stability = (
		await mapWithConcurrency(stabilityTasks, concurrency, async (task) => {
			const values = await classifyForCandidateRun(
				classifiers.get(task.model) as NoticeModelClassifier,
				task.model,
				task.sample,
				task.run,
			);
			stabilityCompleted += 1;
			if (stabilityCompleted % 60 === 0 || stabilityCompleted === stabilityTasks.length) {
				process.stderr.write(`stability progress ${stabilityCompleted}/${stabilityTasks.length}\n`);
			}
			return values;
		})
	).flat();
	const predictions = [...primary, ...stability];
	const predictionsInput = serializeJsonLines(predictions);
	await writeFile(predictionsPath, predictionsInput, { encoding: "utf8", flag: "wx" });
	await writeJsonFile(stabilityIdsPath, difficultIds);
	await writeJsonFile(runManifestPath, {
		api: CANDIDATE_INFERENCE_API,
		created_at: new Date().toISOString(),
		label_manifest_sha256: sha256(reference.labelManifestInput),
		labels_sha256: sha256(labelsInput),
		models,
		predictions_sha256: sha256(predictionsInput),
		prompt_sha256: PRODUCTION_PROMPT_SHA256,
		reference_model: reference.labelManifest.model,
		sample_sha256: sha256(reference.sampleInput),
		seed: manifest.seed,
		stability_count: difficultIds.length,
		temperature: NOTICE_CLASSIFIER_TEMPERATURE,
	} satisfies EvalRunManifest);
	process.stdout.write(
		`${JSON.stringify({ api: CANDIDATE_INFERENCE_API, predictions: predictions.length, stability_count: difficultIds.length })}\n`,
	);
}

export function validateEvalModels(models: readonly string[], referenceModel: string): void {
	validateModelList(models, "eval");
	if (models.includes(referenceModel)) {
		throw new Error("reference label model cannot also be an eval candidate");
	}
}

export function resolveEvalModelList(
	configuredModels: readonly string[] | undefined,
	environmentModel: string | undefined,
): string[] {
	const models =
		configuredModels && configuredModels.length > 0
			? configuredModels.map((model) => model.trim())
			: environmentModel?.trim()
				? [environmentModel.trim()]
				: [];
	validateModelList(models, "eval");
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

async function runCheckCommand(options: CliOptions): Promise<boolean> {
	const directory = resolve(requiredOption(options, "output-dir"));
	const reference = await loadReferenceLabelEvidence(directory);
	const predictionsPath = resolve(directory, "predictions.jsonl");
	const predictionsInput = await readFile(predictionsPath, "utf8");
	const predictions = parseJsonLines<EvalPrediction>(predictionsInput, predictionsPath);
	const runManifest = await readJsonFile<EvalRunManifest>(resolve(directory, "run-manifest.json"));
	const manifest = await readJsonFile<EvalManifest>(resolve(directory, "manifest.json"));
	const profile = resolveEvalProfile(manifest);
	validateEvalRunIntegrity(
		reference.labelsInput,
		reference.labelManifestInput,
		reference.sampleInput,
		reference.labelManifest.model,
		predictionsInput,
		predictions,
		runManifest,
	);
	const report = buildEvalReport(
		reference.samples,
		reference.labels,
		predictions,
		reference.labelManifest.model,
		profile,
	);
	const result = buildEvalCheckResult(report);
	process.stdout.write(`${JSON.stringify(result)}\n`);
	return result.passes;
}

export function validateEvalRunIntegrity(
	labelsInput: string,
	labelManifestInput: string,
	sampleInput: string,
	referenceModel: string,
	predictionsInput: string,
	predictions: readonly EvalPrediction[],
	manifest: Pick<
		EvalRunManifest,
		| "api"
		| "label_manifest_sha256"
		| "labels_sha256"
		| "models"
		| "predictions_sha256"
		| "prompt_sha256"
		| "reference_model"
		| "sample_sha256"
		| "temperature"
	>,
): void {
	if (
		manifest.api !== CANDIDATE_INFERENCE_API ||
		manifest.temperature !== NOTICE_CLASSIFIER_TEMPERATURE
	) {
		throw new Error("prediction request does not match the current eval contract");
	}
	const labelsSha256 = sha256(labelsInput);
	if (labelsSha256 !== manifest.labels_sha256) {
		throw new Error("reference labels changed after the model run");
	}
	if (sha256(labelManifestInput) !== manifest.label_manifest_sha256) {
		throw new Error("reference label manifest changed after the model run");
	}
	if (sha256(sampleInput) !== manifest.sample_sha256) {
		throw new Error("sample changed after the model run");
	}
	if (sha256(predictionsInput) !== manifest.predictions_sha256) {
		throw new Error("predictions changed after the model run");
	}
	if (manifest.prompt_sha256 !== PRODUCTION_PROMPT_SHA256) {
		throw new Error("prediction prompt does not match the production classifier");
	}
	if (referenceModel !== manifest.reference_model) {
		throw new Error("reference label model does not match the run manifest");
	}
	const predictionModels = [...new Set(predictions.map((prediction) => prediction.model))].sort();
	const manifestModels = [...manifest.models].sort();
	if (JSON.stringify(predictionModels) !== JSON.stringify(manifestModels)) {
		throw new Error("prediction model set does not match the run manifest");
	}
}

async function classifyForStratification(
	client: OpenAI,
	model: string,
	input: NoticeClassificationTask,
): Promise<StratificationPrediction> {
	const startedAt = performance.now();
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const response = await requestClassification(client, model, toModelInput(input.noticeTitle));
			const category = parseExactClassification(response.raw);
			if (!category) {
				return {
					attempts: attempt,
					category: null,
					elapsed_ms: Math.round(performance.now() - startedAt),
					error: `invalid classification: ${response.raw?.slice(0, 240) ?? "empty"}`,
					model,
					notice_id: input.noticeId,
					status: "invalid_output",
				};
			}
			return {
				attempts: attempt,
				category,
				completion_tokens: response.completionTokens,
				elapsed_ms: Math.round(performance.now() - startedAt),
				model,
				notice_id: input.noticeId,
				prompt_tokens: response.promptTokens,
				status: "ok",
				total_tokens: response.totalTokens,
			};
		} catch (error) {
			if (attempt === 3) {
				return {
					attempts: attempt,
					category: null,
					elapsed_ms: Math.round(performance.now() - startedAt),
					error: formatError(error),
					model,
					notice_id: input.noticeId,
					status: "provider_error",
				};
			}
			await waitForClassificationRetry(attempt);
		}
	}
	throw new Error("unreachable stratification retry state");
}

async function classifyForReferenceRun(
	client: OpenAI,
	model: string,
	sample: EvalSample,
	run: 1 | 2 | 3,
): Promise<EvalPrediction[]> {
	const predictions: EvalPrediction[] = [];
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const startedAt = performance.now();
		try {
			const response = await requestClassification(
				client,
				model,
				toModelInput(sample.notice_title),
			);
			const category = parseExactClassification(response.raw);
			if (!category) {
				predictions.push({
					attempt: attempt as 1 | 2 | 3,
					category: null,
					elapsed_ms: Math.round(performance.now() - startedAt),
					error: `invalid classification: ${response.raw?.slice(0, 240) ?? "empty"}`,
					model,
					notice_id: sample.notice_id,
					run,
					status: "invalid_output",
				});
				return predictions;
			}
			predictions.push({
				attempt: attempt as 1 | 2 | 3,
				category,
				completion_tokens: response.completionTokens,
				elapsed_ms: Math.round(performance.now() - startedAt),
				model,
				notice_id: sample.notice_id,
				prompt_tokens: response.promptTokens,
				run,
				status: "ok",
				total_tokens: response.totalTokens,
			});
			return predictions;
		} catch (error) {
			predictions.push({
				attempt: attempt as 1 | 2 | 3,
				category: null,
				elapsed_ms: Math.round(performance.now() - startedAt),
				error: formatError(error),
				model,
				notice_id: sample.notice_id,
				run,
				status: "provider_error",
			});
			if (attempt < 3) {
				await waitForClassificationRetry(attempt);
			}
		}
	}
	return predictions;
}

async function classifyForCandidateRun(
	classifier: NoticeModelClassifier,
	model: string,
	sample: EvalSample,
	run: 1 | 2 | 3,
): Promise<EvalPrediction[]> {
	const predictions: EvalPrediction[] = [];
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const startedAt = performance.now();
		try {
			const category = await classifier(sample.notice_title);
			predictions.push({
				attempt: attempt as 1 | 2 | 3,
				category,
				elapsed_ms: Math.round(performance.now() - startedAt),
				model,
				notice_id: sample.notice_id,
				run,
				status: "ok",
			});
			return predictions;
		} catch (error) {
			const providerError = error instanceof NoticeClassificationProviderError;
			predictions.push({
				attempt: attempt as 1 | 2 | 3,
				category: null,
				elapsed_ms: Math.round(performance.now() - startedAt),
				error: formatError(error),
				model,
				notice_id: sample.notice_id,
				run,
				status: providerError ? "provider_error" : "invalid_output",
			});
			if (!isRetryableNoticeClassificationError(error) || attempt === 3) {
				return predictions;
			}
			await waitForClassificationRetry(attempt);
		}
	}
	return predictions;
}

async function requestClassification(
	client: OpenAI,
	model: string,
	input: Record<string, unknown>,
): Promise<{
	completionTokens?: number;
	promptTokens?: number;
	raw: string | null;
	totalTokens?: number;
}> {
	const response = await client.chat.completions.create({
		messages: [
			{
				content: CLASSIFICATION_SYSTEM_PROMPT,
				role: "system",
			},
			{ content: JSON.stringify(input), role: "user" },
		],
		model,
		stream: false,
		temperature: NOTICE_CLASSIFIER_TEMPERATURE,
	});
	return {
		completionTokens: response.usage?.completion_tokens,
		promptTokens: response.usage?.prompt_tokens,
		raw: response.choices[0]?.message.content ?? null,
		totalTokens: response.usage?.total_tokens,
	};
}

function countReviewGroups(samples: readonly EvalSample[]): Record<EvalReviewGroup, number> {
	return {
		category_consensus: samples.filter((sample) => sample.review_group === "category_consensus")
			.length,
		category_disagreement: samples.filter(
			(sample) => sample.review_group === "category_disagreement",
		).length,
		category_shape: samples.filter((sample) => sample.review_group === "category_shape").length,
		evidence_poor: samples.filter((sample) => sample.review_group === "evidence_poor").length,
		random: samples.filter((sample) => sample.review_group === "random").length,
	};
}

function emptyCategoryCounts(): Record<ConcreteNoticeCategory, number> {
	return Object.fromEntries(CONCRETE_CATEGORIES.map((category) => [category, 0])) as Record<
		ConcreteNoticeCategory,
		number
	>;
}

function resolveEvalProfile(manifest: Pick<EvalManifest, "profile">): EvalProfile {
	const profile = manifest.profile;
	if (profile !== BALANCED_COMPARISON_PROFILE && profile !== BUSINESS_ACCEPTANCE_PROFILE) {
		throw new Error(`unknown eval profile: ${String(profile)}`);
	}
	return profile;
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

type CliOptions = Record<string, string[] | undefined>;

function parseCliOptions(argv: readonly string[]): { command: string; options: CliOptions } {
	const command = argv[0];
	if (
		!(command && ["stratify", "sample", "sample-random", "label", "run", "check"].includes(command))
	) {
		throw new Error(
			"Usage: pnpm notice:classify:eval <stratify|sample|sample-random|label|run|check> --output-dir <path>",
		);
	}
	const options: CliOptions = {};
	for (let index = 1; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error("eval options must use --key value pairs");
		}
		const normalized = key.slice(2);
		options[normalized] = [...(options[normalized] ?? []), value];
	}
	return { command, options };
}

function singleOption(options: CliOptions, key: string): string | undefined {
	const values = options[key];
	if (!values || values.length === 0) {
		return;
	}
	if (values.length !== 1) {
		throw new Error(`--${key} may only be provided once`);
	}
	return values[0];
}

function requiredOption(options: CliOptions, key: string): string {
	const value = singleOption(options, key)?.trim();
	if (!value) {
		throw new Error(`--${key} is required`);
	}
	return value;
}

function positiveIntegerOption(options: CliOptions, key: string, fallback: number): number {
	const raw = singleOption(options, key);
	if (raw === undefined) {
		return fallback;
	}
	if (!/^[1-9][0-9]*$/u.test(raw)) {
		throw new Error(`--${key} must be a positive integer`);
	}
	return Number(raw);
}

async function readExcludedIds(options: CliOptions): Promise<Set<number>> {
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
		for (const value of await readJsonLines<{ notice_id: number }>(resolve(path))) {
			if (!Number.isSafeInteger(value.notice_id) || value.notice_id < 1) {
				throw new Error(`exclude file contains an invalid notice id: ${path}`);
			}
			ids.add(value.notice_id);
		}
	}
	return ids;
}

async function findHistoricalSampleFiles(directory: string): Promise<string[]> {
	if (!(await pathExists(directory))) {
		return [];
	}
	const details = await stat(directory);
	if (!details.isDirectory()) {
		throw new Error(`evidence root is not a directory: ${directory}`);
	}
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await findHistoricalSampleFiles(path)));
		} else if (
			entry.isFile() &&
			(basename(path) === "sample.jsonl" || basename(path).endsWith(".sample.jsonl"))
		) {
			files.push(path);
		}
	}
	return files.sort();
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function writeJsonLines(path: string, values: readonly unknown[]): Promise<void> {
	await writeFile(path, serializeJsonLines(values), {
		encoding: "utf8",
		flag: "wx",
	});
}

function serializeJsonLines(values: readonly unknown[]): string {
	return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
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

async function writeJsonFile(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function assertOutputPathsAbsent(paths: readonly string[]): Promise<void> {
	for (const path of paths) {
		try {
			await access(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				continue;
			}
			throw error;
		}
		throw new Error(`output already exists: ${path}`);
	}
}

async function readJsonFile<Value>(path: string): Promise<Value> {
	return JSON.parse(await readFile(path, "utf8")) as Value;
}

async function readOptionalJsonFile<Value>(path: string): Promise<Value | undefined> {
	try {
		return await readJsonFile<Value>(path);
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
	return values[Math.min(values.length - 1, Math.floor(values.length * percentileValue))] ?? null;
}

function waitForClassificationRetry(attempt: number): Promise<void> {
	const delayMs = NOTICE_CLASSIFICATION_RETRY_DELAYS_MS[attempt - 1];
	if (delayMs === undefined) {
		throw new Error(`invalid provider retry attempt: ${attempt}`);
	}
	return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const { command, options } = parseCliOptions(argv);
	if (command === "stratify") {
		await runStratifyCommand(options);
	}
	if (command === "sample") {
		await runSampleCommand(options);
	}
	if (command === "sample-random") {
		await runRandomSampleCommand(options);
	}
	if (command === "label") {
		await runLabelCommand(options);
	}
	if (command === "run") {
		await runModelsCommand(options);
	}
	if (command === "check" && !(await runCheckCommand(options))) {
		process.exitCode = 1;
	}
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
	main().catch((error) => {
		console.error(formatError(error));
		process.exitCode = 1;
	});
}
