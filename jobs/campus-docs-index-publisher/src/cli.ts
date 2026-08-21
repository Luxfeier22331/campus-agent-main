import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSha256Ref } from "./artifacts.ts";
import { createPostgresIndexCatalog } from "./catalog.ts";
import { runBuildChunks } from "./chunk-command.ts";
import {
	createOpenAICompatibleEmbeddingClient,
	fetchEmbeddingConnection,
} from "./embedding.ts";
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
	const command = parseCommand(argv);
	const store = createS3ArtifactStore();
	switch (command.kind) {
		case "build-chunks": {
			await runBuildChunks({ artifactStore: store, sourceStore: store });
			return;
		}
		case "build-embeddings": {
			const connection = await fetchEmbeddingConnection();
			const result = await buildCampusDocsEmbeddingSet({
				artifactStore: store,
				chunkSet: command.chunkSet,
				embedding: createOpenAICompatibleEmbeddingClient(connection),
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
			const catalog = createPostgresIndexCatalog();
			try {
				await catalog.acquirePublisherLock();
				const result = await publishCampusDocsIndex({
					artifactStore: store,
					catalog,
					embeddingSet: command.embeddingSet,
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

export function parseCommand(argv: string[]): Command {
	const [kind, ...rawArgs] = argv;
	const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
	if (kind === "build-chunks") {
		if (args.length !== 0) usage();
		return { kind };
	}
	const flags = parseFlags(args);
	if (kind === "build-embeddings") {
		const chunkSet = requiredRef(flags, "--chunk-set");
		const reuse = flags.get("--reuse-embedding-set");
		assertOnlyFlags(flags, ["--chunk-set", "--reuse-embedding-set"]);
		return {
			chunkSet,
			kind,
			...(reuse ? { reuseEmbeddingSet: assertSha256Ref(reuse, "reuse embedding set") } : {}),
		};
	}
	if (kind === "publish-index") {
		const embeddingSet = requiredRef(flags, "--embedding-set");
		assertOnlyFlags(flags, ["--embedding-set"]);
		return { embeddingSet, kind };
	}
	return usage();
}

function parseFlags(args: string[]): Map<string, string> {
	if (args.length % 2 !== 0) usage();
	const result = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1];
		if (!name?.startsWith("--") || !value || result.has(name)) usage();
		result.set(name, value);
	}
	return result;
}

function requiredRef(flags: Map<string, string>, name: string): Sha256Ref {
	const value = flags.get(name);
	if (!value) usage();
	return assertSha256Ref(value, name.slice(2).replaceAll("-", " "));
}

function assertOnlyFlags(flags: Map<string, string>, allowed: readonly string[]): void {
	for (const flag of flags.keys()) {
		if (!allowed.includes(flag)) usage();
	}
}

function usage(): never {
	throw new Error(
		"Usage: build-chunks | build-embeddings --chunk-set sha256:<id> [--reuse-embedding-set sha256:<id>] | publish-index --embedding-set sha256:<id>",
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
