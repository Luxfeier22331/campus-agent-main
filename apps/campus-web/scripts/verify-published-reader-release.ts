import {
	docsReleaseDigest,
	docsReleaseManifestKey,
} from "../src/docs-reader-build/docs-release.ts";
import { createS3ObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";
import type { ReaderObjectStoreClient } from "../src/docs-reader-build/published-reader-types.ts";
import { assertManifestBytesSha256 } from "./build-published-reader-docs.ts";

export async function verifyPublishedReaderRelease(
	releaseId: string,
	objectStore: ReaderObjectStoreClient = createS3ObjectStore(),
): Promise<void> {
	const manifestKey = docsReleaseManifestKey(releaseId);
	const manifestBytes = await objectStore.readOptionalBytesObject({ key: manifestKey });
	if (!manifestBytes) {
		throw new Error(`missing docs reader release manifest object: ${manifestKey}`);
	}
	assertManifestBytesSha256(manifestBytes, docsReleaseDigest(releaseId));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		await verifyPublishedReaderRelease(process.argv[2] ?? "");
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
