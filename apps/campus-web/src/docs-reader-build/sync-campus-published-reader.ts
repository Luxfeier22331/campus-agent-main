import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseDocsCourseMapsForReader, parseDocsReaderPayload } from "../features/docs/model.ts";
import { writeNativeReaderSite } from "./native-reader-site.ts";
import {
	assertPublishedReaderAssetLayout,
	listPublishedReaderObjects,
	readPublishedObject,
	resolveSafePublishedReaderAssetTarget,
} from "./published-reader-assets.ts";
import { attachReaderRouteSlugs, compareEntryRoute } from "./published-reader-routes.ts";
import type {
	PublishedReaderManifest,
	ReaderAssetCopy,
	ReaderSyncAssetsResult,
	ReaderSyncCheckResult,
	ReaderSyncDocsResult,
	ReaderSyncInput,
	RoutedPublishedReaderManifestEntry,
} from "./published-reader-types.ts";
import type { CompiledDocsSource } from "./source-compiler.ts";

export {
	resolvePublishedReaderObjectStoreBucket,
	resolvePublishedReaderObjectStoreConfig,
	resolvePublishedReaderObjectStoreCredentials,
	resolvePublishedReaderObjectStoreWriterConfig,
	resolvePublishedReaderObjectStoreWriterCredentials,
} from "./published-reader-object-store.ts";

export async function syncCampusPublishedReaderDocs(
	input: ReaderSyncInput,
): Promise<ReaderSyncDocsResult> {
	const manifest = input.manifest;
	const entries = routedEntries(manifest);
	assertPublishedReaderAssetLayout(entries);
	const generatedRoot = resolveRequiredOutputPath(input.docsRoot, "docsRoot");
	const publicRoot = resolveRequiredOutputPath(input.targetRoot, "targetRoot");
	const readersByVersion = await validateReaderEntries({
		client: input.client,
		entries,
		targetRoot: publicRoot,
	});
	rmSync(generatedRoot, { force: true, recursive: true });
	await writeNativeReaderSite({
		entries,
		generatedRoot,
		manifest,
		publicRoot,
		readersByVersion,
	});
	return { generatedDocumentCount: entries.length };
}

export async function syncCompiledCampusPublishedReader(input: {
	compiled: CompiledDocsSource;
	docsRoot: string;
	targetRoot: string;
}): Promise<{ assets: ReaderSyncAssetsResult; docs: ReaderSyncDocsResult }> {
	const entries = routedEntries(input.compiled.manifest);
	const targetRoot = resolveRequiredOutputPath(input.targetRoot, "targetRoot");
	const generatedRoot = resolveRequiredOutputPath(input.docsRoot, "docsRoot");
	const copiesByEntry = entries.map((entry) =>
		listPublishedReaderObjects(entry).map((object) => {
			const target = resolveSafePublishedReaderAssetTarget({
				entry,
				filePath: object.filePath,
				targetRoot,
			});
			const prepared = input.compiled.objects.get(object.ref.key);
			if (
				!prepared ||
				prepared.ref.byteSize !== object.ref.byteSize ||
				prepared.ref.sha256 !== object.ref.sha256
			) {
				throw new Error(`compiled docs source is missing verified object: ${object.ref.key}`);
			}
			return { ...target, bytes: prepared.bytes };
		}),
	);
	rmSync(resolve(targetRoot, "_docs"), { force: true, recursive: true });
	let copiedAssetCount = 0;
	for (const copies of copiesByEntry) {
		for (const copy of copies) {
			mkdirSync(dirname(copy.targetPath), { recursive: true });
			writeFileSync(copy.targetPath, copy.bytes);
			copiedAssetCount += 1;
		}
	}
	rmSync(generatedRoot, { force: true, recursive: true });
	await writeNativeReaderSite({
		entries,
		generatedRoot,
		manifest: input.compiled.manifest,
		publicRoot: targetRoot,
		readersByVersion: input.compiled.readers,
	});
	return {
		assets: { copiedAssetCount, copiedDocumentCount: entries.length },
		docs: { generatedDocumentCount: entries.length },
	};
}

export async function syncCampusPublishedReaderAssets(
	input: ReaderSyncInput,
): Promise<ReaderSyncAssetsResult> {
	const manifest = input.manifest;
	const entries = routedEntries(manifest);
	assertPublishedReaderAssetLayout(entries);
	const targetRoot = resolveRequiredOutputPath(input.targetRoot, "targetRoot");
	const seenTargets = new Set<string>();
	let copiedAssetCount = 0;
	const copiesByEntry = await Promise.all(
		entries.map(async (entry) => {
			const copies = await loadEntryCopies({ client: input.client, entry, targetRoot });
			assertReaderMatchesEntry(entry, copies);
			return copies;
		}),
	);
	rmSync(resolve(targetRoot, "_docs"), { force: true, recursive: true });
	for (const copies of copiesByEntry) {
		for (const copy of copies) {
			if (seenTargets.has(copy.targetPath)) {
				throw new Error(`duplicate reader asset target: ${copy.targetObject}`);
			}
			seenTargets.add(copy.targetPath);
			mkdirSync(dirname(copy.targetPath), { recursive: true });
			writeFileSync(copy.targetPath, copy.bytes);
			copiedAssetCount += 1;
		}
	}
	return { copiedAssetCount, copiedDocumentCount: entries.length };
}

export async function checkCampusPublishedReaderInputs(
	input: ReaderSyncInput,
): Promise<ReaderSyncCheckResult> {
	const manifest = input.manifest;
	const entries = routedEntries(manifest);
	assertPublishedReaderAssetLayout(entries);
	const targetRoot = resolve(input.targetRoot ?? ".");
	let checkedObjectCount = 0;
	for (const entry of entries) {
		const copies = await loadEntryCopies({
			client: input.client,
			entry,
			targetRoot,
		});
		assertReaderMatchesEntry(entry, copies);
		checkedObjectCount += copies.length;
	}
	return { checkedDocumentCount: entries.length, checkedObjectCount };
}

async function validateReaderEntries(input: {
	client: ReaderSyncInput["client"];
	entries: RoutedPublishedReaderManifestEntry[];
	targetRoot: string;
}): Promise<Map<string, ReturnType<typeof assertReaderMatchesEntry>>> {
	const readersByVersion = new Map<string, ReturnType<typeof assertReaderMatchesEntry>>();
	for (const entry of input.entries) {
		const copies = await loadEntryCopies({
			client: input.client,
			entry,
			targetRoot: input.targetRoot,
		});
		readersByVersion.set(entry.versionId, assertReaderMatchesEntry(entry, copies));
	}
	return readersByVersion;
}

function resolveRequiredOutputPath(value: string | undefined, name: string): string {
	if (!value?.trim()) {
		throw new Error(`${name} is required for published reader materialization.`);
	}
	return resolve(value);
}

async function loadEntryCopies(input: {
	client: ReaderSyncInput["client"];
	entry: RoutedPublishedReaderManifestEntry;
	targetRoot: string;
}): Promise<ReaderAssetCopy[]> {
	const copies: ReaderAssetCopy[] = [];
	for (const object of listPublishedReaderObjects(input.entry)) {
		const target = resolveSafePublishedReaderAssetTarget({
			entry: input.entry,
			filePath: object.filePath,
			targetRoot: input.targetRoot,
		});
		copies.push({
			...target,
			bytes: await readPublishedObject({ client: input.client, ref: object.ref }),
		});
	}
	return copies;
}

function assertReaderMatchesEntry(
	entry: RoutedPublishedReaderManifestEntry,
	copies: ReaderAssetCopy[],
): ReturnType<typeof parseDocsReaderPayload> {
	const readerCopy = copies.find((copy) => copy.filePath === "reader.json");
	if (!readerCopy) {
		throw new Error(`published reader is missing reader.json: ${entry.versionId}`);
	}
	const reader = parseDocsReaderPayload(JSON.parse(new TextDecoder().decode(readerCopy.bytes)));
	if (reader.docId !== entry.docId || reader.versionId !== entry.versionId) {
		throw new Error(`published reader identity does not match docs entry: ${entry.versionId}`);
	}
	const expectedSupplements = entry.supplements.map(({ kind, path }) => `${kind}:${path}`).sort();
	const actualSupplements = reader.supplements.map(({ kind, path }) => `${kind}:${path}`).sort();
	if (
		expectedSupplements.length !== actualSupplements.length ||
		expectedSupplements.some((value, index) => value !== actualSupplements[index])
	) {
		throw new Error(`published reader supplements do not match docs entry: ${entry.versionId}`);
	}
	for (const supplement of entry.supplements) {
		const copy = copies.find((candidate) => candidate.filePath === supplement.path);
		if (!copy) {
			throw new Error(
				`published reader supplement is missing: ${entry.versionId}/${supplement.path}`,
			);
		}
		parseDocsCourseMapsForReader({
			manifestUrl: `/${copy.targetObject}`,
			reader,
			value: JSON.parse(new TextDecoder().decode(copy.bytes)),
		});
	}
	return reader;
}

function routedEntries(manifest: PublishedReaderManifest): RoutedPublishedReaderManifestEntry[] {
	return attachReaderRouteSlugs(manifest.entries).sort(compareEntryRoute);
}
