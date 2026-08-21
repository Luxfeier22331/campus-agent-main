import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSha256Ref } from "./artifacts.ts";
import { createPostgresIndexCatalog } from "./catalog.ts";
import { createFilesystemArtifactStore } from "./filesystem-artifact-store.ts";
import { createS3ReaderStore } from "./object-store.ts";
import { publishCampusDocsIndex } from "./publisher.ts";
import { createQdrantClient } from "./qdrant.ts";
import type { Sha256Ref } from "./types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../var/", import.meta.url));

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalPublishCommand(argv);
	const artifactStore = createFilesystemArtifactStore(ARTIFACT_ROOT);
	const catalog = createPostgresIndexCatalog();
	try {
		await catalog.acquirePublisherLock();
		const result = await publishCampusDocsIndex({
			artifactStore,
			catalog,
			embeddingSet: command.embeddingSet,
			qdrant: createQdrantClient(),
			sourceStore: createS3ReaderStore(),
		});
		console.log(JSON.stringify({
			collection: result.collection,
			no_op: result.noOp,
			point_count: result.pointCount,
		}, null, 2));
	} finally {
		await catalog.close();
	}
}

export function parseLocalPublishCommand(argv: readonly string[]): { embeddingSet: Sha256Ref } {
	const args = argv[0] === "--" ? argv.slice(1) : argv;
	if (args.length !== 2 || args[0] !== "--embedding-set") usage();
	return { embeddingSet: assertSha256Ref(args[1] ?? "", "embedding set") };
}

function usage(): never {
	throw new Error("Usage: publish-index-local --embedding-set sha256:<id>");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
