import { parseDocsReaderPayload } from "../features/docs/model.ts";
import {
	assertPublishedReaderAssetLayout,
	readPublishedObject,
} from "./published-reader-assets.ts";
import type {
	PublishedReaderManifest,
	PublishedReaderManifestEntry,
	ReaderObjectStoreClient,
} from "./published-reader-types.ts";
import { buildReaderRouteSlug, canonicalJsonBytes, sha256 } from "./source-catalog.ts";
import { materializeDocsCourseMaps } from "./source-course-maps.ts";
import { parseCourseMaps } from "./source-schema.ts";
import type {
	DocsDocument,
	DocsReader,
	DocsSourceManifest,
	DocsSupplement,
	ObjectRef,
} from "./source-types.ts";

const VERSION_COMPILE_CONCURRENCY = 4;

export interface CompiledDocsSource {
	client: ReaderObjectStoreClient;
	manifest: PublishedReaderManifest;
}

export async function compileDocsSource(input: {
	client: ReaderObjectStoreClient;
	source: DocsSourceManifest;
}): Promise<CompiledDocsSource> {
	const documents = new Map(input.source.documents.map((document) => [document.docId, document]));
	const generated = new Map<string, Uint8Array>();
	const entries = await mapWithConcurrency(
		input.source.versions,
		VERSION_COMPILE_CONCURRENCY,
		async (version): Promise<PublishedReaderManifestEntry> => {
			const document = documents.get(version.docId);
			if (!document) {
				throw new Error(`version references missing document: ${version.versionId}`);
			}
			const reader = parseDocsReaderPayload(
				parseJson(
					await readPublishedObject({
						client: input.client,
						ref: version.reader,
					}),
					`reader ${version.versionId}`,
				),
			);
			assertReaderIdentity(reader, version);
			assertReaderSupplements(reader, version);
			const supplements = await compileSupplements({
				client: input.client,
				document,
				generated,
				reader,
				supplements: version.supplements,
			});
			return {
				collection: document.collection,
				corpus: document.corpus,
				docId: document.docId,
				documentSlug: document.documentSlug,
				effectiveFrom: version.effectiveFrom,
				isCurrent: version.isCurrent,
				reader: version.reader,
				routeSlug: buildReaderRouteSlug(document),
				sourceLabel: version.sourceLabel,
				supplements,
				title: document.title,
				topicId: document.topicId,
				updatedAt: version.updatedAt,
				versionId: version.versionId,
				versionLabel: version.label,
				versionSlug: version.versionSlug,
			};
		},
	);

	const manifest: PublishedReaderManifest = {
		collections: input.source.collections,
		entries: entries.sort((left, right) =>
			`${left.corpus}/${left.collection}/${left.routeSlug}/${left.versionSlug}`.localeCompare(
				`${right.corpus}/${right.collection}/${right.routeSlug}/${right.versionSlug}`,
			),
		),
		redirects: input.source.redirects,
		topics: input.source.topics,
	};
	assertPublishedReaderAssetLayout(manifest.entries);
	return {
		client: overlayObjectStore(input.client, generated),
		manifest,
	};
}

function assertReaderSupplements(
	reader: DocsReader,
	version: Pick<DocsSourceManifest["versions"][number], "supplements" | "versionId">,
): void {
	const expected = version.supplements.map(({ kind, path }) => `${kind}:${path}`).sort();
	const actual = reader.supplements.map(({ kind, path }) => `${kind}:${path}`).sort();
	if (
		expected.length !== actual.length ||
		expected.some((value, index) => value !== actual[index])
	) {
		throw new Error(`reader supplements do not match docs version: ${version.versionId}`);
	}
}

async function compileSupplements(input: {
	client: ReaderObjectStoreClient;
	document: DocsDocument;
	generated: Map<string, Uint8Array>;
	reader: DocsReader;
	supplements: DocsSupplement[];
}): Promise<DocsSupplement[]> {
	const result: DocsSupplement[] = [];
	for (const supplement of input.supplements) {
		const sourceBytes = await readPublishedObject({ client: input.client, ref: supplement.object });
		const assets = new Map<string, Uint8Array>();
		for (const asset of supplement.assets) {
			assets.set(
				asset.path,
				await readPublishedObject({ client: input.client, ref: asset.object }),
			);
		}
		const courseMaps = materializeDocsCourseMaps({
			assets,
			documentTitle: input.document.title,
			reader: input.reader,
			sourceBytes,
		});
		parseCourseMaps(courseMaps);
		result.push({
			...supplement,
			object: registerGeneratedJson(input.generated, "course-maps.json", courseMaps),
		});
	}
	return result;
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

function registerGeneratedJson(
	objects: Map<string, Uint8Array>,
	fileName: "course-maps.json",
	value: unknown,
): ObjectRef {
	const bytes = canonicalJsonBytes(value);
	const digest = sha256(bytes);
	const key = `campus-web/docs-build/${digest.slice("sha256:".length)}/${fileName}`;
	const existing = objects.get(key);
	if (existing && !equalBytes(existing, bytes)) {
		throw new Error(`compiled docs object identity is inconsistent: ${key}`);
	}
	objects.set(key, bytes);
	return { byteSize: bytes.byteLength, key, sha256: digest };
}

function overlayObjectStore(
	client: ReaderObjectStoreClient,
	generated: ReadonlyMap<string, Uint8Array>,
): ReaderObjectStoreClient {
	return {
		readOptionalBytesObject({ key }) {
			const bytes = generated.get(key);
			return bytes ? Promise.resolve(bytes) : client.readOptionalBytesObject({ key });
		},
	};
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
