import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	artifactHex,
	assertSha256Ref,
	readChunkSet,
	readEmbeddingSet,
} from "./artifacts.ts";
import { readChunkEvalQueryCases } from "./chunk-eval.ts";
import {
	createEmbeddingConnection,
	createOpenAICompatibleEmbeddingClient,
} from "./embedding.ts";
import {
	evaluateEmbeddingSet,
	renderEmbeddingEvalMarkdown,
} from "./embedding-eval.ts";
import { createFilesystemArtifactStore } from "./filesystem-artifact-store.ts";
import type { Sha256Ref } from "./types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../var/", import.meta.url));
const DEFAULT_QUERY_CASES = fileURLToPath(new URL("../eval/query-cases.json", import.meta.url));

interface EmbeddingEvalCommand {
	baseUrl: string;
	embeddingSet: Sha256Ref;
	model: string;
	queryCasesPath: string;
	reportDir?: string;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const command = parseEmbeddingEvalCommand(argv);
	const apiKey = process.env.EMBEDDING_API_KEY?.trim();
	if (!apiKey) throw new Error("EMBEDDING_API_KEY is required");
	const store = createFilesystemArtifactStore(ARTIFACT_ROOT);
	const embeddingSet = await readEmbeddingSet(store, command.embeddingSet);
	const chunkSet = await readChunkSet(store, embeddingSet.manifest.chunkSet);
	const queryCases = await readChunkEvalQueryCases(command.queryCasesPath);
	const report = await evaluateEmbeddingSet({
		chunkSet: embeddingSet.manifest.chunkSet,
		chunks: chunkSet.chunks,
		embedding: createOpenAICompatibleEmbeddingClient(
			createEmbeddingConnection({
				apiKey,
				baseUrl: command.baseUrl,
				model: command.model,
			}),
		),
		embeddingSet: command.embeddingSet,
		embeddings: embeddingSet.embeddings,
		queryCases,
	});
	const reportDir = resolve(
		command.reportDir ??
			`/tmp/campus-docs-embedding-eval/${artifactHex(command.embeddingSet)}`,
	);
	const jsonPath = resolve(reportDir, "report.json");
	const markdownPath = resolve(reportDir, "report.md");
	await mkdir(reportDir, { recursive: true });
	await Promise.all([
		writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
		writeFile(markdownPath, renderEmbeddingEvalMarkdown(report), { mode: 0o600 }),
	]);
	console.log(JSON.stringify({
		case_count: report.case_count,
		embedding_set: report.embedding_set,
		evidence_coverage_at_k: report.metrics.evidence_coverage_at_k,
		first_relevant_mrr: report.metrics.first_relevant_mrr,
		json_report: jsonPath,
		markdown_report: markdownPath,
		root_unit_recall_at_k: report.metrics.root_unit_recall_at_k,
	}, null, 2));
}

export function parseEmbeddingEvalCommand(
	argv: readonly string[],
): EmbeddingEvalCommand {
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
		if (!["--base-url", "--embedding-set", "--model", "--query-cases", "--report-dir"].includes(name)) {
			usage();
		}
	}
	return {
		baseUrl: requiredFlag(flags, "--base-url"),
		embeddingSet: assertSha256Ref(
			requiredFlag(flags, "--embedding-set"),
			"embedding set",
		),
		model: requiredFlag(flags, "--model"),
		queryCasesPath: resolve(flags.get("--query-cases") ?? DEFAULT_QUERY_CASES),
		...(flags.get("--report-dir")
			? { reportDir: resolve(flags.get("--report-dir") as string) }
			: {}),
	};
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
	const value = flags.get(name)?.trim();
	if (!value) usage();
	return value;
}

function usage(): never {
	throw new Error(
		"Usage: eval-embeddings --embedding-set sha256:<id> --base-url <url> --model <model> [--query-cases <path>] [--report-dir <path>]",
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
