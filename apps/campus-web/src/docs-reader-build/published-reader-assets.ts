import { createHash } from "node:crypto";
import { isAbsolute, resolve, sep } from "node:path";

import type {
	PublishedReaderDeliveryMode,
	PublishedReaderManifestEntry,
	ReaderAssetCopy,
	ReaderAssetTarget,
} from "./published-reader-types.ts";

const CORE_SOURCE_LABELS = {
	"asset-manifest": "manifest",
	meta: "meta",
	outline: "outline",
	reader: "reader",
} satisfies Record<string, string>;

export function resolvePublishedReaderSourceObjectKey(
	entry: PublishedReaderManifestEntry,
	targetLabel: string,
): string {
	const sourceLabel =
		CORE_SOURCE_LABELS[targetLabel as keyof typeof CORE_SOURCE_LABELS] ??
		`supplement.${targetLabel}`;
	const sourceObject = entry.sourceObjects[sourceLabel] ?? entry.sourceObjects[targetLabel];
	if (!sourceObject?.trim()) {
		throw new Error(`missing reader asset source label for target: ${targetLabel}`);
	}
	return sourceObject;
}

export function resolvePublishedReaderTargetObjectByDeliveryMode(
	deliveryMode: PublishedReaderDeliveryMode,
	targetObject: string,
): string {
	const normalized = targetObject.trim().replaceAll("\\", "/");
	if (deliveryMode === "public_static_asset") {
		if (!normalized.startsWith("_docs/")) {
			throw new Error("public reader asset target must stay under _docs/");
		}
		return normalized;
	}
	if (deliveryMode === "gated_asset") {
		if (normalized.startsWith("_gated-docs/")) {
			return normalized;
		}
		if (normalized.startsWith("_docs/")) {
			return normalized.replace(/^_docs\//u, "_gated-docs/");
		}
		throw new Error("gated reader asset target must stay under _gated-docs/");
	}
	throw new Error(`unsupported reader delivery mode: ${deliveryMode}`);
}

export function resolveSafePublishedReaderAssetTarget(input: {
	targetObject: string;
	targetRoot: string;
}): ReaderAssetTarget {
	const normalized = input.targetObject.trim().replaceAll("\\", "/");
	if (
		!(normalized.startsWith("_docs/") || normalized.startsWith("_gated-docs/")) ||
		isAbsolute(normalized) ||
		normalized.split("/").includes("..")
	) {
		throw new Error("reader asset target must stay under _docs/ or _gated-docs/");
	}
	const targetPath = resolve(input.targetRoot, normalized);
	const targetPrefix = `${resolve(input.targetRoot)}${sep}`;
	if (!targetPath.startsWith(targetPrefix)) {
		throw new Error("reader asset target must stay under _docs/ or _gated-docs/");
	}
	return {
		filePath: resolvePublishedReaderAssetFilePath(normalized),
		targetObject: normalized,
		targetPath,
	};
}

export function validatePublishedReaderAssetManifest(
	entry: PublishedReaderManifestEntry,
	copies: ReaderAssetCopy[],
): void {
	const manifestCopy = copies.find((copy) => copy.filePath === "asset-manifest.json");
	if (!manifestCopy) {
		throw new Error(`reader asset entry is missing asset-manifest.json: ${entry.docId}`);
	}
	const manifest = JSON.parse(new TextDecoder().decode(manifestCopy.bytes));
	if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
		throw new Error("asset-manifest.json must contain files");
	}
	for (const copy of copies) {
		if (copy.filePath === "asset-manifest.json") {
			continue;
		}
		const expected = manifest.files[copy.filePath];
		if (!expected) {
			throw new Error(`asset-manifest.json is missing file entry: ${copy.filePath}`);
		}
		const actualSha256 = createHash("sha256").update(copy.bytes).digest("hex");
		if (expected.sizeBytes !== copy.bytes.byteLength || expected.sha256 !== actualSha256) {
			throw new Error(`reader asset failed manifest integrity check: ${copy.filePath}`);
		}
	}
}

function resolvePublishedReaderAssetFilePath(targetObject: string): string {
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
