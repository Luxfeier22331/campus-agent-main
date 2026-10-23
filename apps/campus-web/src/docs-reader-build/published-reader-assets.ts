import { createHash } from "node:crypto";
import { isAbsolute, resolve, sep } from "node:path";

import type {
	PublishedObjectRef,
	PublishedReaderManifestEntry,
	ReaderObjectStoreClient,
} from "./published-reader-types.ts";

export interface PublishedReaderObject {
	filePath: string;
	ref: PublishedObjectRef;
}

export function listPublishedReaderObjects(
	entry: PublishedReaderManifestEntry,
): PublishedReaderObject[] {
	const objects = [
		{ filePath: "reader.json", ref: entry.reader },
		...entry.supplements.flatMap((supplement) => [
			{ filePath: supplement.path, ref: supplement.object },
			...supplement.assets.map((asset) => ({ filePath: asset.path, ref: asset.object })),
		]),
	];
	const paths = new Set<string>();
	for (const object of objects) {
		const filePath = normalizeRelativePath(object.filePath);
		if (paths.has(filePath)) {
			throw new Error(`duplicate reader asset file path: ${filePath}`);
		}
		paths.add(filePath);
		assertPublishedObjectRef(object.ref, `reader asset ${filePath}`);
	}
	return objects;
}

export function assertPublishedReaderAssetLayout(
	entries: readonly PublishedReaderManifestEntry[],
): void {
	const targets = new Set<string>();
	for (const entry of entries) {
		assertSafeStaticSegment(entry.corpus, "reader corpus");
		assertSafeStaticSegment(entry.collection, "reader collection");
		assertSafeStaticSegment(entry.routeSlug, "reader route slug");
		assertSafeStaticSegment(entry.versionSlug, "reader version slug");
		for (const object of listPublishedReaderObjects(entry)) {
			const targetObject = buildReaderAssetTargetObject(entry, object.filePath);
			if (targets.has(targetObject)) {
				throw new Error(`duplicate reader asset target: ${targetObject}`);
			}
			targets.add(targetObject);
		}
	}
}

export async function readPublishedObject(input: {
	client: ReaderObjectStoreClient;
	ref: PublishedObjectRef;
}): Promise<Uint8Array> {
	const bytes = await input.client.readOptionalBytesObject({ key: input.ref.key });
	if (!bytes) {
		throw new Error(`missing published reader object: ${input.ref.key}`);
	}
	const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
	if (bytes.byteLength !== input.ref.byteSize || digest !== input.ref.sha256) {
		throw new Error(`published reader object failed integrity check: ${input.ref.key}`);
	}
	return bytes;
}

export function resolveSafePublishedReaderAssetTarget(input: {
	entry: PublishedReaderManifestEntry;
	filePath: string;
	targetRoot: string;
}): { filePath: string; targetObject: string; targetPath: string } {
	const filePath = normalizeRelativePath(input.filePath);
	const targetObject = buildReaderAssetTargetObject(input.entry, filePath);
	const targetPath = resolve(input.targetRoot, targetObject);
	const targetPrefix = `${resolve(input.targetRoot)}${sep}`;
	if (!targetPath.startsWith(targetPrefix)) {
		throw new Error("reader asset target must stay under _docs/");
	}
	return { filePath, targetObject, targetPath };
}

export function publicReaderUrl(entry: PublishedReaderManifestEntry): string {
	return `/${[
		"_docs",
		entry.corpus,
		entry.collection,
		entry.routeSlug,
		entry.versionSlug,
		"reader.json",
	]
		.map((segment) => encodeURIComponent(segment))
		.join("/")}`;
}

function normalizeRelativePath(value: string): string {
	const normalized = value.trim().replaceAll("\\", "/");
	if (
		!normalized ||
		normalized.startsWith("/") ||
		isAbsolute(normalized) ||
		normalized
			.split("/")
			.some(
				(segment) =>
					!segment ||
					segment === "." ||
					segment === ".." ||
					segment.includes("?") ||
					segment.includes("#") ||
					hasControlCharacter(segment),
			)
	) {
		throw new Error("reader asset file path must be safe and relative");
	}
	return normalized;
}

function buildReaderAssetTargetObject(
	entry: Pick<PublishedReaderManifestEntry, "collection" | "corpus" | "routeSlug" | "versionSlug">,
	filePath: string,
): string {
	assertSafeStaticSegment(entry.corpus, "reader corpus");
	assertSafeStaticSegment(entry.collection, "reader collection");
	assertSafeStaticSegment(entry.routeSlug, "reader route slug");
	assertSafeStaticSegment(entry.versionSlug, "reader version slug");
	return [
		"_docs",
		entry.corpus,
		entry.collection,
		entry.routeSlug,
		entry.versionSlug,
		filePath,
	].join("/");
}

function assertSafeStaticSegment(value: string, label: string): void {
	if (
		!value.trim() ||
		value.includes("/") ||
		value.includes("\\") ||
		value.includes("?") ||
		value.includes("#") ||
		hasControlCharacter(value) ||
		value === "." ||
		value === ".."
	) {
		throw new Error(`${label} must be one safe path segment`);
	}
}

function assertPublishedObjectRef(ref: PublishedObjectRef, label: string): void {
	if (
		!(ref.key.trim() && Number.isSafeInteger(ref.byteSize)) ||
		ref.byteSize < 1 ||
		!/^sha256:[a-f0-9]{64}$/u.test(ref.sha256)
	) {
		throw new Error(`${label} has an invalid object identity`);
	}
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 0x20 || codePoint === 0x7f;
	});
}
