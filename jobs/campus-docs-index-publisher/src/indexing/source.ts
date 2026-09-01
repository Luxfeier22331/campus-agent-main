import {
	canonicalJsonBytes,
	normalizeSourceManifest,
	selectCurrentVersion,
	sha256,
} from "../../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import { assertReaderExtractionQuality } from "../../../../apps/campus-web/src/docs-reader-build/reader-quality.ts";
import { assertReaderSegmentationQuality } from "../../../../apps/campus-web/src/docs-reader-build/reader-segmentation.ts";
import { parseReader, parseSourceManifest } from "../../../../apps/campus-web/src/docs-reader-build/source-schema.ts";
import type {
	DocsReader,
	DocsSourceManifest,
	ObjectRef,
} from "../../../../apps/campus-web/src/docs-reader-build/source-types.ts";
import type {
	IndexingSource,
	Sha256Ref,
	SourceVersionSelection,
} from "../types.ts";
import { sha256Bytes } from "./content-digest.ts";

export function parseIndexingSource(sourceBytes: Uint8Array): IndexingSource {
	const sourceValue = parseJson(sourceBytes, "campus docs source");
	const manifest = normalizeSourceManifest(parseSourceManifest(sourceValue));
	return { manifest, sourceBytes, sourceDigest: sha256(sourceBytes) };
}
export function selectCurrentVersions(source: DocsSourceManifest): SourceVersionSelection[] {
	const versionsByDocument = new Map<string, DocsSourceManifest["versions"]>();
	for (const version of source.versions) {
		versionsByDocument.set(version.docId, [
			...(versionsByDocument.get(version.docId) ?? []),
			version,
		]);
	}
	const selected = source.documents.map((document) => {
		const version = selectCurrentVersion(
			versionsByDocument.get(document.docId) ?? [],
			document.docId,
		);
		const readerRef = assertObjectRef(version.reader, `reader ${version.versionId}`);
		return { document, reader: undefined as unknown as DocsReader, readerRef, version };
	});
	if (selected.length === 0) {
		throw new Error("campus docs source has no documents");
	}
	return selected;
}

export async function loadCurrentVersions(input: {
	source: IndexingSource;
	readerStore: { read(key: string): Promise<Uint8Array> };
}): Promise<SourceVersionSelection[]> {
	const selected = selectCurrentVersions(input.source.manifest);
	for (const item of selected) {
		const bytes = await readVerifiedObject(input.readerStore, item.readerRef);
		item.reader = parseReader(parseJson(bytes, `reader ${item.version.versionId}`));
		assertReaderExtractionQuality(item.reader);
		assertReaderSegmentationQuality(item.reader);
		if (item.reader.docId !== item.document.docId || item.reader.versionId !== item.version.versionId) {
			throw new Error(`reader identity does not match source version: ${item.version.versionId}`);
		}
	}
	return selected;
}

/**
 * Project only the current documents and reader objects that can affect
 * indexed chunks. Historical versions, redirects, topic descriptions and
 * manifest formatting are intentionally outside the collection identity.
 */
export function buildCurrentSourceProjection(
	selections: readonly SourceVersionSelection[],
): Array<Record<string, unknown>> {
	return selections
		.map((item) => ({
			collection: item.document.collection,
			corpus: item.document.corpus,
			doc_id: item.document.docId,
			document_slug: item.document.documentSlug,
			reader: item.readerRef,
			title: item.document.title,
			version_id: item.version.versionId,
			version_slug: item.version.versionSlug,
		}))
		.sort((left, right) => String(left.doc_id).localeCompare(String(right.doc_id)));
}

export function sourceProjectionSha256(
	selections: readonly SourceVersionSelection[],
): Sha256Ref {
	return sha256Bytes(canonicalJsonBytes(buildCurrentSourceProjection(selections)));
}

async function readVerifiedObject(
	store: { read(key: string): Promise<Uint8Array> },
	ref: ObjectRef,
): Promise<Uint8Array> {
	const bytes = await store.read(ref.key);
	if (bytes.byteLength !== ref.byteSize) {
		throw new Error(`object byteSize mismatch: ${ref.key}`);
	}
	if (sha256(bytes) !== ref.sha256) {
		throw new Error(`object sha256 mismatch: ${ref.key}`);
	}
	return bytes;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function assertObjectRef(value: ObjectRef, label: string): ObjectRef {
	if (
		!value.key.trim() ||
		!Number.isSafeInteger(value.byteSize) ||
		value.byteSize < 1 ||
		!/^sha256:[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} object identity is invalid`);
	}
	return value;
}
