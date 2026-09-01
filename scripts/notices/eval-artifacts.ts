import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { EvalSample, LabelGoldEntry, RegressionCase } from "./eval-types";
import {
	assertExactObjectKeys,
	resolveCandidateStabilityIds,
	toRegressionSamples,
	validateEvalSamples,
	validateLabelGold,
	validateRegressionCases,
	validateStabilityIds,
} from "./eval-validation";

export type EvalArtifactOptions = Record<string, string[] | undefined>;

export interface RegressionEvidence {
	cases: RegressionCase[];
	samples: EvalSample[];
}

interface RegressionFixture {
	cases: RegressionCase[];
}

export async function loadEvaluationSample(directory: string): Promise<EvalSample[]> {
	const samples = await readJsonLines<EvalSample>(resolve(directory, "sample.jsonl"));
	validateEvalSamples(samples);
	if (samples.some((sample) => sample.split === "regression")) {
		throw new Error("candidate evaluation cannot use regression samples");
	}
	return samples;
}

export async function loadLabelGold(
	directory: string,
): Promise<{ labelGold: LabelGoldEntry[]; samples: EvalSample[] }> {
	const samples = await loadEvaluationSample(directory);
	const labelGold = await readJsonLines<LabelGoldEntry>(resolve(directory, "label-gold.jsonl"));
	validateLabelGold(samples, labelGold);
	return { labelGold, samples };
}

export async function loadRegressionEvidence(repositoryRoot: string): Promise<RegressionEvidence> {
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

export async function readRequestedStabilityIds(
	options: EvalArtifactOptions,
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

export async function readStoredStabilityIds(
	directory: string,
	samples: readonly EvalSample[],
): Promise<number[]> {
	const value = await readOptionalJsonFile<unknown>(resolve(directory, "stability-ids.json"));
	return resolveCandidateStabilityIds(samples, value);
}

export async function readExcludedIds(options: EvalArtifactOptions): Promise<Set<number>> {
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

export async function writeJsonLines(path: string, values: readonly unknown[]): Promise<void> {
	await writeFile(path, serializeJsonLines(values), { encoding: "utf8" });
}

export function serializeJsonLines(values: readonly unknown[]): string {
	return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}

export async function readJsonLines<Value>(path: string): Promise<Value[]> {
	return parseJsonLines<Value>(await readFile(path, "utf8"), path);
}

export function parseJsonLines<Value>(input: string, path: string): Value[] {
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

export async function readOptionalJsonFile<Value>(path: string): Promise<Value | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as Value;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}
		throw error;
	}
}

function singleOption(options: EvalArtifactOptions, key: string): string | undefined {
	const values = options[key];
	if (!values || values.length === 0) {
		return;
	}
	if (values.length !== 1) {
		throw new Error(`--${key} may only be provided once`);
	}
	return values[0];
}
