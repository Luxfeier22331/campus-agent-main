import type { DocsSourceManifest } from "campus-contracts/campus-docs";
import { DOCS_SOURCE_KEY, normalizeSourceManifest } from "campus-contracts/campus-docs-node";
import { canonicalJsonBytes, sha256 } from "./artifact-digest.ts";
import type { ReaderObjectStoreWriter } from "./published-reader-types.ts";
import { compileDocsSource } from "./source-compiler.ts";

export async function publishDocsSource(input: {
	client: ReaderObjectStoreWriter;
	expectedCurrentDigest?: `sha256:${string}`;
	source: DocsSourceManifest;
}): Promise<{
	documentCount: number;
	sourceDigest: `sha256:${string}`;
	versionCount: number;
}> {
	const source = normalizeSourceManifest(input.source);
	const sourceBytes = canonicalJsonBytes(source);
	if (input.expectedCurrentDigest) {
		await assertCurrentSourceDigest(input.client, input.expectedCurrentDigest);
	}
	await compileDocsSource({ client: input.client, source });
	if (input.expectedCurrentDigest) {
		await assertCurrentSourceDigest(input.client, input.expectedCurrentDigest);
	}
	await input.client.writeBytesObject({
		body: sourceBytes,
		contentType: "application/json",
		key: DOCS_SOURCE_KEY,
	});
	const stored = await input.client.readOptionalBytesObject({ key: DOCS_SOURCE_KEY });
	if (!(stored && equalBytes(stored, sourceBytes))) {
		throw new Error(`failed to verify updated campus docs source: ${DOCS_SOURCE_KEY}`);
	}
	return {
		documentCount: source.documents.length,
		sourceDigest: sha256(sourceBytes),
		versionCount: source.versions.length,
	};
}

export async function assertCurrentSourceDigest(
	client: Pick<ReaderObjectStoreWriter, "readOptionalBytesObject">,
	expectedDigest: `sha256:${string}`,
): Promise<Uint8Array> {
	const bytes = await client.readOptionalBytesObject({ key: DOCS_SOURCE_KEY });
	if (!bytes) {
		throw new Error(`missing campus docs source catalog: ${DOCS_SOURCE_KEY}`);
	}
	const actualDigest = sha256(bytes);
	if (actualDigest !== expectedDigest) {
		throw new Error(
			`campus docs source digest changed: expected ${expectedDigest}, received ${actualDigest}`,
		);
	}
	return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
	);
}
