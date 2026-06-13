import type { DefaultMatchResult } from "@rspress/core/theme";

export interface DocsProtectedSearchEntry {
	anchor: string;
	canonicalUrl: string;
	collection: string;
	collectionLabel: string;
	corpus: string;
	documentSlug: string;
	documentTitle: string;
	highlightRootUnitIds: string[];
	searchText: string;
	searchUnitId: string;
	sectionTitle: string;
	snippet: string;
	versionSlug: string;
}

export interface DocsProtectedSearchIndex {
	entries: DocsProtectedSearchEntry[];
	generatedAt?: string | null;
	schemaVersion: "campus_docs_protected_search_index_v1";
	visibilityMode: "principal_protected_static";
}

export interface DocsProtectedSearchResult {
	documentTitle: string;
	excerpt: string;
	sectionTitle: string;
	url: string;
}

const PROTECTED_SEARCH_INDEX_SCHEMA_VERSION = "campus_docs_protected_search_index_v1";
const MAX_PROTECTED_SEARCH_RESULTS = 8;

export function normalizeDocsSearchQuery(query: string): string {
	return query
		.normalize("NFKC")
		.replace(/[\u3000\s]+/gu, " ")
		.replace(/[，。、“”‘’；：！？（）《》【】,.!?;:()[\]{}"']/gu, "")
		.trim()
		.toLowerCase();
}

export function filterRspressLiteralResults(
	query: string,
	groups: Pick<DefaultMatchResult, "result">[],
): void {
	const normalizedQuery = normalizeDocsSearchQuery(query);
	if (!normalizedQuery) {
		for (const group of groups) {
			group.result.length = 0;
		}
		return;
	}

	for (const group of groups) {
		group.result = group.result.filter((item) =>
			[item.title, item.header, "statement" in item ? item.statement : ""].some((value) =>
				normalizeDocsSearchQuery(value).includes(normalizedQuery),
			),
		);
	}
}

export function parseDocsProtectedSearchIndexPayload(payload: unknown): DocsProtectedSearchIndex {
	if (!isRecord(payload)) {
		throw new Error("protected docs search index payload is invalid.");
	}
	if (
		payload.schemaVersion !== PROTECTED_SEARCH_INDEX_SCHEMA_VERSION ||
		payload.visibilityMode !== "principal_protected_static" ||
		!Array.isArray(payload.entries)
	) {
		throw new Error("protected docs search index payload is invalid.");
	}
	return {
		entries: payload.entries.map(parseProtectedSearchEntry),
		generatedAt: optionalString(payload.generatedAt) ?? null,
		schemaVersion: PROTECTED_SEARCH_INDEX_SCHEMA_VERSION,
		visibilityMode: "principal_protected_static",
	};
}

export function searchProtectedDocsIndex(
	query: string,
	index: DocsProtectedSearchIndex,
): DocsProtectedSearchResult[] {
	const normalizedQuery = normalizeDocsSearchQuery(query);
	if (!normalizedQuery) {
		return [];
	}

	return index.entries
		.filter((entry) =>
			[entry.documentTitle, entry.sectionTitle, entry.snippet, entry.searchText].some((value) =>
				normalizeDocsSearchQuery(value).includes(normalizedQuery),
			),
		)
		.sort(compareProtectedSearchEntry(normalizedQuery))
		.slice(0, MAX_PROTECTED_SEARCH_RESULTS)
		.map((entry) => ({
			documentTitle: entry.documentTitle,
			excerpt: entry.snippet,
			sectionTitle: entry.sectionTitle,
			url: buildReaderPermalink(entry),
		}));
}

function compareProtectedSearchEntry(
	normalizedQuery: string,
): (left: DocsProtectedSearchEntry, right: DocsProtectedSearchEntry) => number {
	return (left, right) =>
		scoreProtectedEntry(right, normalizedQuery) - scoreProtectedEntry(left, normalizedQuery) ||
		left.canonicalUrl.localeCompare(right.canonicalUrl) ||
		left.anchor.localeCompare(right.anchor);
}

function scoreProtectedEntry(entry: DocsProtectedSearchEntry, normalizedQuery: string): number {
	let score = 0;
	if (normalizeDocsSearchQuery(entry.documentTitle).includes(normalizedQuery)) {
		score += 4;
	}
	if (normalizeDocsSearchQuery(entry.sectionTitle).includes(normalizedQuery)) {
		score += 2;
	}
	if (normalizeDocsSearchQuery(entry.snippet).includes(normalizedQuery)) {
		score += 1;
	}
	return score;
}

function buildReaderPermalink(entry: DocsProtectedSearchEntry): string {
	const params = new URLSearchParams();
	if (entry.highlightRootUnitIds.length > 0) {
		params.set("hl", entry.highlightRootUnitIds.join(","));
	}
	const query = params.toString();
	return `${entry.canonicalUrl}${query ? `?${query}` : ""}#${encodeURIComponent(entry.anchor)}`;
}

function parseProtectedSearchEntry(value: unknown): DocsProtectedSearchEntry {
	if (!isRecord(value)) {
		throw new Error("protected docs search entry is invalid.");
	}
	return {
		anchor: requiredString(value.anchor, "anchor"),
		canonicalUrl: requiredString(value.canonicalUrl, "canonicalUrl"),
		collection: requiredString(value.collection, "collection"),
		collectionLabel: requiredString(value.collectionLabel, "collectionLabel"),
		corpus: requiredString(value.corpus, "corpus"),
		documentSlug: requiredString(value.documentSlug, "documentSlug"),
		documentTitle: requiredString(value.documentTitle, "documentTitle"),
		highlightRootUnitIds: requiredStringArray(value.highlightRootUnitIds, "highlightRootUnitIds"),
		searchText: requiredString(value.searchText, "searchText"),
		searchUnitId: requiredString(value.searchUnitId, "searchUnitId"),
		sectionTitle: requiredString(value.sectionTitle, "sectionTitle"),
		snippet: requiredString(value.snippet, "snippet"),
		versionSlug: requiredString(value.versionSlug, "versionSlug"),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`protected docs search entry requires ${field}.`);
	}
	return value.trim();
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`protected docs search entry requires ${field}.`);
	}
	return value.map((item) => requiredString(item, field));
}
