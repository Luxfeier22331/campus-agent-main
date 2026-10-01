import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { writeNativeReaderSite } from "./native-reader-site.ts";
import {
	listPublishedReaderObjects,
	resolveSafePublishedReaderAssetTarget,
} from "./published-reader-assets.ts";
import { attachReaderRouteSlugs, compareEntryRoute } from "./published-reader-routes.ts";
import type {
	PublishedReaderManifest,
	ReaderSyncAssetsResult,
	ReaderSyncDocsResult,
	RoutedPublishedReaderManifestEntry,
} from "./published-reader-types.ts";
import type { CompiledDocsSource } from "./source-compiler.ts";
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
			if (!prepared) {
				throw new Error(`compiled docs source is missing object: ${object.ref.key}`);
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

function resolveRequiredOutputPath(value: string, name: string): string {
	if (!value.trim()) {
		throw new Error(`${name} is required for published reader materialization.`);
	}
	return resolve(value);
}
function routedEntries(manifest: PublishedReaderManifest): RoutedPublishedReaderManifestEntry[] {
	return attachReaderRouteSlugs(manifest.entries).sort(compareEntryRoute);
}
