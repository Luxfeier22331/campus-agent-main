import type { DocsSourceManifest } from "campus-contracts/campus-docs";
import { DOCS_SOURCE_KEY, normalizeSourceManifest } from "campus-contracts/campus-docs/node";
import { assertSha256, canonicalJsonBytes, sha256 } from "./artifact-digest.ts";
import type { DocsSourceObjectStore, ReaderObjectStoreWriter } from "./published-reader-types.ts";
import type { CompiledDocsSource } from "./source-compiler.ts";
import { assertDocsSourceQuality, compileDocsSource } from "./source-compiler.ts";

export const DOCS_SOURCE_RELEASE_PREFIX = "campus-docs/releases";

export interface PreparedDocsSourcePublication {
	compiled: CompiledDocsSource;
	source: DocsSourceManifest;
	sourceBytes: Uint8Array;
	sourceDigest: `sha256:${string}`;
}

type DocsSourcePublicationInput = {
	client: DocsSourceObjectStore;
} & (
	| { prepare: () => Promise<PreparedDocsSourcePublication>; source?: never }
	| { source: DocsSourceManifest | (() => Promise<DocsSourceManifest>); prepare?: never }
);

export async function publishDocsSource(input: DocsSourcePublicationInput): Promise<{
	documentCount: number;
	releaseKey: string;
	sourceDigest: `sha256:${string}`;
	versionCount: number;
}> {
	// Capture before materializing declarations or validating assets; the final PUT must
	// reject another publisher's update during that work.
	const current = await input.client.readOptionalObject({ key: DOCS_SOURCE_KEY });
	if ("prepare" in input === "source" in input) {
		throw new Error("Docs source publication requires exactly one source or prepare callback");
	}
	const candidate = input.prepare
		? await input.prepare()
		: await prepareDocsSourcePublication({
				client: input.client,
				source: typeof input.source === "function" ? await input.source() : input.source,
			});
	assertDocsSourceQuality(candidate.compiled);
	const { source, sourceBytes, sourceDigest } = candidate;
	const releaseKey = docsSourceReleaseKey(sourceDigest);
	await writeImmutableSourceRelease(input.client, releaseKey, sourceBytes);
	try {
		await input.client.writeBytesObject({
			body: sourceBytes,
			contentType: "application/json",
			...(current?.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" as const }),
			key: DOCS_SOURCE_KEY,
		});
	} catch (error) {
		if (isPreconditionFailure(error)) {
			throw new Error(
				"Docs source changed during publication; review the current source and rerun",
				{ cause: error },
			);
		}
		throw error;
	}
	return {
		documentCount: source.documents.length,
		releaseKey,
		sourceDigest,
		versionCount: source.versions.length,
	};
}

export async function prepareDocsSourcePublication(input: {
	client: DocsSourceObjectStore;
	source: DocsSourceManifest;
}): Promise<PreparedDocsSourcePublication> {
	const source = normalizeSourceManifest(input.source);
	const compiled = await compileDocsSource({ client: input.client, source });
	const sourceBytes = canonicalJsonBytes(source);
	return { compiled, source, sourceBytes, sourceDigest: sha256(sourceBytes) };
}

export function docsSourceReleaseKey(sourceDigest: `sha256:${string}`): string {
	return `${DOCS_SOURCE_RELEASE_PREFIX}/${assertSha256(sourceDigest).slice("sha256:".length)}/source.json`;
}

async function writeImmutableSourceRelease(
	client: ReaderObjectStoreWriter,
	key: string,
	body: Uint8Array,
): Promise<void> {
	try {
		await client.writeBytesObject({
			body,
			contentType: "application/json",
			ifNoneMatch: "*",
			key,
		});
	} catch (error) {
		if (!isPreconditionFailure(error)) {
			throw error;
		}
		const existing = await client.readOptionalBytesObject({ key });
		if (!(existing && equalBytes(existing, body))) {
			throw new Error(`immutable docs source release conflicts with existing object: ${key}`);
		}
	}
}

function isPreconditionFailure(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const record = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
	return record.name === "PreconditionFailed" || record.$metadata?.httpStatusCode === 412;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
	);
}
