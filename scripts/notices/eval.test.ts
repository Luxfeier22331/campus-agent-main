import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NOTICE_CATEGORIES, type NoticeCategory } from "@campus-agent/notices";
import type { NoticeClassificationTask } from "notice-classifier-core/batch";
import {
	NoticeClassificationInvalidOutputError,
	NoticeClassificationProviderError,
} from "notice-classifier-core/classifier";
import { main } from "./eval";
import { parseEvalCliOptions } from "./eval-cli";
import {
	buildCandidateEvaluationCheckResult,
	buildCandidateEvaluationReport,
} from "./eval-metrics";
import { runEvaluationAttempt } from "./eval-provider";
import { buildRegressionEvaluationCheckResult } from "./eval-regression";
import {
	buildEvalSample,
	buildRandomDiagnosticSample,
	parseCategoryCountOverrides,
	selectRandomDiagnosticIds,
} from "./eval-sampling";
import {
	BALANCED_DIAGNOSTIC_PROFILE,
	type EvalPrediction,
	type EvalSample,
	type LabelGoldEntry,
	RANDOM_DIAGNOSTIC_PROFILE,
	type RegressionCase,
	type StratificationPrediction,
} from "./eval-types";
import {
	buildLabelGold,
	parseExactClassification,
	resolveCandidateStabilityIds,
	resolveExplicitModels,
	validateCandidatePredictions,
	validateLabelGold,
	validateStabilityIds,
} from "./eval-validation";

const CONCRETE_CATEGORIES = NOTICE_CATEGORIES.filter(
	(category): category is Exclude<NoticeCategory, "unclassified"> => category !== "unclassified",
);

test("accepts only an exact single-category JSON object", () => {
	assert.equal(parseExactClassification(' {"category":"admissions"}\n'), "admissions");
	assert.equal(parseExactClassification("admissions"), null);
	assert.equal(parseExactClassification('{"category":"admissions","reason":"title"}'), null);
	assert.equal(parseExactClassification('{"category":"unknown"}'), null);
});

test("builds an explicit deterministic model-stratified diagnostic sample", () => {
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
		randomCount: 120,
		seed: "seed",
		stratificationModels: ["model-a", "model-b"],
	};
	const first = buildEvalSample(inputs, predictions, options);
	const second = buildEvalSample(inputs, predictions, options);
	const balancedCount = 12 * CONCRETE_CATEGORIES.length;

	assert.deepEqual(first, second);
	assert.equal(first.length, 120 + balancedCount);
	assert.equal(new Set(first.map((value) => value.notice_id)).size, first.length);
	assert.equal(first.filter((value) => value.split === "random").length, 120);
	assert.equal(first.filter((value) => value.split === "balanced").length, balancedCount);
});

test("requires complete explicit stratification inputs and category quotas", () => {
	const value = input(1, 0);
	assert.throws(
		() =>
			buildEvalSample([value], [stratification(1, "model-a", "admissions")], {
				categoryCount: 1,
				randomCount: 1,
				seed: "seed",
				stratificationModels: ["model-a", "model-b"],
			}),
		/missing prediction/u,
	);
	assert.deepEqual(parseCategoryCountOverrides(["admissions=11"]), { admissions: 11 });
	assert.throws(() => parseCategoryCountOverrides(["unclassified=8"]), /invalid category/u);
	assert.throws(() => parseCategoryCountOverrides(["admissions=0"]), /positive-integer/u);
});

test("builds a deterministic random diagnostic sample using only explicit exclusions", () => {
	const sourceIds = Array.from({ length: 100 }, (_, index) => index + 1);
	const excludedIds = new Set([1, 2, 3, 4, 5]);
	const first = selectRandomDiagnosticIds(sourceIds, excludedIds, 60, "diagnostic-seed");
	const second = selectRandomDiagnosticIds(sourceIds, excludedIds, 60, "diagnostic-seed");
	assert.deepEqual(first, second);
	assert.equal(first.length, 60);
	assert(first.every((noticeId) => !excludedIds.has(noticeId)));
	assert.throws(
		() => selectRandomDiagnosticIds([1, 2], new Set([1]), 2, "diagnostic-seed"),
		/expected 2 unseen notices, found 1/u,
	);

	const samples = buildRandomDiagnosticSample(
		first.map((noticeId, index) => input(noticeId, index)),
		"diagnostic-seed",
	);
	assert(samples.every((value) => value.split === "random"));
	assert(samples.every((value) => value.review_group === "random"));
});

test("uses explicit model names, check kinds, and mutable label-gold terminology", async () => {
	assert.deepEqual(resolveExplicitModels(["candidate-a", "candidate-b"], "candidate"), [
		"candidate-a",
		"candidate-b",
	]);
	assert.throws(() => resolveExplicitModels(undefined, "candidate"), /cannot be empty/u);
	assert.throws(
		() => resolveExplicitModels(["candidate", "candidate"], "candidate"),
		/duplicates/u,
	);
	assert.equal(
		parseEvalCliOptions(["generate-label-gold", "--output-dir", "var/eval"]).command,
		"generate-label-gold",
	);
	assert.throws(
		() => parseEvalCliOptions(["freeze-label-gold", "--output-dir", "var/eval"]),
		/Usage/u,
	);
	await assert.rejects(() => main(["check", "--output-dir", "unused"]), /--kind is required/u);
	await assert.rejects(
		() => main(["check", "--output-dir", "unused", "--kind", "automatic"]),
		/--kind must be candidate or regression/u,
	);
});

test("check recalculates directly from an edited label-gold without model evidence", async () => {
	const directory = await mkdtemp(join(tmpdir(), "notice-category-eval-"));
	try {
		const samples = [sample(1)];
		await Promise.all([
			writeFile(join(directory, "sample.jsonl"), serializeJsonLines(samples)),
			writeFile(
				join(directory, "label-gold.jsonl"),
				serializeJsonLines([labelGoldEntry(1, "admissions")]),
			),
			writeFile(
				join(directory, "candidate-predictions.jsonl"),
				serializeJsonLines([okPrediction(1, "admissions")]),
			),
			writeFile(join(directory, "stability-ids.json"), "[]\n"),
		]);

		const first = JSON.parse(
			await captureStdout(() => main(["check", "--kind", "candidate", "--output-dir", directory])),
		) as { agreement: { all: Record<string, { agreement_rate: number }> } };
		assert.equal(first.agreement.all["model-a"]?.agreement_rate, 1);

		await writeFile(
			join(directory, "label-gold.jsonl"),
			serializeJsonLines([labelGoldEntry(1, "campus_news")]),
		);
		const second = JSON.parse(
			await captureStdout(() => main(["check", "--kind", "candidate", "--output-dir", directory])),
		) as { agreement: { all: Record<string, { agreement_rate: number }> } };
		assert.equal(second.agreement.all["model-a"]?.agreement_rate, 0);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("builds label-gold from raw predictions without checkpoints or sealed hashes", () => {
	const samples = [sample(1), sample(2)];
	const labelGold: LabelGoldEntry[] = [
		labelGoldEntry(1, "admissions"),
		labelGoldEntry(2, "unclassified"),
	];
	validateLabelGold(samples, labelGold);
	assert.throws(() => validateLabelGold(samples, labelGold.slice(0, 1)), /complete/u);
	assert.deepEqual(
		buildLabelGold(
			samples,
			[okPrediction(1, "admissions"), okPrediction(2, "campus_operations")],
			"model-a",
		),
		[labelGoldEntry(1, "admissions"), labelGoldEntry(2, "campus_operations")],
	);
	assert.throws(
		() =>
			buildLabelGold(samples, [okPrediction(1, "admissions"), providerPrediction(2)], "model-a"),
		/provider_error/u,
	);
});

test("runs one diagnostic attempt and preserves error classes and full causes", async () => {
	let calls = 0;
	const success = await runEvaluationAttempt({
		invoke: async () => ({
			category: "admissions",
			raw_response: '{"category":"admissions"}',
		}),
		model: "model-a",
		notice_id: 1,
		repeat: 1,
	});
	assert.equal(success.status, "ok");
	assert.equal(success.raw_response, '{"category":"admissions"}');

	const invalid = await runEvaluationAttempt({
		invoke: async () => {
			calls += 1;
			throw new NoticeClassificationInvalidOutputError("invalid model output", {
				rawResponse: "not-json",
			});
		},
		model: "model-a",
		notice_id: 1,
		repeat: 1,
	});
	assert.equal(calls, 1);
	assert.equal(invalid.status, "invalid_output");
	assert.equal(invalid.raw_response, "not-json");

	const provider = await runEvaluationAttempt({
		invoke: async () => {
			throw new NoticeClassificationProviderError("provider rejected request", {
				cause: new Error("HTTP 400 with complete response body"),
				retryable: false,
			});
		},
		model: "model-a",
		notice_id: 1,
		repeat: 1,
	});
	assert.equal(provider.status, "provider_error");
	assert.equal(provider.raw_response, undefined);
	assert.match(provider.error ?? "", /HTTP 400 with complete response body/u);

	await assert.rejects(
		() =>
			runEvaluationAttempt({
				invoke: async () => {
					throw new TypeError("local adapter bug");
				},
				model: "model-a",
				notice_id: 1,
				repeat: 1,
			}),
		/local adapter bug/u,
	);
});

test("keeps provider errors outside model response validity", () => {
	const samples = Array.from({ length: 180 }, (_, index) => sample(index + 1));
	const labelGold = samples.map((value) => labelGoldEntry(value.notice_id, "admissions"));
	const predictions = samples.flatMap((value, index) => {
		const luna =
			index < 175
				? okPrediction(value.notice_id, "admissions", { model: "gpt-5.6-luna" })
				: providerPrediction(value.notice_id, { model: "gpt-5.6-luna" });
		const deepseek =
			index < 154
				? okPrediction(value.notice_id, "admissions", { model: "deepseek" })
				: index < 169
					? invalidPrediction(value.notice_id, `invalid-${value.notice_id}`, {
							model: "deepseek",
						})
					: providerPrediction(value.notice_id, { model: "deepseek" });
		return [luna, deepseek];
	});
	const report = buildCandidateEvaluationReport(
		samples,
		labelGold,
		predictions,
		RANDOM_DIAGNOSTIC_PROFILE,
	);
	const luna = report.models["gpt-5.6-luna"]?.outcomes;
	const deepseek = report.models.deepseek?.outcomes;
	assert.equal(luna?.ok_count, 175);
	assert.equal(luna?.invalid_output_count, 0);
	assert.equal(luna?.provider_error_count, 5);
	assert.equal(luna?.response_received_count, 175);
	assert.equal(luna?.response_valid_rate, 1);
	assert.equal(deepseek?.ok_count, 154);
	assert.equal(deepseek?.invalid_output_count, 15);
	assert.equal(deepseek?.provider_error_count, 11);
	assert.equal(deepseek?.response_received_count, 169);
	assert.equal(deepseek?.response_valid_rate, 154 / 169);
	assert.equal(report.agreement.all["gpt-5.6-luna"]?.scoreable, 175);
	assert.equal(report.agreement.all.deepseek?.scoreable, 154);
	assert.equal("passes" in report, false);
	assert.equal(buildCandidateEvaluationCheckResult(report).evidence_status, "partial");
});

test("invalid output remains complete diagnostic evidence rather than a quality gate", () => {
	const report = buildCandidateEvaluationReport(
		[sample(1)],
		[labelGoldEntry(1, "admissions")],
		[invalidPrediction(1, "not-json")],
		BALANCED_DIAGNOSTIC_PROFILE,
	);
	assert.equal(report.models["model-a"]?.outcomes.invalid_output_count, 1);
	assert.equal(report.models["model-a"]?.outcomes.provider_error_count, 0);
	assert.equal(report.models["model-a"]?.outcomes.response_valid_rate, 0);
	assert.equal(buildCandidateEvaluationCheckResult(report).evidence_status, "complete");
});

test("requires raw response evidence for successful predictions", () => {
	assert.throws(
		() =>
			validateCandidatePredictions(
				[sample(1)],
				[{ ...okPrediction(1, "admissions"), raw_response: undefined }],
				["model-a"],
				[],
			),
		/no raw response/u,
	);
});

test("runs repeats only for explicitly selected stability ids", () => {
	const samples = [sample(1), sample(2), sample(3)];
	assert.deepEqual(resolveCandidateStabilityIds(samples, undefined), []);
	assert.deepEqual(resolveCandidateStabilityIds(samples, [3, 1]), [3, 1]);
	assert.deepEqual(validateStabilityIds(samples, [3, 1]), [3, 1]);
	assert.throws(() => resolveCandidateStabilityIds(samples, [1, 1]), /duplicate/u);
	assert.throws(() => resolveCandidateStabilityIds(samples, [1, 4]), /unknown notice/u);

	const predictions = [
		okPrediction(1, "admissions"),
		okPrediction(2, "campus_news"),
		okPrediction(2, "campus_news", { repeat: 2 }),
		okPrediction(2, "campus_news", { repeat: 3 }),
		okPrediction(3, "student_affairs"),
	];
	validateCandidatePredictions(samples, predictions, ["model-a"], [2]);
	assert.throws(
		() => validateCandidatePredictions(samples, predictions.slice(0, -2), ["model-a"], [2]),
		/missing prediction/u,
	);
});

test("regression defaults to one call and enables repeat analysis explicitly", () => {
	const cases = [regressionCase(1, "admissions"), regressionCase(2, "campus_news")];
	const primary = [okPrediction(1, "admissions"), okPrediction(2, "campus_news")];
	const baseline = buildRegressionEvaluationCheckResult(cases, primary, ["model-a"]);
	assert.equal(baseline.regression_case_count, 2);
	assert.equal(baseline.stability_case_count, 0);
	assert.deepEqual(baseline.models["model-a"]?.primary_agreement, {
		agreed: 2,
		rate: 1,
		scoreable: 2,
	});
	assert.equal(baseline.cases[0]?.models["model-a"]?.repeat_results.length, 1);
	assert.equal(baseline.cases[0]?.models["model-a"]?.stable_complete, null);

	const repeated = [
		...primary,
		okPrediction(2, "student_affairs", { repeat: 2 }),
		okPrediction(2, "campus_news", { repeat: 3 }),
	];
	const stability = buildRegressionEvaluationCheckResult(cases, repeated, ["model-a"], [2]);
	assert.equal(stability.stability_case_count, 1);
	assert.equal(stability.models["model-a"]?.repeat.selected_repeat_consistency, 0);
	assert.equal(stability.cases[1]?.models["model-a"]?.stable_complete, false);
	assert.throws(
		() => buildRegressionEvaluationCheckResult(cases, repeated.slice(0, -1), ["model-a"], [2]),
		/missing prediction/u,
	);
});

test("regression cases contain product labels but no historical model evidence", () => {
	const contaminatedCase = {
		...regressionCase(1, "admissions"),
		label_gold_category: "admissions",
	} as unknown as RegressionCase;
	assert.throws(
		() =>
			buildRegressionEvaluationCheckResult(
				[contaminatedCase],
				[okPrediction(1, "admissions")],
				["model-a"],
			),
		/unsupported fields/u,
	);
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
	return okPrediction(noticeId, category, { model });
}

function sample(
	noticeId: number,
	split: EvalSample["split"] = "random",
	reviewGroup: EvalSample["review_group"] = "random",
): EvalSample {
	return {
		notice_id: noticeId,
		notice_title: `通知 ${noticeId}`,
		review_group: reviewGroup,
		split,
	};
}

function labelGoldEntry(noticeId: number, category: NoticeCategory): LabelGoldEntry {
	return { category, notice_id: noticeId };
}

function regressionCase(noticeId: number, category: NoticeCategory): RegressionCase {
	return {
		boundary_group: "test boundary",
		notice_id: noticeId,
		notice_title: `通知 ${noticeId}`,
		product_expected_category: category,
		rationale: "test rationale",
	};
}

interface PredictionOptions {
	model?: string;
	repeat?: 1 | 2 | 3;
}

function okPrediction(
	noticeId: number,
	category: NoticeCategory,
	options: PredictionOptions = {},
): EvalPrediction {
	return {
		attempt: 1,
		category,
		elapsed_ms: 100,
		model: options.model ?? "model-a",
		notice_id: noticeId,
		raw_response: `{"category":"${category}"}`,
		repeat: options.repeat ?? 1,
		status: "ok",
	};
}

function invalidPrediction(
	noticeId: number,
	rawResponse: string,
	options: PredictionOptions = {},
): EvalPrediction {
	return {
		attempt: 1,
		category: null,
		elapsed_ms: 100,
		error: `NoticeClassificationInvalidOutputError: ${rawResponse}`,
		model: options.model ?? "model-a",
		notice_id: noticeId,
		raw_response: rawResponse,
		repeat: options.repeat ?? 1,
		status: "invalid_output",
	};
}

function providerPrediction(noticeId: number, options: PredictionOptions = {}): EvalPrediction {
	return {
		attempt: 1,
		category: null,
		elapsed_ms: 100,
		error: "NoticeClassificationProviderError: provider request failed\nCaused by: complete cause",
		model: options.model ?? "model-a",
		notice_id: noticeId,
		repeat: options.repeat ?? 1,
		status: "provider_error",
	};
}

function serializeJsonLines(values: readonly unknown[]): string {
	return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
	const originalWrite = process.stdout.write;
	let output = "";
	try {
		process.stdout.write = ((chunk: string | Uint8Array) => {
			output += String(chunk);
			return true;
		}) as typeof process.stdout.write;
		await run();
	} finally {
		process.stdout.write = originalWrite;
	}
	return output;
}
