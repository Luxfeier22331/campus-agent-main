import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DOCS_SOURCE_KEY } from "campus-contracts/campus-docs/node";
import { recordingSnapshotReader } from "../src/docs-reader-build/docs-snapshot.ts";
import { createS3ReaderObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";
import { prepareDocsContent } from "./prepare-docs-content.ts";
import { publishDocsSourceFromDeclarations } from "./publish-docs-source.ts";

// GitOps executes the selected Source version with the existing Docs publisher credentials.
export async function prepareDocsSnapshot(destination: string): Promise<void> {
	const publication = await publishDocsSourceFromDeclarations();
	const remote = createS3ReaderObjectStore(process.env);
	const source = await remote.readOptionalBytesObject({ key: publication.releaseKey });
	if (!source) {
		throw new Error("Published Docs release is missing");
	}
	const client = await recordingSnapshotReader(destination, {
		readOptionalBytesObject: ({ key }) =>
			key === DOCS_SOURCE_KEY ? Promise.resolve(source) : remote.readOptionalBytesObject({ key }),
	});
	const scratch = await mkdtemp(resolve(tmpdir(), "campus-docs-snapshot-"));
	try {
		// Building once records every object the candidate build will read into the snapshot.
		await prepareDocsContent({ appRoot: scratch, client, pages: false, refresh: true });
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
if (import.meta.url === `file://${process.argv[1]}`) {
	if (!process.argv[2]) {
		throw new Error("Usage: prepare-docs-snapshot.ts <directory>");
	}
	await prepareDocsSnapshot(resolve(process.argv[2]));
}
