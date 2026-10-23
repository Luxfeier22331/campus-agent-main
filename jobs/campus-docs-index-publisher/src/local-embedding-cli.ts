import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createLocalEmbeddingConnection,
	createOpenAICompatibleEmbeddingClient,
} from "@campus-agent/embedding-runtime";
import { assertSha256Ref } from "./artifacts.ts";
import { createFilesystemArtifactStore } from "./filesystem-artifact-store.ts";
import { buildCampusDocsEmbeddingSet } from "./publisher.ts";
import type { Sha256Ref } from "./types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../var/", import.meta.url));

interface LocalEmbeddingCommand {
	chunkSet: Sha256Ref;
	reuseEmbeddingSet?: Sha256Ref;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalEmbeddingCommand(argv);
	const apiKey = process.env.EMBEDDING_API_KEY?.trim();
	if (!apiKey) throw new Error("EMBEDDING_API_KEY is required");
	const baseUrl = process.env.EMBEDDING_BASE_URL?.trim();
	if (!baseUrl) throw new Error("EMBEDDING_BASE_URL is required");
	const connection = createLocalEmbeddingConnection({ apiKey, baseUrl });
	const store = createFilesystemArtifactStore(ARTIFACT_ROOT);
	const result = await buildCampusDocsEmbeddingSet({
		artifactStore: store,
		chunkSet: command.chunkSet,
		embedding: createOpenAICompatibleEmbeddingClient(connection),
		embeddingTargetSha256: connection.targetSha256,
		...(command.reuseEmbeddingSet
			? { reuseEmbeddingSet: command.reuseEmbeddingSet }
			: {}),
	});
	console.log(JSON.stringify({
		embedding_count: result.embeddingCount,
		embedding_set: result.embeddingSet,
		generated_embedding_input_count: result.generatedEmbeddingInputCount,
		reused_embedding_input_count: result.reusedEmbeddingInputCount,
	}, null, 2));
}

export function parseLocalEmbeddingCommand(
	argv: readonly string[],
): LocalEmbeddingCommand {
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
		if (!["--chunk-set", "--reuse-embedding-set"].includes(name)) {
			usage();
		}
	}
	const chunkSet = assertSha256Ref(requiredFlag(flags, "--chunk-set"), "chunk set");
	const reuse = flags.get("--reuse-embedding-set");
	return {
		chunkSet,
		...(reuse
			? { reuseEmbeddingSet: assertSha256Ref(reuse, "reuse embedding set") }
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
		"Usage: build-embeddings --chunk-set sha256:<id> [--reuse-embedding-set sha256:<id>]",
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
