import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	createOpenAICompatibleEmbeddingClient,
} from "@campus-agent/embedding-runtime";
import { createNoticeDatabasePool } from "@campus-agent/notice-database";

import { runStoredNoticeChunkBuild } from "./command.ts";
import { fetchNoticeEmbeddingConnection } from "./embedding.ts";
import { buildNoticeEmbeddingSet } from "./embedding-set.ts";
import { createNoticeS3ArtifactStore } from "./object-store.ts";
import type { Sha256Ref } from "./types.ts";

type Command = { kind: "build-chunks" } | { chunkRun: Sha256Ref; kind: "build-embeddings" };

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
	throw new Error("Usage: notice-index-publisher <build-chunks|build-embeddings>");
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
