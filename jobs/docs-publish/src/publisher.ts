import {
	buildReleaseManifest,
	canonicalJsonBytes,
	normalizeProjection,
	projectionKey,
	releaseManifestKey,
	releaseRefForManifest,
} from "./release.ts";
import { parseProjection, parseReleaseManifest } from "./schema.ts";
import type { DocsObjectStore, DocsReleaseManifest, DocsReleaseRef, ObjectRef } from "./types.ts";

export async function publishDocsRelease(input: {
	inputRef: ObjectRef;
	store: DocsObjectStore;
}): Promise<DocsReleaseRef> {
	const inputBytes = await input.store.read(input.inputRef);
	const projection = normalizeProjection(parseProjection(JSON.parse(new TextDecoder().decode(inputBytes))));
	const projectionBytes = canonicalJsonBytes(projection);
	const projectionRef = await input.store.createOrVerify({
		body: projectionBytes,
		contentType: "application/json",
		key: projectionKey(releaseRefForManifest(projectionBytes).releaseId),
	});
	const manifest = buildReleaseManifest(projection, projectionRef, [input.inputRef]);
	const manifestBytes = canonicalJsonBytes(manifest);
	const release = releaseRefForManifest(manifestBytes);
	await input.store.createOrVerify({
		body: manifestBytes,
		contentType: "application/json",
		key: releaseManifestKey(release.releaseId),
	});
	return release;
}

export async function loadDocsRelease(input: {
	releaseId: string;
	store: DocsObjectStore;
}): Promise<{ bytes: Uint8Array; manifest: DocsReleaseManifest; ref: ObjectRef }> {
	const key = releaseManifestKey(input.releaseId);
	const bytes = await input.store.readByKey(key);
	if (!bytes) throw new Error(`missing docs release manifest: ${key}`);
	const actual = releaseRefForManifest(bytes).releaseId;
	if (actual !== input.releaseId) {
		throw new Error(`docs release manifest digest mismatch: expected ${input.releaseId}, received ${actual}`);
	}
	return {
		bytes,
		manifest: parseReleaseManifest(JSON.parse(new TextDecoder().decode(bytes))),
		ref: { byteSize: bytes.byteLength, key, sha256: actual },
	};
}
