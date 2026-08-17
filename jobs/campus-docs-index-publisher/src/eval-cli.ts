import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
	evaluateChunks,
	readChunkEvalQueryCases,
	readChunkEvalReviews,
	renderChunkEvalMarkdown,
} from "./chunk-eval.ts";
import {
	buildChunks,
	loadCurrentVersions,
	parseIndexingSource,
	selectCurrentVersions,
	sourceProjectionSha256,
} from "./indexing.ts";
import { createS3ReaderStore } from "./object-store.ts";
import { CAMPUS_DOCS_SOURCE_KEY } from "./types.ts";

interface EvalCommand {
	queryCasesPath?: string;
	reportDir?: string;
	reviewsPath?: string;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const command = parseEvalCommand(argv);
	const store = createS3ReaderStore();
	const sourceBytes = await store.read(CAMPUS_DOCS_SOURCE_KEY);
	const source = parseIndexingSource(sourceBytes);
	const selections = await loadCurrentVersions({ readerStore: store, source });
	const chunks = buildSelectionChunks(selections);
	const repeatedChunks = buildSelectionChunks(selections);
	if (!isDeepStrictEqual(repeatedChunks, chunks)) {
		throw new Error("Campus docs chunk output is not deterministic");
	}
	const queryCases = command.queryCasesPath
		? await readChunkEvalQueryCases(command.queryCasesPath)
		: undefined;
	const reviews = command.reviewsPath
		? await readChunkEvalReviews(command.reviewsPath)
		: undefined;
	const report = evaluateChunks({
		chunks,
		...(queryCases ? { queryCases } : {}),
		...(reviews ? { reviews } : {}),
		selections,
		source,
	});

	const currentSourceBytes = await store.read(CAMPUS_DOCS_SOURCE_KEY);
	const currentSource = parseIndexingSource(currentSourceBytes);
	const currentProjection = sourceProjectionSha256(selectCurrentVersions(currentSource.manifest));
	if (
		currentSource.sourceDigest !== source.sourceDigest ||
		currentProjection !== report.source_projection_sha256
	) {
		throw new Error("Campus docs source changed while chunk eval was running");
	}

	const digest = source.sourceDigest.slice("sha256:".length);
	const reportDir = resolve(command.reportDir ?? `/tmp/campus-docs-chunk-eval/${digest}`);
	const jsonPath = resolve(reportDir, "report.json");
	const markdownPath = resolve(reportDir, "report.md");
	await mkdir(reportDir, { recursive: true });
	await Promise.all([
		writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
		writeFile(markdownPath, renderChunkEvalMarkdown(report), { mode: 0o600 }),
	]);

	const errorCount = report.issues.filter((issue) => issue.severity === "error").length;
	const warningCount = report.issues.filter((issue) => issue.severity === "warning").length;
	const suppliedEvaluationFailed =
		(command.queryCasesPath !== undefined && report.query_coverage.status !== "passed") ||
		(command.reviewsPath !== undefined && report.manual_review.status !== "passed");
	writeResult({
		automated_checks_passed: errorCount === 0,
		chunk_count: report.chunk_count,
		document_count: report.document_count,
		error_count: errorCount,
		issue_count: report.issues.length,
		json_report: jsonPath,
		manual_review: report.manual_review.status,
		markdown_report: markdownPath,
		query_coverage: report.query_coverage.status,
		source_digest: report.source_digest,
		warning_count: warningCount,
	});
	if (errorCount > 0 || suppliedEvaluationFailed) process.exitCode = 1;
}

function buildSelectionChunks(
	selections: Awaited<ReturnType<typeof loadCurrentVersions>>,
) {
	return selections.flatMap((selection) =>
		buildChunks({
			document: selection.document,
			reader: selection.reader,
			version: selection.version,
		}),
	);
}

export function parseEvalCommand(argv: readonly string[]): EvalCommand {
	const args = argv[0] === "--" ? argv.slice(1) : argv;
	if (args.length % 2 !== 0) usage();
	const flags = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1];
		if (!name?.startsWith("--") || !value || flags.has(name)) usage();
		flags.set(name, value);
	}
	for (const name of flags.keys()) {
		if (!["--query-cases", "--report-dir", "--reviews"].includes(name)) usage();
	}
	return {
		...(flags.get("--query-cases")
			? { queryCasesPath: resolve(flags.get("--query-cases") as string) }
			: {}),
		...(flags.get("--report-dir")
			? { reportDir: resolve(flags.get("--report-dir") as string) }
			: {}),
		...(flags.get("--reviews")
			? { reviewsPath: resolve(flags.get("--reviews") as string) }
			: {}),
	};
}

function usage(): never {
	throw new Error(
		"Usage: eval-chunks [--query-cases <path>] [--reviews <path>] [--report-dir <path>]",
	);
}

function writeResult(value: Record<string, unknown>): void {
	console.log(JSON.stringify(value, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
