import { readPublishedObject } from "./published-reader-assets.ts";
import type { ReaderObjectStoreClient, ReaderObjectStoreWriter } from "./published-reader-types.ts";
import {
	assertReaderSegmentationQuality,
	cleanReaderSegmentation,
	type ReaderSegmentationChange,
} from "./reader-segmentation.ts";
import {
	assertSha256,
	canonicalJsonBytes,
	DOCS_SOURCE_KEY,
	normalizeSourceManifest,
	sha256,
} from "./source-catalog.ts";
import { compileDocsSource } from "./source-compiler.ts";
import { publishDocsSource } from "./source-publisher.ts";
import { parseReader, parseSourceManifest } from "./source-schema.ts";
import type { DocsReader, DocsSourceManifest, ObjectRef } from "./source-types.ts";

const READER_CONCURRENCY = 4;

export interface DocsReaderSegmentationHotfixReport {
	candidateSourceDigest: `sha256:${string}`;
	changedBlockCount: number;
	changedBlocksByKind: Record<ReaderSegmentationChange["kind"], number>;
	changedReaderCount: number;
	changes: Array<{
		blocks: ReaderSegmentationChange[];
		docId: string;
		newReader: ObjectRef;
		previousReader: ObjectRef;
		versionId: string;
	}>;
	generatedAt: string;
	previousSourceDigest: `sha256:${string}`;
	readerCount: number;
	schemaVersion: "campus_docs_reader_segmentation_hotfix.v1";
	sourceKey: typeof DOCS_SOURCE_KEY;
	unresolved: Array<{
		docId: string;
		rootUnitId: string;
		text: string;
		versionId: string;
	}>;
	unresolvedBlockCount: number;
}

export interface PreparedDocsReaderSegmentationHotfix {
	candidateSource: DocsSourceManifest;
	candidateSourceBytes: Uint8Array;
	previousSourceBytes: Uint8Array;
	readerObjects: Array<{ bytes: Uint8Array; ref: ObjectRef }>;
	report: DocsReaderSegmentationHotfixReport;
}

export async function prepareDocsReaderSegmentationHotfix(input: {
	client: ReaderObjectStoreClient;
	expectedSourceDigest: string;
	generatedAt?: string;
}): Promise<PreparedDocsReaderSegmentationHotfix> {
	const client = memoizeObjectStore(input.client);
	const expectedSourceDigest = assertSha256(input.expectedSourceDigest);
	const previousSourceBytes = await readCurrentSource(client);
	const previousSourceDigest = sha256(previousSourceBytes);
	if (previousSourceDigest !== expectedSourceDigest) {
		throw new Error(
			`campus docs source digest changed: expected ${expectedSourceDigest}, received ${previousSourceDigest}`,
		);
	}
	const source = normalizeSourceManifest(
		parseSourceManifest(parseJson(previousSourceBytes, DOCS_SOURCE_KEY)),
	);
	if (!equalBytes(previousSourceBytes, canonicalJsonBytes(source))) {
		throw new Error(`${DOCS_SOURCE_KEY} must contain canonical campus_docs_source.v3 JSON`);
	}

	const preparedVersions = await mapWithConcurrency(
		source.versions,
		READER_CONCURRENCY,
		async (version) => {
			const reader = parseReader(
				parseJson(
					await readPublishedObject({ client, ref: version.reader }),
					`reader ${version.versionId}`,
				),
			);
			assertReaderIdentity(reader, version);
			const cleaned = cleanReaderSegmentation(reader);
			assertReaderSegmentationQuality(cleaned.reader);
			if (cleaned.changes.length === 0) {
				return { cleaned, readerBytes: null, readerRef: version.reader, version };
			}
			const readerBytes = canonicalJsonBytes(cleaned.reader);
			const readerRef = createReaderRef(readerBytes);
			return { cleaned, readerBytes, readerRef, version };
		},
	);

	const readerObjectMap = new Map<string, { bytes: Uint8Array; ref: ObjectRef }>();
	for (const prepared of preparedVersions) {
		if (!prepared.readerBytes) {
			continue;
		}
		const existing = readerObjectMap.get(prepared.readerRef.key);
		if (existing && !equalBytes(existing.bytes, prepared.readerBytes)) {
			throw new Error(`reader object identity is inconsistent: ${prepared.readerRef.key}`);
		}
		readerObjectMap.set(prepared.readerRef.key, {
			bytes: prepared.readerBytes,
			ref: prepared.readerRef,
		});
	}

	const readerRefs = new Map(
		preparedVersions.map((prepared) => [prepared.version.versionId, prepared.readerRef]),
	);
	const candidateSource = normalizeSourceManifest({
		...source,
		versions: source.versions.map((version) => ({
			...version,
			reader: readerRefs.get(version.versionId) ?? version.reader,
		})),
	});
	const candidateSourceBytes = canonicalJsonBytes(candidateSource);
	const readerObjects = [...readerObjectMap.values()].sort((left, right) =>
		left.ref.key.localeCompare(right.ref.key),
	);
	await compileDocsSource({
		client: overlayObjectStore(client, readerObjects),
		source: candidateSource,
	});

	const changes = preparedVersions.flatMap((prepared) =>
		prepared.cleaned.changes.length === 0
			? []
			: [
					{
						blocks: prepared.cleaned.changes,
						docId: prepared.version.docId,
						newReader: prepared.readerRef,
						previousReader: prepared.version.reader,
						versionId: prepared.version.versionId,
					},
				],
	);
	const unresolved = preparedVersions.flatMap((prepared) =>
		prepared.cleaned.unresolved.map((block) => ({
			docId: prepared.version.docId,
			rootUnitId: block.rootUnitId,
			text: block.text,
			versionId: prepared.version.versionId,
		})),
	);
	const changedBlocksByKind = {
		numbered_list: 0,
		paragraph_with_numbered_list: 0,
		paragraph_with_numbered_list_and_tail: 0,
	} satisfies DocsReaderSegmentationHotfixReport["changedBlocksByKind"];
	for (const change of changes.flatMap((entry) => entry.blocks)) {
		changedBlocksByKind[change.kind] += 1;
	}

	return {
		candidateSource,
		candidateSourceBytes,
		previousSourceBytes,
		readerObjects,
		report: {
			candidateSourceDigest: sha256(candidateSourceBytes),
			changedBlockCount: changes.reduce((total, entry) => total + entry.blocks.length, 0),
			changedBlocksByKind,
			changedReaderCount: changes.length,
			changes,
			generatedAt: input.generatedAt ?? new Date().toISOString(),
			previousSourceDigest,
			readerCount: source.versions.length,
			schemaVersion: "campus_docs_reader_segmentation_hotfix.v1",
			sourceKey: DOCS_SOURCE_KEY,
			unresolved,
			unresolvedBlockCount: unresolved.length,
		},
	};
}

export async function applyPreparedDocsReaderSegmentationHotfix(input: {
	client: ReaderObjectStoreWriter;
	prepared: PreparedDocsReaderSegmentationHotfix;
}): Promise<{
	sourceDigest: `sha256:${string}`;
	sourceUpdated: boolean;
	uploadedReaderCount: number;
}> {
	if (input.prepared.readerObjects.length === 0) {
		await assertSourceIsUnchanged(input.client, input.prepared.report.previousSourceDigest);
		return {
			sourceDigest: input.prepared.report.previousSourceDigest,
			sourceUpdated: false,
			uploadedReaderCount: 0,
		};
	}
	await assertSourceIsUnchanged(input.client, input.prepared.report.previousSourceDigest);
	const uploaded = await mapWithConcurrency(
		input.prepared.readerObjects,
		READER_CONCURRENCY,
		(object) => ensureReaderObject(input.client, object),
	);
	const published = await publishDocsSource({
		client: input.client,
		expectedCurrentDigest: input.prepared.report.previousSourceDigest,
		source: input.prepared.candidateSource,
	});
	return {
		sourceDigest: published.sourceDigest,
		sourceUpdated: true,
		uploadedReaderCount: uploaded.filter(Boolean).length,
	};
}

function createReaderRef(bytes: Uint8Array): ObjectRef {
	const digest = sha256(bytes);
	return {
		byteSize: bytes.byteLength,
		key: `campus-docs/readers/sha256/${digest.slice("sha256:".length)}/reader.json`,
		sha256: digest,
	};
}

async function ensureReaderObject(
	client: ReaderObjectStoreWriter,
	object: { bytes: Uint8Array; ref: ObjectRef },
): Promise<boolean> {
	const existing = await client.readOptionalBytesObject({ key: object.ref.key });
	if (existing && !equalBytes(existing, object.bytes)) {
		throw new Error(`existing reader object has unexpected bytes: ${object.ref.key}`);
	}
	if (!existing) {
		await client.writeBytesObject({
			body: object.bytes,
			contentType: "application/json",
			key: object.ref.key,
		});
	}
	const stored = await client.readOptionalBytesObject({ key: object.ref.key });
	if (!(stored && equalBytes(stored, object.bytes))) {
		throw new Error(`failed to verify reader object: ${object.ref.key}`);
	}
	return !existing;
}

async function assertSourceIsUnchanged(
	client: ReaderObjectStoreClient,
	expectedDigest: `sha256:${string}`,
): Promise<void> {
	const bytes = await readCurrentSource(client);
	const actualDigest = sha256(bytes);
	if (actualDigest !== expectedDigest) {
		throw new Error(
			`campus docs source digest changed: expected ${expectedDigest}, received ${actualDigest}`,
		);
	}
}

async function readCurrentSource(client: ReaderObjectStoreClient): Promise<Uint8Array> {
	const bytes = await client.readOptionalBytesObject({ key: DOCS_SOURCE_KEY });
	if (!bytes) {
		throw new Error(`missing campus docs source catalog: ${DOCS_SOURCE_KEY}`);
	}
	return bytes;
}

function overlayObjectStore(
	client: ReaderObjectStoreClient,
	objects: ReadonlyArray<{ bytes: Uint8Array; ref: ObjectRef }>,
): ReaderObjectStoreClient {
	const bytesByKey = new Map(objects.map((object) => [object.ref.key, object.bytes]));
	return {
		readOptionalBytesObject({ key }) {
			return Promise.resolve(bytesByKey.get(key)).then(
				(bytes) => bytes ?? client.readOptionalBytesObject({ key }),
			);
		},
	};
}

function memoizeObjectStore(client: ReaderObjectStoreClient): ReaderObjectStoreClient {
	const reads = new Map<string, Promise<Uint8Array | undefined>>();
	return {
		readOptionalBytesObject({ key }) {
			const existing = reads.get(key);
			if (existing) {
				return existing;
			}
			const pending = client.readOptionalBytesObject({ key });
			reads.set(key, pending);
			return pending;
		},
	};
}

function assertReaderIdentity(
	reader: DocsReader,
	version: Pick<DocsSourceManifest["versions"][number], "docId" | "versionId">,
): void {
	if (reader.docId !== version.docId || reader.versionId !== version.versionId) {
		throw new Error(`reader identity does not match docs version: ${version.versionId}`);
	}
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new Error(
			`${label} is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
	);
}

async function mapWithConcurrency<T, R>(
	values: readonly T[],
	concurrency: number,
	transform: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(values.length);
	let nextIndex = 0;
	let firstError: unknown;

	async function worker(): Promise<void> {
		while (firstError === undefined) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= values.length) {
				return;
			}
			try {
				results[index] = await transform(values[index] as T, index);
			} catch (error) {
				firstError = error;
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
	if (firstError !== undefined) {
		throw firstError;
	}
	return results;
}
