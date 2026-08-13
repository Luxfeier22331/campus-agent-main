import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createS3ObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";
import type { ReaderObjectStoreWriter } from "../src/docs-reader-build/published-reader-types.ts";
import {
	applyPreparedDocsReaderSegmentationHotfix,
	prepareDocsReaderSegmentationHotfix,
} from "../src/docs-reader-build/reader-segmentation-hotfix.ts";
import { canonicalJsonBytes } from "../src/docs-reader-build/source-catalog.ts";

export interface HotfixDocsReaderSegmentationArgs {
	apply: boolean;
	expectedSourceDigest: string;
	reportDir: string;
}

export function parseHotfixDocsReaderSegmentationArgs(
	argv: string[],
): HotfixDocsReaderSegmentationArgs {
	const args = argv.filter((value) => value !== "--");
	let apply = false;
	let expectedSourceDigest = "";
	let reportDir = "";
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		if (token === "--apply") {
			apply = true;
			continue;
		}
		if (token === "--expected-source-digest") {
			expectedSourceDigest = args[index + 1]?.trim() ?? "";
			index += 1;
			continue;
		}
		if (token === "--report-dir") {
			reportDir = args[index + 1]?.trim() ?? "";
			index += 1;
			continue;
		}
		throw new Error(usage());
	}
	if (!(expectedSourceDigest && reportDir)) {
		throw new Error(usage());
	}
	return { apply, expectedSourceDigest, reportDir: resolve(reportDir) };
}

export async function hotfixDocsReaderSegmentation(input: {
	args: HotfixDocsReaderSegmentationArgs;
	client?: ReaderObjectStoreWriter;
	env?: NodeJS.ProcessEnv;
	generatedAt?: string;
}) {
	const client = input.client ?? createS3ObjectStore(input.env);
	const prepared = await prepareDocsReaderSegmentationHotfix({
		client,
		expectedSourceDigest: input.args.expectedSourceDigest,
		...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
	});
	writeReport(input.args.reportDir, prepared);
	const applied = input.args.apply
		? await applyPreparedDocsReaderSegmentationHotfix({ client, prepared })
		: null;
	if (applied) {
		writeFileSync(resolve(input.args.reportDir, "apply-result.json"), canonicalJsonBytes(applied), {
			mode: 0o600,
		});
	}
	return {
		applied: Boolean(applied?.sourceUpdated),
		candidateSourceDigest: prepared.report.candidateSourceDigest,
		changedBlockCount: prepared.report.changedBlockCount,
		changedReaderCount: prepared.report.changedReaderCount,
		previousSourceDigest: prepared.report.previousSourceDigest,
		reportDir: input.args.reportDir,
		unresolvedBlockCount: prepared.report.unresolvedBlockCount,
		uploadedReaderCount: applied?.uploadedReaderCount ?? 0,
	};
}

function writeReport(
	reportDir: string,
	prepared: Awaited<ReturnType<typeof prepareDocsReaderSegmentationHotfix>>,
): void {
	mkdirSync(reportDir, { recursive: true });
	writeFileSync(resolve(reportDir, "source.before.json"), prepared.previousSourceBytes, {
		mode: 0o600,
	});
	writeFileSync(resolve(reportDir, "source.candidate.json"), prepared.candidateSourceBytes, {
		mode: 0o600,
	});
	writeFileSync(resolve(reportDir, "report.json"), canonicalJsonBytes(prepared.report), {
		mode: 0o600,
	});
}

function usage(): string {
	return "usage: hotfix-docs-reader-segmentation --expected-source-digest <sha256:...> --report-dir <path> [--apply]";
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = parseHotfixDocsReaderSegmentationArgs(process.argv.slice(2));
	hotfixDocsReaderSegmentation({ args })
		.then((result) => console.log(JSON.stringify(result)))
		.catch((error) => {
			console.error(error instanceof Error ? error.stack || error.message : String(error));
			process.exit(1);
		});
}
