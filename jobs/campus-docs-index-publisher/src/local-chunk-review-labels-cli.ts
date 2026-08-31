import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSha256Ref } from "./artifacts.ts";
import { readCampusDocsChunkGovernanceRun } from "./chunk-governance.ts";
import {
	decodeCampusDocsReviewLabels,
	summarizeCampusDocsReviewLabels,
} from "./chunk-review-labels.ts";
import type { Sha256Ref } from "./types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../var/", import.meta.url));

interface ReviewLabelCommand {
	labels: string;
	reviewRun: Sha256Ref;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseCommand(argv);
	const [review, labelBytes] = await Promise.all([
		readCampusDocsChunkGovernanceRun(ARTIFACT_ROOT, command.reviewRun),
		readFile(command.labels),
	]);
	const labels = decodeCampusDocsReviewLabels(new Uint8Array(labelBytes));
	const summary = summarizeCampusDocsReviewLabels(review.reviewItems, labels);
	console.log(JSON.stringify(summary, null, 2));
}

export function parseCommand(argv: readonly string[]): ReviewLabelCommand {
	const args = argv[0] === "--" ? argv.slice(1) : argv;
	if (args.length !== 4) usage();
	let labels: string | undefined;
	let reviewRun: Sha256Ref | undefined;
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1] ?? "";
		if (flag === "--labels" && !labels && value) {
			labels = value;
			continue;
		}
		if (flag === "--review-run" && !reviewRun) {
			reviewRun = assertSha256Ref(value, "review run");
			continue;
		}
		usage();
	}
	if (!labels || !reviewRun) usage();
	return { labels, reviewRun };
}

function usage(): never {
	throw new Error(
		"Usage: summarize-chunk-review-labels-local --review-run sha256:<id> --labels <path>",
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
