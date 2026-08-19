import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { NoticeClassificationTask } from "../../packages/notice-classifier-core/src/batch";
import { NOTICE_CATEGORIES, type NoticeCategory } from "./classifier";
import {
	BUSINESS_ACCEPTANCE_PROFILE,
	BUSINESS_ACCEPTANCE_THRESHOLDS,
	buildEvalCheckResult,
	buildEvalReport,
	buildEvalSample,
	buildRandomAcceptanceSample,
	buildReferenceLabels,
	buildReferencePredictionCheckpoint,
	type EvalLabel,
	type EvalPrediction,
	type EvalSample,
	PRODUCTION_PROMPT_SHA256,
	parseCategoryCountOverrides,
	parseExactClassification,
	resolveEvalModelList,
	type StratificationPrediction,
	selectRandomAcceptanceIds,
	validateEvalLabels,
	validateEvalModels,
	validateEvalRunIntegrity,
	validateReferencePredictionCheckpoint,
	validateStabilityIds,
} from "./eval";

const CONCRETE_CATEGORIES = NOTICE_CATEGORIES.filter(
	(category): category is Exclude<NoticeCategory, "unclassified"> => category !== "unclassified",
);

test("accepts only an exact single-category JSON object", () => {
	assert.equal(parseExactClassification(' {"category":"admissions"}\n'), "admissions");
	assert.equal(parseExactClassification("admissions"), null);
	assert.equal(parseExactClassification('{"category":"admissions","reason":"title"}'), null);
	assert.equal(parseExactClassification('{"category":"unknown"}'), null);
});

test("builds deterministic disjoint random and category-balanced samples", () => {
	const inputs = Array.from({ length: 520 }, (_, index) => input(index + 1, index));
	const predictions = inputs.flatMap((value, index) => {
		const category = CONCRETE_CATEGORIES[index % CONCRETE_CATEGORIES.length] ?? "campus_news";
		return [
			stratification(value.noticeId, "model-a", category),
			stratification(value.noticeId, "model-b", category),
		];
	});
	const options = {
		categoryCount: 12,
		evidencePoorCount: 12,
		randomCount: 120,
		seed: "seed",
		stratificationModels: ["model-a", "model-b"],
	};
	const first = buildEvalSample(inputs, predictions, options);
	const second = buildEvalSample(inputs, predictions, options);
	assert.deepEqual(first, second);
	assert.equal(first.length, 300);
	assert.equal(new Set(first.map((sample) => sample.notice_id)).size, 300);
	assert.equal(first.filter((sample) => sample.split === "random").length, 120);
	assert.equal(first.filter((sample) => sample.split === "balanced").length, 180);
	assert.equal(first.filter((sample) => sample.review_group === "evidence_poor").length, 12);
	assert(first.slice(0, 120).some((sample) => sample.split === "balanced"));
	assert(first.slice(120).some((sample) => sample.split === "random"));
});

test("supports explicit rare-category quotas while preserving a 300-item sample", () => {
	const inputs = Array.from({ length: 520 }, (_, index) => input(index + 1, index));
	const categoriesById = new Map<number, NoticeCategory>();
	const predictions = inputs.flatMap((value, index) => {
		const category = CONCRETE_CATEGORIES[index % CONCRETE_CATEGORIES.length] ?? "campus_news";
		categoriesById.set(value.noticeId, category);
		return [
			stratification(value.noticeId, "model-a", category),
			stratification(value.noticeId, "model-b", category),
		];
	});
	const samples = buildEvalSample(inputs, predictions, {
		categoryCount: 12,
		categoryCountOverrides: { admissions: 11 },
		evidencePoorCount: 12,
		randomCount: 121,
		seed: "seed",
		stratificationModels: ["model-a", "model-b"],
	});

	assert.equal(samples.length, 300);
	assert.equal(samples.filter((sample) => sample.split === "random").length, 121);
	assert.equal(
		samples.filter(
			(sample) =>
				sample.split === "balanced" &&
				sample.review_group !== "evidence_poor" &&
				categoriesById.get(sample.notice_id) === "admissions",
		).length,
		11,
	);
});

test("builds a deterministic unseen random acceptance sample", () => {
	const sourceIds = Array.from({ length: 100 }, (_, index) => index + 1);
	const excludedIds = new Set([1, 2, 3, 4, 5]);
	const first = selectRandomAcceptanceIds(sourceIds, excludedIds, 60, "acceptance-seed");
	const second = selectRandomAcceptanceIds(sourceIds, excludedIds, 60, "acceptance-seed");
	assert.deepEqual(first, second);
	assert.equal(first.length, 60);
	assert.equal(new Set(first).size, 60);
	assert(first.every((noticeId) => !excludedIds.has(noticeId)));
	assert.throws(
		() => selectRandomAcceptanceIds([1, 2], new Set([1]), 2, "acceptance-seed"),
		/expected 2 unseen notices, found 1/u,
	);

	const samples = buildRandomAcceptanceSample(
		first.map((noticeId, index) => input(noticeId, index)),
		"acceptance-seed",
	);
	assert.equal(samples.length, 60);
	assert(samples.every((sample) => sample.split === "random"));
	assert(samples.every((sample) => sample.review_group === "random"));
});

test("takes eval models from CLI or runtime configuration without a source allowlist", () => {
	assert.deepEqual(resolveEvalModelList(["candidate-a", "candidate-b"], "fallback"), [
		"candidate-a",
		"candidate-b",
	]);
	assert.deepEqual(resolveEvalModelList(undefined, "runtime-model"), ["runtime-model"]);
	validateEvalModels(["candidate-a"], "reference-model");
	assert.throws(() => resolveEvalModelList(undefined, undefined), /cannot be empty/u);
	assert.throws(() => resolveEvalModelList(["candidate", "candidate"], undefined), /duplicates/u);
	assert.throws(
		() => validateEvalModels(["reference-model"], "reference-model"),
		/reference label model/u,
	);
});

test("parses only concrete positive category count overrides", () => {
	assert.deepEqual(parseCategoryCountOverrides(["admissions=11"]), { admissions: 11 });
	assert.throws(() => parseCategoryCountOverrides(["unclassified=8"]), /invalid category/u);
	assert.throws(() => parseCategoryCountOverrides(["admissions=0"]), /positive-integer/u);
	assert.throws(() => parseCategoryCountOverrides(["admissions=11", "admissions=8"]), /duplicate/u);
});

test("requires exactly one prediction from each stratification model", () => {
	const value = input(1, 0);
	assert.throws(
		() =>
			buildEvalSample(
				[value],
				[stratification(1, "model-a", "admissions"), stratification(1, "model-a", "admissions")],
				{
					categoryCount: 1,
					evidencePoorCount: 1,
					randomCount: 1,
					seed: "seed",
					stratificationModels: ["model-a", "model-b"],
				},
			),
		/incomplete stratification predictions/u,
	);
});

test("requires complete valid reference labels", () => {
	const samples = [sample(1), sample(2)];
	const labels: EvalLabel[] = [referenceLabel(1, "admissions"), referenceLabel(2, "unclassified")];
	validateEvalLabels(samples, labels);
	assert.throws(() => validateEvalLabels(samples, labels.slice(0, 1)), /complete/u);
	assert.throws(
		() =>
			validateEvalLabels(samples, [
				labels[0],
				{ category: "invalid" as NoticeCategory, notice_id: 2 },
			]),
		/invalid category/u,
	);
});

test("builds complete reference labels from one independent model", () => {
	const samples = [sample(1), sample(2)];
	const predictions = [prediction(1, "admissions"), prediction(2, "campus_operations")];
	assert.deepEqual(buildReferenceLabels(samples, predictions, "model-a"), [
		referenceLabel(1, "admissions"),
		referenceLabel(2, "campus_operations"),
	]);
	assert.throws(
		() => buildReferenceLabels(samples, predictions.slice(0, 1), "model-a"),
		/reference model did not label notice/u,
	);
});

test("resumes only reference predictions bound to the same sample and prompt", () => {
	const value = sample(1);
	const predictions = [prediction(1, "admissions")];
	const checkpoint = buildReferencePredictionCheckpoint(value, predictions, "model-a");
	assert.deepEqual(
		validateReferencePredictionCheckpoint(value, checkpoint, "model-a"),
		predictions,
	);
	assert.throws(
		() =>
			validateReferencePredictionCheckpoint(
				{ ...value, notice_title: "changed" },
				checkpoint,
				"model-a",
			),
		/sample changed/u,
	);
	assert.throws(
		() => validateReferencePredictionCheckpoint(value, checkpoint, "model-b"),
		/model changed/u,
	);
	assert.throws(
		() =>
			validateReferencePredictionCheckpoint(value, { ...checkpoint, temperature: 1 }, "model-a"),
		/request changed/u,
	);
	assert.throws(
		() => buildReferencePredictionCheckpoint(value, [prediction(1, null)], "model-a"),
		/not successful/u,
	);
});

test("validates a fixed stability sample before reusing it", () => {
	const samples = [sample(1), sample(2), sample(3)];
	assert.deepEqual(validateStabilityIds(samples, [3, 1], 2), [3, 1]);
	assert.throws(() => validateStabilityIds(samples, [1], 2), /exactly 2/u);
	assert.throws(() => validateStabilityIds(samples, [1, 1], 2), /duplicate/u);
	assert.throws(() => validateStabilityIds(samples, [1, 4], 2), /unknown notice/u);
});

test("binds checks to the sealed labels and model set", () => {
	const labelsInput = '{"category":"admissions","notice_id":1}\n';
	const labelManifestInput = '{"model":"reference-model"}\n';
	const sampleInput = `${JSON.stringify(sample(1))}\n`;
	const predictions = [prediction(1, "admissions")];
	const predictionsInput = `${JSON.stringify(predictions[0])}\n`;
	const manifest = {
		api: "responses" as const,
		label_manifest_sha256: createHash("sha256").update(labelManifestInput).digest("hex"),
		labels_sha256: createHash("sha256").update(labelsInput).digest("hex"),
		models: ["model-a"],
		predictions_sha256: createHash("sha256").update(predictionsInput).digest("hex"),
		prompt_sha256: PRODUCTION_PROMPT_SHA256,
		reference_model: "reference-model",
		sample_sha256: createHash("sha256").update(sampleInput).digest("hex"),
		temperature: 0,
	};
	validateEvalRunIntegrity(
		labelsInput,
		labelManifestInput,
		sampleInput,
		"reference-model",
		predictionsInput,
		predictions,
		manifest,
	);
	assert.throws(
		() =>
			validateEvalRunIntegrity(
				`${labelsInput}\n`,
				labelManifestInput,
				sampleInput,
				"reference-model",
				predictionsInput,
				predictions,
				manifest,
			),
		/labels changed/u,
	);
	assert.throws(
		() =>
			validateEvalRunIntegrity(
				labelsInput,
				labelManifestInput,
				sampleInput,
				"reference-model",
				predictionsInput,
				predictions,
				{
					...manifest,
					models: ["model-b"],
				},
			),
		/model set/u,
	);
	assert.throws(
		() =>
			validateEvalRunIntegrity(
				labelsInput,
				labelManifestInput,
				sampleInput,
				"reference-model",
				predictionsInput,
				predictions,
				{
					...manifest,
					temperature: 1,
				},
			),
		/request does not match/u,
	);
});

test("selects a model only after the single-category hard gate passes", () => {
	const samples: EvalSample[] = [];
	const labels: EvalLabel[] = [];
	let noticeId = 1;
	for (let index = 0; index < 120; index += 1) {
		const category = CONCRETE_CATEGORIES[index % CONCRETE_CATEGORIES.length] ?? "campus_news";
		samples.push(sample(noticeId, "random", "random"));
		labels.push(referenceLabel(noticeId, category));
		noticeId += 1;
	}
	for (const category of CONCRETE_CATEGORIES) {
		for (let index = 0; index < 12; index += 1) {
			samples.push(sample(noticeId, "balanced", "category_consensus"));
			labels.push(referenceLabel(noticeId, category));
			noticeId += 1;
		}
	}
	for (let index = 0; index < 12; index += 1) {
		samples.push(sample(noticeId, "balanced", "evidence_poor"));
		labels.push(referenceLabel(noticeId, "unclassified"));
		noticeId += 1;
	}
	const predictions = labels.map((label) => prediction(label.notice_id, label.category ?? null));
	const report = buildEvalReport(samples, labels, predictions, "reference-model");
	assert.equal(report.gates["model-a"]?.passes, true);
	assert.equal(report.reference_model, "reference-model");
	assert.equal(report.selected_model, "model-a");
	assert.deepEqual(buildEvalCheckResult(report), {
		models: {
			"model-a": {
				aggregate_agreement: 1,
				balanced_macro_f1: 1,
				eventual_valid_rate: 1,
				evidence_poor_agreement: 1,
				first_attempt_valid_rate: 1,
				minimum_category_recall: 1,
				passes: true,
				primary_agreement: 1,
				stability_rate: 0,
			},
		},
		passes: true,
		profile: "balanced_comparison_v1",
		reference_model: "reference-model",
		selected_model: "model-a",
	});
});

test("accepts the practical business thresholds at their exact boundaries", () => {
	const samples = Array.from({ length: 60 }, (_, index) => sample(index + 1));
	const labels = samples.map((value) => referenceLabel(value.notice_id, "admissions"));
	const predictions = businessBoundaryPredictions(samples, {
		aggregateCorrect: 153,
		primaryCorrect: 51,
		stable: 48,
	});
	const report = buildEvalReport(
		samples,
		labels,
		predictions,
		"reference-model",
		BUSINESS_ACCEPTANCE_PROFILE,
	);
	const gate = report.gates["model-a"];
	assert.equal(gate?.random_agreement, BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_primary_agreement);
	assert.equal(
		gate?.aggregate_agreement,
		BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_aggregate_agreement,
	);
	assert.equal(gate?.stability_rate, BUSINESS_ACCEPTANCE_THRESHOLDS.minimum_stability_rate);
	assert.equal(gate?.passes, true);
});

test("rejects business acceptance below primary, aggregate, or stability thresholds", () => {
	const samples = Array.from({ length: 60 }, (_, index) => sample(index + 1));
	const labels = samples.map((value) => referenceLabel(value.notice_id, "admissions"));
	for (const options of [
		{ aggregateCorrect: 170, primaryCorrect: 50, stable: 50 },
		{ aggregateCorrect: 152, primaryCorrect: 51, stable: 48 },
		{ aggregateCorrect: 167, primaryCorrect: 60, stable: 47 },
	]) {
		const report = buildEvalReport(
			samples,
			labels,
			businessBoundaryPredictions(samples, options),
			"reference-model",
			BUSINESS_ACCEPTANCE_PROFILE,
		);
		assert.equal(report.gates["model-a"]?.passes, false);
	}
});

test("blocks category collapse only after a category has five reference samples", () => {
	const samples = Array.from({ length: 60 }, (_, index) => sample(index + 1));
	const predictions = allRunPredictions(samples, () => "admissions");
	const fiveTeachingLabels = samples.map((value, index) =>
		referenceLabel(value.notice_id, index < 5 ? "teaching_affairs" : "admissions"),
	);
	const blocked = buildEvalReport(
		samples,
		fiveTeachingLabels,
		predictions,
		"reference-model",
		BUSINESS_ACCEPTANCE_PROFILE,
	);
	assert.equal(blocked.gates["model-a"]?.minimum_category_recall, 0);
	assert.equal(blocked.gates["model-a"]?.passes, false);

	const fourTeachingLabels = samples.map((value, index) =>
		referenceLabel(value.notice_id, index < 4 ? "teaching_affairs" : "admissions"),
	);
	const accepted = buildEvalReport(
		samples,
		fourTeachingLabels,
		predictions,
		"reference-model",
		BUSINESS_ACCEPTANCE_PROFILE,
	);
	assert.equal(accepted.gates["model-a"]?.minimum_category_recall, 1);
	assert.equal(accepted.gates["model-a"]?.passes, true);
});

function input(noticeId: number, index: number): NoticeClassificationTask {
	return {
		noticeId,
		noticeTitle: index % 5 === 0 ? `通知 ${noticeId}` : `关于事项 ${noticeId} 的办理通知`,
	};
}

function stratification(
	noticeId: number,
	model: string,
	category: NoticeCategory,
): StratificationPrediction {
	return {
		attempts: 1,
		category,
		elapsed_ms: 100,
		model,
		notice_id: noticeId,
		status: "ok",
	};
}

function sample(
	noticeId: number,
	split: "balanced" | "random" = "random",
	reviewGroup: EvalSample["review_group"] = "random",
): EvalSample {
	return {
		notice_id: noticeId,
		notice_title: `通知 ${noticeId}`,
		review_group: reviewGroup,
		split,
	};
}

function referenceLabel(noticeId: number, category: NoticeCategory): EvalLabel {
	return { category, notice_id: noticeId };
}

function prediction(noticeId: number, category: NoticeCategory | null): EvalPrediction {
	return {
		attempt: 1,
		category,
		elapsed_ms: 100,
		model: "model-a",
		notice_id: noticeId,
		run: 1,
		status: category ? "ok" : "invalid_output",
	};
}

function allRunPredictions(
	samples: readonly EvalSample[],
	categoryFor: (sample: EvalSample, run: 1 | 2 | 3) => NoticeCategory,
): EvalPrediction[] {
	return samples.flatMap((value) =>
		([1, 2, 3] as const).map((run) => ({
			...prediction(value.notice_id, categoryFor(value, run)),
			run,
		})),
	);
}

function businessBoundaryPredictions(
	samples: readonly EvalSample[],
	options: { aggregateCorrect: number; primaryCorrect: number; stable: number },
): EvalPrediction[] {
	const totalPredictions = samples.length * 3;
	if (
		options.primaryCorrect < options.stable ||
		options.aggregateCorrect < options.primaryCorrect + options.stable * 2 ||
		options.aggregateCorrect > totalPredictions
	) {
		throw new Error("unsupported business boundary fixture");
	}
	let remainingPrimaryCorrect = options.primaryCorrect - options.stable;
	let remainingAdditionalCorrect =
		options.aggregateCorrect - options.stable * 3 - remainingPrimaryCorrect;
	return samples.flatMap((value, index) => {
		if (index < options.stable) {
			return ([1, 2, 3] as const).map((run) => ({
				...prediction(value.notice_id, "admissions"),
				run,
			}));
		}
		const correctRuns = new Set<1 | 2 | 3>();
		const primaryCorrect = remainingPrimaryCorrect > 0;
		if (primaryCorrect) {
			correctRuns.add(1);
			remainingPrimaryCorrect -= 1;
		}
		for (const run of [2, 3] as const) {
			if (remainingAdditionalCorrect > 0 && !(primaryCorrect && correctRuns.size === 2)) {
				correctRuns.add(run);
				remainingAdditionalCorrect -= 1;
			}
		}
		return ([1, 2, 3] as const).map((run) => ({
			...prediction(
				value.notice_id,
				correctRuns.has(run) ? "admissions" : run === 2 ? "governance" : "campus_news",
			),
			run,
		}));
	});
}
