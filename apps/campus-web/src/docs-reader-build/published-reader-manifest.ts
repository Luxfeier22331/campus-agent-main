import { readFileSync } from "node:fs";

import type {
	PublishedReaderManifest,
	PublishedReaderManifestEntry,
	PublishedReaderObjectStoreClient,
	PublishedReaderSearchUnit,
} from "./published-reader-types.ts";

export async function loadPublishedReaderManifest(input: {
	client: PublishedReaderObjectStoreClient;
	manifestFilePath?: string;
	manifestObjectKey?: string;
}): Promise<PublishedReaderManifest> {
	const raw = input.manifestFilePath
		? readFileSync(input.manifestFilePath, "utf8")
		: await input.client.readTextObject({
				key: requireValue(input.manifestObjectKey, "manifestObjectKey"),
			});
	const parsed = JSON.parse(raw);
	if (parsed.surface !== "public_docs") {
		throw new Error(`unsupported docs reader release manifest surface: ${parsed.surface}`);
	}
	if (!Array.isArray(parsed.entries)) {
		throw new Error("campus docs reader release manifest must contain entries[]");
	}
	if (!Array.isArray(parsed.searchUnits)) {
		throw new Error("campus docs reader release manifest must contain searchUnits[]");
	}
	return {
		entries: parsed.entries.map(normalizeEntry),
		generatedAt: parsed.generatedAt,
		searchUnits: parsed.searchUnits,
	};
}

export function normalizeSearchUnit(value: unknown): PublishedReaderSearchUnit {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("campus docs reader search unit must be an object");
	}
	const record = value as Record<string, unknown>;
	return {
		anchor: requireString(record.anchor, "searchUnits.anchor"),
		canonicalUrl: requireString(record.canonicalUrl, "searchUnits.canonicalUrl"),
		collection: requireString(record.collection, "searchUnits.collection"),
		corpus: requireString(record.corpus, "searchUnits.corpus"),
		docId: optionalString(record.docId),
		documentSlug: requireString(record.documentSlug, "searchUnits.documentSlug"),
		documentTitle: requireString(record.documentTitle, "searchUnits.documentTitle"),
		highlightRootUnitIds: requireStringArray(
			record.highlightRootUnitIds,
			"searchUnits.highlightRootUnitIds",
		),
		searchUnitId: requireString(record.searchUnitId, "searchUnits.searchUnitId"),
		snippet: requireString(record.snippet, "searchUnits.snippet"),
		title: requireString(record.title, "searchUnits.title"),
		versionId: requireString(record.versionId, "searchUnits.versionId"),
		versionSlug: requireString(record.versionSlug, "searchUnits.versionSlug"),
	};
}

function normalizeEntry(value: unknown): PublishedReaderManifestEntry {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("campus docs reader manifest entry must be an object");
	}
	const record = value as Record<string, unknown>;
	const deliveryMode = requireString(record.deliveryMode, "deliveryMode");
	if (
		deliveryMode !== "public_static_asset" &&
		deliveryMode !== "gated_asset" &&
		deliveryMode !== "withheld"
	) {
		throw new Error(`unsupported reader delivery mode: ${deliveryMode}`);
	}
	const entry = {
		collection: requireString(record.collection, "collection"),
		corpus: requireString(record.corpus, "corpus"),
		deliveryMode,
		docId: optionalString(record.docId),
		documentSlug: requireString(record.documentSlug, "documentSlug"),
		isCurrent: record.isCurrent !== false,
		sourceObjects: requireStringRecord(record.sourceObjects, "sourceObjects"),
		targetObjects: requireStringRecord(record.targetObjects, "targetObjects"),
		title: requireString(record.title, "title"),
		versionId: optionalString(record.versionId),
		versionLabel: optionalString(record.versionLabel),
		versionSlug: requireString(record.versionSlug, "versionSlug"),
	} satisfies PublishedReaderManifestEntry;
	for (const [label, segment] of [
		["corpus", entry.corpus],
		["collection", entry.collection],
		["documentSlug", entry.documentSlug],
		["versionSlug", entry.versionSlug],
	] as const) {
		assertSafePathSegment(segment, label);
	}
	return entry;
}

function requireValue(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error(`${name} is required`);
	}
	return normalized;
}

function requireString(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value.trim();
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireStringRecord(value: unknown, name: string): Record<string, string> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!Object.values(value).every((item) => typeof item === "string" && item.trim())
	) {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value as Record<string, string>;
}

function requireStringArray(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value.map((item) => requireString(item, name));
}

function assertSafePathSegment(value: string, label: string): void {
	if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
		throw new Error(`campus docs reader manifest entry has unsafe ${label}`);
	}
}
