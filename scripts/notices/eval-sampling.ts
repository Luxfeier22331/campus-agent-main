import { createHash } from "node:crypto";

import type { NoticeClassificationTask } from "notice-classifier-core/batch";

import {
	CONCRETE_CATEGORIES,
	CONCRETE_CATEGORY_SET,
	type ConcreteNoticeCategory,
	type EvalReviewGroup,
	type EvalSample,
	type EvalSampleOptions,
	type EvalSplit,
	type SelectedInput,
	type StratificationPrediction,
	type StratificationSummary,
} from "./eval-types";
import { validatePredictionRecords } from "./eval-validation";

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
