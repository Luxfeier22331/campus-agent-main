import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSha256Ref } from "./artifacts.ts";
import { runLocalCampusDocsChunkGovernanceReview } from "./chunk-governance-run.ts";
import { createFilesystemArtifactStore } from "./filesystem-artifact-store.ts";
import { createS3ReaderStore } from "./object-store.ts";
import type { Sha256Ref } from "./types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../var/", import.meta.url));

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseCommand(argv);
	const result = await runLocalCampusDocsChunkGovernanceReview({
		artifactRoot: ARTIFACT_ROOT,
		artifactStore: createFilesystemArtifactStore(ARTIFACT_ROOT),
		chunkSet: command.chunkSet,
		...(command.embeddingEvaluation ? { embeddingEvaluation: command.embeddingEvaluation } : {}),
		sourceStore: createS3ReaderStore(),
	});
	console.log(JSON.stringify({
		candidate_count: result.candidateCount,
		chunk_count: result.chunkCount,
		document_count: result.documentCount,
		output_directory: result.outputDirectory,
		review_item_count: result.reviewItemCount,
		run: result.run,
		sample_count: result.sampleCount,
		source_projection_sha256: result.sourceProjectionSha256,
	}, null, 2));
}

export function parseCommand(argv: readonly string[]): {
	chunkSet: Sha256Ref;
	embeddingEvaluation?: Sha256Ref;
} {
	const args = argv[0] === "--" ? argv.slice(1) : argv;
	if (args.length % 2 !== 0) usage();
	let chunkSet: Sha256Ref | undefined;
	let embeddingEvaluation: Sha256Ref | undefined;
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1] ?? "";
		if (flag === "--chunk-set" && !chunkSet) {
			chunkSet = assertSha256Ref(value, "chunk set");
			continue;
		}
		if (flag === "--embedding-evaluation" && !embeddingEvaluation) {
			embeddingEvaluation = assertSha256Ref(value, "embedding evaluation");
			continue;
		}
		usage();
	}
	if (!chunkSet) usage();
	return {
		chunkSet,
		...(embeddingEvaluation ? { embeddingEvaluation } : {}),
	};
}

function usage(): never {
	throw new Error(
		"Usage: review-chunks-local --chunk-set sha256:<id> [--embedding-evaluation sha256:<id>]",
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
