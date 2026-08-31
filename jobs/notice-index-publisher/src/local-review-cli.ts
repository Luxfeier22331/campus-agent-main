import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runLocalNoticeBroadReview } from "./broad-review.ts";
import type { Sha256Ref } from "./types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../var/", import.meta.url));

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalReviewCommand(argv);
	const result = await runLocalNoticeBroadReview({
		artifactRoot: ARTIFACT_ROOT,
		chunkRun: command.chunkRun,
	});
	console.log(
		JSON.stringify(
			{
				output_directory: result.outputDirectory,
				population_chunk_count: result.populationChunkCount,
				population_notice_count: result.populationNoticeCount,
				run: result.run,
				sample_count: result.sampleCount,
			},
			null,
		2,
		),
	);
}

export function parseLocalReviewCommand(argv: readonly string[]): { chunkRun: Sha256Ref } {
	const args = argv[0] === "--" ? argv.slice(1) : [...argv];
	if (args.length !== 2 || args[0] !== "--chunk-run" || !args[1]) usage();
	if (!/^sha256:[0-9a-f]{64}$/u.test(args[1])) usage();
	return { chunkRun: args[1] as Sha256Ref };
}

function usage(): never {
	throw new Error("Usage: review-chunks-local --chunk-run sha256:<id>");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
