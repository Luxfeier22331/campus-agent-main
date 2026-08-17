import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runBuildChunks } from "./chunk-command.ts";
import { createFilesystemArtifactStore } from "./filesystem-artifact-store.ts";
import { createS3ReaderStore } from "./object-store.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../var/", import.meta.url));

export async function main(): Promise<void> {
	await runBuildChunks({
		artifactStore: createFilesystemArtifactStore(ARTIFACT_ROOT),
		sourceStore: createS3ReaderStore(),
	});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
