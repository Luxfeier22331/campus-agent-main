import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	createOpenAICompatibleEmbeddingClient,
} from "@campus-agent/embedding-runtime";
import { createNoticeDatabasePool } from "@campus-agent/notice-database";

import { runStoredNoticeChunkBuild } from "./command.ts";
import {
	collectNoticeEmbeddingInputs,
	importLocalNoticeEmbeddingCache,
} from "./embedding-cache.ts";
import { fetchNoticeEmbeddingConnection } from "./embedding.ts";
import { buildNoticeEmbeddingSet } from "./embedding-set.ts";
import { createNoticeS3ArtifactStore } from "./object-store.ts";
import { readStoredNoticeChunkRun } from "./run-reader.ts";
import type { Sha256Ref } from "./types.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Command =
	| { kind: "build-chunks" }
	| { chunkRun: Sha256Ref; kind: "build-embeddings" }
	| {
		cacheDirectory: string;
		chunkRun: Sha256Ref;
		kind: "import-embedding-cache";
		modelTargetSha256: string;
	};

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const command = parseCommand(argv, process.env);
	const artifactStore = createNoticeS3ArtifactStore();
	if (command.kind === "build-chunks") {
		writeProgress({ stage: "chunks", status: "started" });
		const pool = createNoticeDatabasePool(process.env, { max: 1 });
		try {
			const result = await runStoredNoticeChunkBuild({ artifactStore, pool });
			writeResult({
				chunk_count: result.chunkCount,
				chunk_run: result.run,
				notice_count: result.noticeCount,
			});
		} finally {
			await pool.end();
		}
		return;
	}
	if (command.kind === "import-embedding-cache") {
		writeProgress({
			chunk_run: command.chunkRun,
			model_target_sha256: command.modelTargetSha256,
			stage: "embedding-cache-import",
			status: "started",
		});
		const chunkRun = await readStoredNoticeChunkRun(artifactStore, command.chunkRun);
		const result = await importLocalNoticeEmbeddingCache({
			artifactStore,
			cacheDirectory: command.cacheDirectory,
			modelTargetSha256: command.modelTargetSha256,
			textBySha256: collectNoticeEmbeddingInputs(chunkRun.chunks),
		});
		writeResult({
			imported_embedding_input_count: result.importedEmbeddingInputCount,
			model_target_sha256: result.modelTargetSha256,
			text_count: result.textCount,
		});
		return;
	}
	writeProgress({ chunk_run: command.chunkRun, stage: "embeddings", status: "started" });
	const connection = await fetchNoticeEmbeddingConnection();
	const result = await buildNoticeEmbeddingSet({
		artifactStore,
		chunkRun: command.chunkRun,
		embedding: createOpenAICompatibleEmbeddingClient(connection),
		modelTargetSha256: connection.targetSha256,
		onEmbeddingProgress(completedInputCount, totalInputCount) {
			writeProgress({
				completed_embedding_input_count: completedInputCount,
				stage: "embeddings",
				status: "running",
				total_embedding_input_count: totalInputCount,
			});
		},
	});
	writeResult({
		embedding_count: result.embeddingCount,
		embedding_set: result.embeddingSet,
		generated_embedding_input_count: result.generatedEmbeddingInputCount,
		reused_embedding_input_count: result.reusedEmbeddingInputCount,
	});
}

export function parseCommand(
	argv: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): Command {
	const [kind, ...args] = argv;
	if (kind === "build-chunks" && args.length === 0) return { kind };
	if (kind === "build-embeddings" && args.length === 0) {
		return { chunkRun: requiredEnvRef(env, "NOTICE_CHUNK_RUN"), kind };
	}
	if (kind === "import-embedding-cache") {
		const flags = parseFlags(args[0] === "--" ? args.slice(1) : args);
		return {
			cacheDirectory: resolve(REPOSITORY_ROOT, requiredFlag(flags, "--cache-directory")),
			chunkRun: requiredFlag(flags, "--chunk-run") as Sha256Ref,
			kind,
			modelTargetSha256: requiredFlag(flags, "--model-target-sha256"),
		};
	}
	throw new Error(
		"Usage: notice-index-publisher <build-chunks|build-embeddings|import-embedding-cache>",
	);
}

function parseFlags(args: readonly string[]): Map<string, string> {
	if (args.length === 0 || args.length % 2 !== 0) usage();
	const flags = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1]?.trim();
		if (!name?.startsWith("--") || !value || flags.has(name)) usage();
		flags.set(name, value);
	}
	for (const name of flags.keys()) {
		if (!["--cache-directory", "--chunk-run", "--model-target-sha256"].includes(name)) usage();
	}
	if (flags.size !== 3) usage();
	const chunkRun = flags.get("--chunk-run");
	if (!chunkRun || !/^sha256:[0-9a-f]{64}$/u.test(chunkRun)) {
		throw new Error("--chunk-run must be sha256:<64 lowercase hex characters>");
	}
	const modelTargetSha256 = flags.get("--model-target-sha256");
	if (!modelTargetSha256 || !/^[0-9a-f]{64}$/u.test(modelTargetSha256)) {
		throw new Error("--model-target-sha256 must be 64 lowercase hex characters");
	}
	return flags;
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
	const value = flags.get(name)?.trim();
	if (!value) usage();
	return value;
}

function usage(): never {
	throw new Error(
		"Usage: notice-index-publisher import-embedding-cache --chunk-run sha256:<id> --model-target-sha256 <sha256> --cache-directory <path>",
	);
}

function requiredEnvRef(env: NodeJS.ProcessEnv, name: string): Sha256Ref {
	const value = env[name]?.trim();
	if (!value || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
		throw new Error(`${name} must be sha256:<64 lowercase hex characters>`);
	}
	return value as Sha256Ref;
}

function writeProgress(value: Record<string, unknown>): void {
	console.log(JSON.stringify({ event: "progress", ...value }));
}

function writeResult(value: Record<string, unknown>): void {
	console.log(JSON.stringify({ event: "result", ...value }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
