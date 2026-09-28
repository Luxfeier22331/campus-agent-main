import { withLifecycleLock } from "../../../scripts/dev/lifecycle/locks.ts";
import { resolveLocalDevRegistryPath } from "../../../scripts/dev/lifecycle/profile.ts";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertSha256Ref } from "./artifacts.ts";
import { createS3ReaderStore } from "./object-store.ts";
import { runCampusRagPublish } from "./run.ts";
import type { Sha256Ref } from "./types.ts";

export interface LocalPublishCommand {
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalPublishCommand(argv);
	const root = fileURLToPath(new URL("../../..", import.meta.url));
	const lock = resolve(dirname(resolveLocalDevRegistryPath(root)), "qdrant-materialize.lock");
	const result = await withLifecycleLock(lock, "publish-index-local", () => runCampusRagPublish({
		artifactStore: createS3ReaderStore(),
		docsEmbeddingSet: command.docsEmbeddingSet,
		noticeEmbeddingSet: command.noticeEmbeddingSet,
		onEvent: writeProgress,
	}));
	console.log(
		JSON.stringify(
			{
				collection: result.collection,
				no_op: result.noOp,
				point_count: result.pointCount,
			},
			null,
			2,
		),
	);
}

export function parseLocalPublishCommand(
	argv: readonly string[],
): LocalPublishCommand {
	const args = argv[0] === "--" ? argv.slice(1) : argv;
	if (args.length !== 4 || args.length % 2 !== 0) usage();
	const flags = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1]?.trim();
		if (!name?.startsWith("--") || !value || flags.has(name)) usage();
		flags.set(name, value);
	}
	for (const name of flags.keys()) {
		if (!["--docs-embedding-set", "--notice-embedding-set"].includes(name)) {
			usage();
		}
	}
	return {
		docsEmbeddingSet: assertSha256Ref(
			requiredFlag(flags, "--docs-embedding-set"),
			"--docs-embedding-set",
		),
		noticeEmbeddingSet: assertSha256Ref(
			requiredFlag(flags, "--notice-embedding-set"),
			"--notice-embedding-set",
		),
	};
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
	const value = flags.get(name)?.trim();
	if (!value) usage();
	return value;
}

function usage(): never {
	throw new Error(
		"Usage: publish-index-local --docs-embedding-set sha256:<id> --notice-embedding-set sha256:<id>",
	);
}

function writeProgress(value: Record<string, unknown>): void {
	console.log(JSON.stringify(value));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
