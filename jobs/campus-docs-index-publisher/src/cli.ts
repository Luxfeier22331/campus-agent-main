import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createOpenAICompatibleEmbeddingClient } from "@campus-agent/embedding-runtime";
import { assertSha256Ref } from "./artifacts.ts";
import { createPostgresIndexCatalog } from "./catalog.ts";
import { runBuildChunks } from "./chunk-command.ts";
import { fetchEmbeddingConnection } from "./embedding.ts";
import { createS3ArtifactStore } from "./object-store.ts";
import {
	buildCampusDocsEmbeddingSet,
	publishCampusDocsIndex,
} from "./publisher.ts";
import { createQdrantClient } from "./qdrant.ts";
import type { Sha256Ref } from "./types.ts";

type Command =
	| { kind: "build-chunks" }
	| { chunkSet: Sha256Ref; kind: "build-embeddings"; reuseEmbeddingSet?: Sha256Ref }
	| { embeddingSet: Sha256Ref; kind: "publish-index" };

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const command = parseCommand(argv, process.env);
	const store = createS3ArtifactStore();
	switch (command.kind) {
		case "build-chunks": {
			writeProgress({ stage: "chunks", status: "started" });
			await runBuildChunks({ artifactStore: store, sourceStore: store });
			return;
		}
		case "build-embeddings": {
			writeProgress({
				chunk_set: command.chunkSet,
				...(command.reuseEmbeddingSet
					? { reuse_embedding_set: command.reuseEmbeddingSet }
					: {}),
				stage: "embeddings",
				status: "started",
			});
			const connection = await fetchEmbeddingConnection();
			const result = await buildCampusDocsEmbeddingSet({
				artifactStore: store,
				chunkSet: command.chunkSet,
				embedding: createOpenAICompatibleEmbeddingClient(connection),
				embeddingTargetSha256: connection.targetSha256,
				onEmbeddingProgress(completedInputCount, totalInputCount) {
					writeProgress({
						completed_embedding_input_count: completedInputCount,
						stage: "embeddings",
						status: "running",
						total_embedding_input_count: totalInputCount,
					});
				},
				...(command.reuseEmbeddingSet
					? { reuseEmbeddingSet: command.reuseEmbeddingSet }
					: {}),
			});
			writeResult({
				embedding_count: result.embeddingCount,
				embedding_set: result.embeddingSet,
				generated_embedding_input_count: result.generatedEmbeddingInputCount,
				reused_embedding_input_count: result.reusedEmbeddingInputCount,
			});
			return;
		}
		case "publish-index": {
			writeProgress({
				embedding_set: command.embeddingSet,
				stage: "publish",
				status: "started",
			});
			const catalog = createPostgresIndexCatalog();
			try {
				await catalog.acquirePublisherLock();
				const result = await publishCampusDocsIndex({
					artifactStore: store,
					catalog,
					embeddingSet: command.embeddingSet,
					onPublishProgress(stage) {
						writeProgress({ stage: `publish:${stage}`, status: "running" });
					},
					qdrant: createQdrantClient(),
					sourceStore: store,
				});
				writeResult({
					collection: result.collection,
					no_op: result.noOp,
					point_count: result.pointCount,
				});
			} finally {
				await catalog.close();
			}
		}
	}
}

export function parseCommand(
	argv: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): Command {
	const [kind, ...args] = argv;
	if (kind === "build-chunks") {
		if (args.length !== 0) usage();
		return { kind };
	}
	if (kind === "build-embeddings") {
		if (args.length !== 0) usage();
		const chunkSet = requiredEnvRef(env, "CAMPUS_DOCS_CHUNK_SET");
		const reuse = optionalEnvRef(env, "CAMPUS_DOCS_REUSE_EMBEDDING_SET");
		return {
			chunkSet,
			kind,
			...(reuse ? { reuseEmbeddingSet: reuse } : {}),
		};
	}
	if (kind === "publish-index") {
		if (args.length !== 0) usage();
		const embeddingSet = requiredEnvRef(env, "CAMPUS_DOCS_EMBEDDING_SET");
		return { embeddingSet, kind };
	}
	return usage();
}

function requiredEnvRef(env: NodeJS.ProcessEnv, name: string): Sha256Ref {
	const value = env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return assertSha256Ref(value, name);
}

function optionalEnvRef(env: NodeJS.ProcessEnv, name: string): Sha256Ref | undefined {
	const value = env[name]?.trim();
	return value ? assertSha256Ref(value, name) : undefined;
}

function usage(): never {
	throw new Error(
		"Usage: build-chunks | build-embeddings | publish-index",
	);
}

function writeProgress(value: Record<string, unknown>): void {
	console.log(JSON.stringify(value));
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
