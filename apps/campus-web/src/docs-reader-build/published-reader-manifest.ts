import { readFileSync } from "node:fs";

import type {
	PublishedReaderManifest,
	PublishedReaderManifestEntry,
	PublishedReaderSearchUnit,
} from "./published-reader-types.ts";

export async function loadPublishedReaderManifest(input: {
	manifestFilePath: string;
}): Promise<PublishedReaderManifest> {
	const raw = readFileSync(input.manifestFilePath, "utf8");
	const parsed = JSON.parse(raw);
	if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
		throw new Error("campus docs reader release manifest must be an object");
	}
	if (parsed.schemaVersion !== "campus_docs_release_manifest.v1") {
		throw new Error(`unsupported docs reader release manifest schema: ${parsed.schemaVersion}`);
	}
	if (parsed.surface !== "campus_docs") {
		throw new Error(`unsupported docs reader release manifest surface: ${parsed.surface}`);
	}
	if (!Array.isArray(parsed.entries)) {
		throw new Error("campus docs reader release manifest must contain entries[]");
	}
	if (!Array.isArray(parsed.searchUnits)) {
		throw new Error("campus docs reader release manifest must contain searchUnits[]");
	}
	normalizeObjectRef(parsed.projection, "projection");
	if (!Array.isArray(parsed.sourceReleaseRefs)) {
		throw new Error("campus docs reader release manifest must contain sourceReleaseRefs[]");
	}
	parsed.sourceReleaseRefs.map((value: unknown, index: number) =>
		normalizeObjectRef(value, `sourceReleaseRefs[${index}]`),
	);
	assertExactKeys(
		parsed,
		["entries", "projection", "schemaVersion", "searchUnits", "sourceReleaseRefs", "surface"],
		"release manifest",
	);
	return {
		entries: parsed.entries.map(normalizeEntry),
		searchUnits: parsed.searchUnits.map(normalizeSearchUnit),
	};
}

export function normalizeSearchUnit(value: unknown): PublishedReaderSearchUnit {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("campus docs reader search unit must be an object");
	}
	const record = value as Record<string, unknown>;
	assertExactKeys(
		record,
		[
			"anchor",
			"canonicalUrl",
			"collection",
			"corpus",
			"docId",
			"documentSlug",
			"documentTitle",
			"highlightRootUnitIds",
			"searchUnitId",
			"snippet",
			"title",
			"versionId",
			"versionSlug",
		],
		"search unit",
	);
	return {
		anchor: requireString(record.anchor, "searchUnits.anchor"),
		canonicalUrl: requireString(record.canonicalUrl, "searchUnits.canonicalUrl"),
		collection: requireString(record.collection, "searchUnits.collection"),
		corpus: requireString(record.corpus, "searchUnits.corpus"),
		docId: requireString(record.docId, "searchUnits.docId"),
		documentSlug: requireString(record.documentSlug, "searchUnits.documentSlug"),
		documentTitle: requireString(record.documentTitle, "searchUnits.documentTitle"),
		highlightRootUnitIds: requireStringArray(
			record.highlightRootUnitIds,
			"searchUnits.highlightRootUnitIds",
		),
		searchUnitId: requireString(record.searchUnitId, "searchUnits.searchUnitId"),
		snippet: requireText(record.snippet, "searchUnits.snippet"),
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
	assertExactKeys(
		record,
		[
			"collection",
			"corpus",
			"deliveryMode",
			"docId",
			"documentSlug",
			"isCurrent",
			"sourceObjects",
			"targetObjects",
			"title",
			"versionId",
			"versionLabel",
			"versionSlug",
		],
		"manifest entry",
	);
	const deliveryMode = requireString(record.deliveryMode, "deliveryMode");
	if (deliveryMode !== "public_static_asset" && deliveryMode !== "gated_asset") {
		throw new Error(`unsupported reader delivery mode: ${deliveryMode}`);
	}
	const entry = {
		collection: requireString(record.collection, "collection"),
		corpus: requireString(record.corpus, "corpus"),
		deliveryMode,
		docId: requireString(record.docId, "docId"),
		documentSlug: requireString(record.documentSlug, "documentSlug"),
		isCurrent: requireBoolean(record.isCurrent, "isCurrent"),
		sourceObjects: requireStringRecord(record.sourceObjects, "sourceObjects"),
		targetObjects: requireStringRecord(record.targetObjects, "targetObjects"),
		title: requireString(record.title, "title"),
		versionId: requireString(record.versionId, "versionId"),
		versionLabel: requireString(record.versionLabel, "versionLabel"),
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

function requireString(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value.trim();
}

function requireBoolean(value: unknown, name: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value;
}

function requireText(value: unknown, name: string): string {
	if (typeof value !== "string") {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value.trim();
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
	const normalized = value.map((item) => requireString(item, name));
	if (new Set(normalized).size !== normalized.length) {
		throw new Error(`campus docs reader manifest entry requires unique ${name}`);
	}
	return normalized;
}

function normalizeObjectRef(value: unknown, name: string): void {
	if (!(value && typeof value === "object" && !Array.isArray(value))) {
		throw new Error(`campus docs reader release manifest requires ${name}`);
	}
	const record = value as Record<string, unknown>;
	assertExactKeys(record, ["byteSize", "key", "sha256"], name);
	if (
		typeof record.key !== "string" ||
		!record.key.trim() ||
		typeof record.byteSize !== "number" ||
		!Number.isSafeInteger(record.byteSize) ||
		record.byteSize < 1 ||
		typeof record.sha256 !== "string" ||
		!/^sha256:[a-f0-9]{64}$/u.test(record.sha256)
	) {
		throw new Error(`campus docs reader release manifest has invalid ${name}`);
	}
}

function assertExactKeys(value: unknown, expected: string[], name: string): void {
	if (!(value && typeof value === "object" && !Array.isArray(value))) {
		throw new Error(`campus docs reader ${name} must be an object`);
	}
	const keys = Object.keys(value).sort();
	const expectedKeys = [...expected].sort();
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key, index) => key !== expectedKeys[index])
	) {
		throw new Error(`campus docs reader ${name} has unsupported fields`);
	}
}

function assertSafePathSegment(value: string, label: string): void {
	if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
		throw new Error(`campus docs reader manifest entry has unsafe ${label}`);
	}
}
