import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runLocalNoticeChunkComparison } from "./comparison.ts";
import type { Sha256Ref } from "./types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../var/", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

interface LocalChunkComparisonCommand {
	baselineChunkRun: Sha256Ref;
	baselineEvaluation: Sha256Ref;
	candidateChunkRun: Sha256Ref;
	candidateEvaluation: Sha256Ref;
	questionFile: string;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalChunkComparisonCommand(argv);
	const result = await runLocalNoticeChunkComparison({
		artifactRoot: ARTIFACT_ROOT,
		...command,
	});
	console.log(
		JSON.stringify(
			{
				chunk_delta: result.report.chunkDelta,
				embedding: result.report.embedding,
				output_directory: result.outputDirectory,
				question_summary: result.report.questionSummary,
				run: result.run,
			},
			null,
			2,
		),
	);
}

export function parseLocalChunkComparisonCommand(
	argv: readonly string[],
): LocalChunkComparisonCommand {
	const args = argv[0] === "--" ? argv.slice(1) : [...argv];
	if (args.length !== 10) usage();
	const flags = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1];
		if (!name?.startsWith("--") || !value || flags.has(name)) usage();
		flags.set(name, value);
	}
	if (
		[...flags.keys()].some(
			(name) =>
				![
					"--baseline-chunk-run",
					"--baseline-evaluation",
					"--candidate-chunk-run",
					"--candidate-evaluation",
					"--questions",
				].includes(name),
		)
	) {
		usage();
	}
	return {
		baselineChunkRun: sha256Flag(flags, "--baseline-chunk-run"),
		baselineEvaluation: sha256Flag(flags, "--baseline-evaluation"),
		candidateChunkRun: sha256Flag(flags, "--candidate-chunk-run"),
		candidateEvaluation: sha256Flag(flags, "--candidate-evaluation"),
		questionFile: resolve(REPOSITORY_ROOT, requiredFlag(flags, "--questions")),
	};
}

function sha256Flag(flags: ReadonlyMap<string, string>, name: string): Sha256Ref {
	const value = requiredFlag(flags, name);
	if (!/^sha256:[0-9a-f]{64}$/u.test(value)) usage();
	return value as Sha256Ref;
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
	const value = flags.get(name)?.trim();
	if (!value) usage();
	return value;
}

function usage(): never {
	throw new Error(
		"Usage: compare-chunks-local --baseline-chunk-run sha256:<id> --candidate-chunk-run sha256:<id> --baseline-evaluation sha256:<id> --candidate-evaluation sha256:<id> --questions <path>",
	);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
