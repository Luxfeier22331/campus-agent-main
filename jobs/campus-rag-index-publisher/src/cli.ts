import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSha256Ref } from "./artifacts.ts";
import { createS3ReaderStore } from "./object-store.ts";
import { runCampusRagPublish } from "./run.ts";
import type { Sha256Ref } from "./types.ts";

type Command = {
	kind: "publish-index";
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
};

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseCommand(argv, process.env);
	const store = createS3ReaderStore();
	const result = await runCampusRagPublish({
		artifactStore: store,
		docsEmbeddingSet: command.docsEmbeddingSet,
		noticeEmbeddingSet: command.noticeEmbeddingSet,
		onEvent: writeProgress,
	});
	writeResult({
		collection: result.collection,
		no_op: result.noOp,
		point_count: result.pointCount,
	});
}

export function parseCommand(
	argv: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): Command {
	if (argv.length !== 1 || argv[0] !== "publish-index") usage();
	return {
		docsEmbeddingSet: requiredEnvRef(env, "CAMPUS_DOCS_EMBEDDING_SET"),
		kind: "publish-index",
		noticeEmbeddingSet: requiredEnvRef(env, "CAMPUS_NOTICE_EMBEDDING_SET"),
	};
}

function requiredEnvRef(env: NodeJS.ProcessEnv, name: string): Sha256Ref {
	const value = env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return assertSha256Ref(value, name);
}

function usage(): never {
	throw new Error("Usage: publish-index");
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
