import { readFileSync } from "node:fs";

export async function loadPublishedReaderManifest(input) {
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

export function normalizeSearchUnit(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("campus docs reader search unit must be an object");
	}
	return {
		anchor: requireString(value.anchor, "searchUnits.anchor"),
		canonicalUrl: requireString(value.canonicalUrl, "searchUnits.canonicalUrl"),
		collection: requireString(value.collection, "searchUnits.collection"),
		corpus: requireString(value.corpus, "searchUnits.corpus"),
		docId: optionalString(value.docId),
		documentSlug: requireString(value.documentSlug, "searchUnits.documentSlug"),
		documentTitle: requireString(value.documentTitle, "searchUnits.documentTitle"),
		highlightRootUnitIds: requireStringArray(
			value.highlightRootUnitIds,
			"searchUnits.highlightRootUnitIds",
		),
		searchUnitId: requireString(value.searchUnitId, "searchUnits.searchUnitId"),
		snippet: requireString(value.snippet, "searchUnits.snippet"),
		title: requireString(value.title, "searchUnits.title"),
		versionId: requireString(value.versionId, "searchUnits.versionId"),
		versionSlug: requireString(value.versionSlug, "searchUnits.versionSlug"),
	};
}

function normalizeEntry(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("campus docs reader manifest entry must be an object");
	}
	const deliveryMode = requireString(value.deliveryMode, "deliveryMode");
	if (
		deliveryMode !== "public_static_asset" &&
		deliveryMode !== "gated_asset" &&
		deliveryMode !== "withheld"
	) {
		throw new Error(`unsupported reader delivery mode: ${deliveryMode}`);
	}
	const entry = {
		collection: requireString(value.collection, "collection"),
		corpus: requireString(value.corpus, "corpus"),
		deliveryMode,
		docId: optionalString(value.docId),
		documentSlug: requireString(value.documentSlug, "documentSlug"),
		isCurrent: value.isCurrent !== false,
		sourceObjects: requireStringRecord(value.sourceObjects, "sourceObjects"),
		targetObjects: requireStringRecord(value.targetObjects, "targetObjects"),
		title: requireString(value.title, "title"),
		versionId: optionalString(value.versionId),
		versionLabel: optionalString(value.versionLabel),
		versionSlug: requireString(value.versionSlug, "versionSlug"),
	};
	for (const [label, segment] of [
		["corpus", entry.corpus],
		["collection", entry.collection],
		["documentSlug", entry.documentSlug],
		["versionSlug", entry.versionSlug],
	]) {
		assertSafePathSegment(segment, label);
	}
	return entry;
}

function requireValue(value, name) {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error(`${name} is required`);
	}
	return normalized;
}

function requireString(value, name) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value.trim();
}

function optionalString(value) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireStringRecord(value, name) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!Object.values(value).every((item) => typeof item === "string" && item.trim())
	) {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value;
}

function requireStringArray(value, name) {
	if (!Array.isArray(value)) {
		throw new Error(`campus docs reader manifest entry requires ${name}`);
	}
	return value.map((item) => requireString(item, name));
}

function assertSafePathSegment(value, label) {
	if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
		throw new Error(`campus docs reader manifest entry has unsafe ${label}`);
	}
}
