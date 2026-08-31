import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSha256Ref } from "./artifacts.ts";
import { runLocalCampusDocsChunkComparison } from "./chunk-comparison.ts";
import { createFilesystemArtifactStore } from "./filesystem-artifact-store.ts";
import type { Sha256Ref } from "./types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../var/", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

interface LocalChunkComparisonCommand {
	baselineEvaluation?: Sha256Ref;
	baselineChunkSet: Sha256Ref;
	candidateEvaluation?: Sha256Ref;
	candidateChunkSet: Sha256Ref;
	questionFile?: string;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalChunkComparisonCommand(argv);
	const result = await runLocalCampusDocsChunkComparison({
		artifactRoot: ARTIFACT_ROOT,
		artifactStore: createFilesystemArtifactStore(ARTIFACT_ROOT),
		...(command.baselineEvaluation ? { baselineEvaluation: command.baselineEvaluation } : {}),
		baselineChunkSet: command.baselineChunkSet,
		...(command.candidateEvaluation ? { candidateEvaluation: command.candidateEvaluation } : {}),
		candidateChunkSet: command.candidateChunkSet,
		...(command.questionFile ? { questionFile: command.questionFile } : {}),
	});
	console.log(JSON.stringify({
		baseline_chunk_set: result.baselineChunkSet,
		candidate_chunk_set: result.candidateChunkSet,
		corpus_delta: result.report.corpusDelta,
		embedding: result.report.embedding,
		output_directory: result.outputDirectory,
		run: result.run,
		source_alignment: result.report.sourceAlignment,
	}, null, 2));
}

export function parseLocalChunkComparisonCommand(
	argv: readonly string[],
): LocalChunkComparisonCommand {
	const args = argv[0] === "--" ? argv.slice(1) : [...argv];
	if (args.length === 0 || args.length % 2 !== 0) usage();
	const flags = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1];
		if (!name?.startsWith("--") || !value || flags.has(name)) usage();
		flags.set(name, value);
	}
	if ([...flags.keys()].some((name) => ![
		"--baseline-chunk-set",
		"--baseline-evaluation",
		"--candidate-chunk-set",
		"--candidate-evaluation",
		"--questions",
	].includes(name))) {
		usage();
	}
	const baselineEvaluation = optionalSha256Flag(flags, "--baseline-evaluation");
	const candidateEvaluation = optionalSha256Flag(flags, "--candidate-evaluation");
	if (Boolean(baselineEvaluation) !== Boolean(candidateEvaluation)) usage();
	const questionFile = flags.get("--questions")?.trim();
	return {
		...(baselineEvaluation ? { baselineEvaluation } : {}),
		baselineChunkSet: assertSha256Ref(requiredFlag(flags, "--baseline-chunk-set"), "baseline chunk set"),
		...(candidateEvaluation ? { candidateEvaluation } : {}),
		candidateChunkSet: assertSha256Ref(requiredFlag(flags, "--candidate-chunk-set"), "candidate chunk set"),
		...(questionFile ? { questionFile: resolve(REPOSITORY_ROOT, questionFile) } : {}),
	};
}

function optionalSha256Flag(
	flags: ReadonlyMap<string, string>,
	name: string,
): Sha256Ref | undefined {
	const value = flags.get(name)?.trim();
	if (value === undefined) return undefined;
	return assertSha256Ref(value, name);
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
	const value = flags.get(name)?.trim();
	if (!value) usage();
	return value;
}

function usage(): never {
	throw new Error(
		"Usage: compare-chunks-local --baseline-chunk-set sha256:<id> --candidate-chunk-set sha256:<id> [--questions <path>] [--baseline-evaluation sha256:<id> --candidate-evaluation sha256:<id>]",
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
