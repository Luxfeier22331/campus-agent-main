import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { NoticeClassificationTask } from "notice-classifier-core/batch";
import { mapWithConcurrency } from "notice-classifier-core/concurrency";
import { NOTICE_CLASSIFIER_TEMPERATURE } from "notice-classifier-core/model";
import {
	loadEvaluationSample,
	loadLabelGold,
	loadRegressionEvidence,
	readExcludedIds,
	readJsonLines,
	readRequestedStabilityIds,
	readStoredStabilityIds,
	writeJsonFile,
	writeJsonLines,
} from "./eval-artifacts";
import {
	buildCandidateEvaluationCheckResult,
	buildCandidateEvaluationReport,
} from "./eval-metrics";
import {
	CHAT_COMPLETIONS_INFERENCE_API,
	classifyForStratification,
	createNoticeEvalClient,
	createNoticeEvalResponseClassifier,
	RESPONSES_INFERENCE_API,
	requestExactChatClassification,
	runEvaluationAttempt,
} from "./eval-provider";
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
	RANDOM_DIAGNOSTIC_PROFILE,
	type StratificationPrediction,
} from "./eval-types";
import {
	buildLabelGold,
	resolveExplicitModels,
	validateCandidatePredictions,
	validateLabelGold,
	validateRegressionPredictions,
} from "./eval-validation";
import {
	createNoticeSourceObjectStoreFromEnv,
	listNoticeSourceIds,
	loadLocalNoticeSourceEnvironment,
	loadNoticeClassificationInputs,
} from "./source";

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
	const client = createNoticeEvalClient(timeoutMs);
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
	const client = createNoticeEvalClient(timeoutMs);
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
		models.map((model) => [model, createNoticeEvalResponseClassifier(model)]),
	);
	const tasks = samples.flatMap((sample) =>
		models.flatMap((model) => {
			const repeats = stabilitySet.has(sample.notice_id) ? ([1, 2, 3] as const) : ([1] as const);
			return repeats.map((repeat) => ({ model, repeat, sample }));
		}),
	);
	let completed = 0;
	return mapWithConcurrency(tasks, concurrency, async (task) => {
		const classifier = classifiers.get(task.model);
		if (!classifier) {
			throw new Error(`missing classifier for model: ${task.model}`);
		}
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

function predictionModels(predictions: readonly EvalPrediction[]): string[] {
	const models = [...new Set(predictions.map((prediction) => prediction.model))].sort();
	return resolveExplicitModels(models, "prediction");
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
