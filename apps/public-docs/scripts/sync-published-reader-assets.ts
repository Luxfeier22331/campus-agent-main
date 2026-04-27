import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { APP_ROOT } from "./sync-real-docs/shared";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

export interface PublishedReaderAssetsSyncResult {
	copiedAssetCount: number;
	copiedDocumentCount: number;
}

interface PublishedReaderAssetEntry {
	deliveryMode: string;
	docId?: string;
	sourceObjects: Record<string, string>;
	targetObjects: Record<string, string>;
}

interface PublishedReaderAssetsManifest {
	entries: PublishedReaderAssetEntry[];
	generatedAt?: string;
	surface?: string;
}

interface AssetCopy {
	bytes: Uint8Array;
	filePath: string;
	targetObject: string;
	targetPath: string;
}

interface ReaderAssetManifest {
	files: Record<
		string,
		{
			sha256: string;
			sizeBytes: number;
		}
	>;
}

const CORE_SOURCE_LABELS: Record<string, string> = {
	"asset-manifest": "manifest",
	meta: "meta",
	outline: "outline",
	reader: "reader",
};

export async function syncPublishedReaderAssets(input: {
	client: ObjectStoreClient;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	targetRoot: string;
}): Promise<PublishedReaderAssetsSyncResult> {
	const manifest = await loadManifest(input);
	const publicEntries = manifest.entries.filter((entry) => {
		if (entry.deliveryMode === "public_static_asset") {
			return true;
		}
		if (entry.deliveryMode === "gated_asset") {
			return false;
		}
		throw new Error(`unsupported reader asset delivery mode: ${entry.deliveryMode}`);
	});
	const targetRoot = resolve(input.targetRoot);
	const docsTargetRoot = resolve(targetRoot, "_docs");
	const seenTargets = new Set<string>();
	let copiedAssetCount = 0;

	rmSync(docsTargetRoot, { force: true, recursive: true });

	for (const entry of publicEntries) {
		const entryCopies: AssetCopy[] = [];
		for (const [targetLabel, targetObject] of Object.entries(entry.targetObjects)) {
			const sourceObject = resolveSourceObjectKey(entry, targetLabel);
			const target = resolveSafeReaderAssetTarget({
				targetObject,
				targetRoot,
			});
			if (seenTargets.has(target.targetPath)) {
				throw new Error(`duplicate reader asset target: ${targetObject}`);
			}
			seenTargets.add(target.targetPath);

			const bytes = await input.client.readOptionalBytesObject({ key: sourceObject });
			if (!bytes) {
				throw new Error(`missing reader asset source object: ${sourceObject}`);
			}

			entryCopies.push({
				bytes,
				filePath: target.filePath,
				targetObject,
				targetPath: target.targetPath,
			});
		}

		validateAssetManifest(entry, entryCopies);

		for (const copy of entryCopies) {
			mkdirSync(dirname(copy.targetPath), { recursive: true });
			writeFileSync(copy.targetPath, copy.bytes);
			copiedAssetCount += 1;
		}
	}

	return {
		copiedAssetCount,
		copiedDocumentCount: publicEntries.length,
	};
}

async function loadManifest(input: {
	client: ObjectStoreClient;
	manifestFilePath?: string;
	manifestObjectKey?: string;
}): Promise<PublishedReaderAssetsManifest> {
	const raw = input.manifestFilePath
		? readFileSync(input.manifestFilePath, "utf8")
		: await input.client.readTextObject({
				key: requireValue(input.manifestObjectKey, "manifestObjectKey"),
			});
	const parsed = JSON.parse(raw) as Partial<PublishedReaderAssetsManifest>;
	if (!Array.isArray(parsed.entries)) {
		throw new Error("published reader assets manifest must contain entries[]");
	}
	return {
		entries: parsed.entries.map(normalizeEntry),
		generatedAt: parsed.generatedAt,
		surface: parsed.surface,
	};
}

function normalizeEntry(value: unknown): PublishedReaderAssetEntry {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("published reader assets manifest entry must be an object");
	}
	const entry = value as Partial<PublishedReaderAssetEntry>;
	if (!entry.deliveryMode?.trim()) {
		throw new Error("published reader assets manifest entry requires deliveryMode");
	}
	if (!isStringRecord(entry.sourceObjects)) {
		throw new Error("published reader assets manifest entry requires sourceObjects");
	}
	if (!isStringRecord(entry.targetObjects)) {
		throw new Error("published reader assets manifest entry requires targetObjects");
	}
	return {
		deliveryMode: entry.deliveryMode,
		docId: entry.docId,
		sourceObjects: entry.sourceObjects,
		targetObjects: entry.targetObjects,
	};
}

function resolveSourceObjectKey(entry: PublishedReaderAssetEntry, targetLabel: string): string {
	const sourceLabel = CORE_SOURCE_LABELS[targetLabel] ?? `supplement.${targetLabel}`;
	const sourceObject = entry.sourceObjects[sourceLabel] ?? entry.sourceObjects[targetLabel];
	if (!sourceObject?.trim()) {
		throw new Error(`missing reader asset source label for target: ${targetLabel}`);
	}
	return sourceObject;
}

function resolveSafeReaderAssetTarget(input: { targetObject: string; targetRoot: string }): {
	filePath: string;
	targetPath: string;
} {
	const normalized = input.targetObject.trim().replaceAll("\\", "/");
	if (
		!normalized.startsWith("_docs/") ||
		isAbsolute(normalized) ||
		normalized.split("/").includes("..")
	) {
		throw new Error("reader asset target must stay under _docs/");
	}

	const targetPath = resolve(input.targetRoot, normalized);
	const targetPrefix = `${resolve(input.targetRoot)}${sep}`;
	if (!targetPath.startsWith(targetPrefix)) {
		throw new Error("reader asset target must stay under _docs/");
	}
	return {
		filePath: resolveReaderAssetFilePath(normalized),
		targetPath,
	};
}

function resolveReaderAssetFilePath(targetObject: string): string {
	const parts = targetObject.split("/");
	if (parts.length < 6) {
		throw new Error("reader asset target must include document version and file path");
	}
	const filePath = parts.slice(5).join("/");
	if (!filePath || filePath.split("/").includes("..")) {
		throw new Error("reader asset target must include a safe file path");
	}
	return filePath;
}

function validateAssetManifest(entry: PublishedReaderAssetEntry, copies: AssetCopy[]): void {
	const manifestCopy = copies.find((copy) => copy.filePath === "asset-manifest.json");
	if (!manifestCopy) {
		throw new Error(`reader asset entry is missing asset-manifest.json: ${entry.docId ?? ""}`);
	}

	const manifest = parseAssetManifest(manifestCopy.bytes);
	for (const copy of copies) {
		if (copy.filePath === "asset-manifest.json") {
			continue;
		}
		const expected = manifest.files[copy.filePath];
		if (!expected) {
			throw new Error(`asset-manifest.json is missing file entry: ${copy.filePath}`);
		}
		const actualSize = copy.bytes.byteLength;
		const actualSha256 = sha256Hex(copy.bytes);
		if (expected.sizeBytes !== actualSize || expected.sha256 !== actualSha256) {
			throw new Error(`reader asset failed manifest integrity check: ${copy.filePath}`);
		}
	}
}

function parseAssetManifest(bytes: Uint8Array): ReaderAssetManifest {
	const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ReaderAssetManifest>;
	if (!parsed.files || typeof parsed.files !== "object" || Array.isArray(parsed.files)) {
		throw new Error("asset-manifest.json must contain files");
	}
	return {
		files: parsed.files,
	};
}

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === "string" && item.trim().length > 0)
	);
}

function requireValue(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error(`${name} is required`);
	}
	return normalized;
}

async function main(): Promise<void> {
	const result = await syncPublishedReaderAssets({
		client: createS3ObjectStore(),
		manifestFilePath: process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH,
		manifestObjectKey: process.env.PUBLIC_DOCS_SYNC_MANIFEST_KEY,
		targetRoot: process.env.PUBLIC_DOCS_BUILD_DIR?.trim() || resolve(APP_ROOT, "doc_build"),
	});
	console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
