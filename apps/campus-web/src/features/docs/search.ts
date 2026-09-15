import { Charset, Index } from "flexsearch";

import { normalizeDocsSearchQuery } from "./search-query";
import {
	type DocsSearchEntry,
	type DocsSearchIndex,
	type DocsSiteIndex,
	parseDocsSearchIndex,
} from "./site-index";

export { normalizeDocsSearchQuery } from "./search-query";

export interface DocsSearchDocument {
	canonicalUrl: string;
	collection: string;
	collectionLabel: string;
	corpus: string;
	docId: string;
	documentTitle: string;
	topicId: string | null;
	topicLabel: string | null;
}

export interface DocsSearchResult {
	document: DocsSearchDocument;
	entry: DocsSearchEntry;
	url: string;
}

export interface DocsSearchEngine {
	entries: Array<{ document: DocsSearchDocument; entry: DocsSearchEntry }>;
	index: Index;
}

export function searchDocsIndexes(
	query: string,
	indexes: readonly DocsSearchIndex[],
	siteIndex: DocsSiteIndex,
	limit?: number,
): DocsSearchResult[] {
	return searchDocsEngine(query, createDocsSearchEngine(indexes, siteIndex), limit);
}

export function createDocsSearchEngine(
	indexes: readonly DocsSearchIndex[],
	siteIndex: DocsSiteIndex,
): DocsSearchEngine {
	const documents = buildDocumentMap(siteIndex);
	const entries = deduplicateEntries(indexes.flatMap((index) => index.entries)).map((entry) => {
		const document = documents.get(entry.docId);
		if (!document) {
			throw new Error(`docs search entry references missing document: ${entry.docId}`);
		}
		return { document, entry };
	});
	const index = new Index({ encoder: Charset.CJK, tokenize: "full" });
	entries.forEach(({ document, entry }, entryIndex) => {
		index.add(
			entryIndex,
			normalizeDocsSearchQuery(
				[document.documentTitle, document.topicLabel, entry.sectionTitle, entry.searchText]
					.filter(Boolean)
					.join(" "),
			),
		);
	});
	return { entries, index };
}

export function searchDocsEngine(
	query: string,
	engine: DocsSearchEngine,
	limit?: number,
): DocsSearchResult[] {
	const normalizedQuery = normalizeDocsSearchQuery(query);
	if (!normalizedQuery) {
		return [];
	}
	const requestedLimit = Math.min(limit ?? engine.entries.length, engine.entries.length);
	const terms = uniqueTerms(normalizedQuery);
	const flexRanks = new Map<number, number[]>();
	for (const term of terms) {
		for (const [rank, id] of engine.index
			.search(term, { limit: engine.entries.length })
			.entries()) {
			const entryId = Number(id);
			flexRanks.set(entryId, [...(flexRanks.get(entryId) ?? []), rank]);
		}
	}
	return [...flexRanks]
		.map(([entryId, ranks]) => {
			const item = engine.entries[entryId];
			return item ? { item, ranks } : null;
		})
		.filter(
			(value): value is { item: DocsSearchEngine["entries"][number]; ranks: number[] } =>
				value !== null,
		)
		.sort(compareSearchEntry(normalizedQuery, terms, engine.entries.length))
		.slice(0, requestedLimit)
		.map(({ item: { document, entry } }) => ({
			document,
			entry,
			url: buildDocsSearchResultUrl(document, entry),
		}));
}

export async function readDocsSearchIndex(url: string): Promise<DocsSearchIndex> {
	const response = await fetch(url, {
		credentials: "same-origin",
		headers: { accept: "application/json" },
	});
	if (!(response.ok && isJsonResponse(response))) {
		throw new Error(`docs search index request failed: ${response.status}`);
	}
	return parseDocsSearchIndex(await response.json());
}

function buildDocumentMap(siteIndex: DocsSiteIndex): Map<string, DocsSearchDocument> {
	const result = new Map<string, DocsSearchDocument>();
	for (const collection of siteIndex.collections) {
		for (const document of collection.documents) {
			if (result.has(document.docId)) {
				throw new Error(`duplicate docs site document id: ${document.docId}`);
			}
			const topic = document.topicId
				? siteIndex.topics.find(
						(item) => item.corpus === collection.corpus && item.topicId === document.topicId,
					)
				: null;
			if (document.topicId && !topic) {
				throw new Error(`docs search document references missing topic: ${document.docId}`);
			}
			result.set(document.docId, {
				canonicalUrl: document.canonicalUrl,
				collection: collection.collection,
				collectionLabel: collection.label,
				corpus: collection.corpus,
				docId: document.docId,
				documentTitle: document.title,
				topicId: topic?.topicId ?? null,
				topicLabel: topic?.displayName ?? null,
			});
		}
	}
	return result;
}

function deduplicateEntries(entries: DocsSearchEntry[]): DocsSearchEntry[] {
	const byId = new Map<string, DocsSearchEntry>();
	for (const entry of entries) {
		byId.set(`${entry.docId}:${entry.anchor}`, entry);
	}
	return [...byId.values()];
}

function compareSearchEntry(
	normalizedQuery: string,
	terms: readonly string[],
	entryCount: number,
): (
	left: { item: DocsSearchEngine["entries"][number]; ranks: number[] },
	right: { item: DocsSearchEngine["entries"][number]; ranks: number[] },
) => number {
	return (left, right) => {
		const leftScore = scoreSearchEntry(left.item, normalizedQuery, terms, left.ranks, entryCount);
		const rightScore = scoreSearchEntry(
			right.item,
			normalizedQuery,
			terms,
			right.ranks,
			entryCount,
		);
		return (
			rightScore.exactCompactTitle - leftScore.exactCompactTitle ||
			rightScore.allTerms - leftScore.allTerms ||
			rightScore.exactSection - leftScore.exactSection ||
			rightScore.coveredTerms - leftScore.coveredTerms ||
			rightScore.fieldScore - leftScore.fieldScore ||
			leftScore.flexRank - rightScore.flexRank ||
			left.item.document.documentTitle.localeCompare(right.item.document.documentTitle, "zh-CN") ||
			left.item.entry.anchor.localeCompare(right.item.entry.anchor)
		);
	};
}

function scoreSearchEntry(
	item: DocsSearchEngine["entries"][number],
	query: string,
	terms: readonly string[],
	ranks: readonly number[],
	entryCount: number,
): {
	allTerms: number;
	coveredTerms: number;
	exactCompactTitle: number;
	exactSection: number;
	fieldScore: number;
	flexRank: number;
} {
	const title = normalizeDocsSearchQuery(item.document.documentTitle);
	const section = normalizeDocsSearchQuery(item.entry.sectionTitle);
	const body = normalizeDocsSearchQuery(item.entry.searchText);
	const coveredTerms = terms.filter((term) =>
		[title, section, body].some((field) => field.includes(term)),
	).length;
	const fieldScore = terms.reduce(
		(score, term) =>
			score +
			(title.includes(term) ? 9 : 0) +
			(section.includes(term) ? 4 : 0) +
			(body.includes(term) ? 1 : 0),
		0,
	);
	return {
		allTerms: Number(coveredTerms === terms.length),
		coveredTerms,
		exactCompactTitle: Number(compact(title) === compact(query)),
		exactSection: Number(compact(section) === compact(query)),
		fieldScore,
		flexRank:
			ranks.reduce((total, rank) => total + rank, 0) +
			Math.max(0, terms.length - ranks.length) * entryCount,
	};
}

function uniqueTerms(query: string): string[] {
	return [...new Set(query.split(" ").filter(Boolean))];
}

function compact(value: string): string {
	return value.replaceAll(" ", "");
}

function buildDocsSearchResultUrl(document: DocsSearchDocument, entry: DocsSearchEntry): string {
	const params = new URLSearchParams();
	if (entry.highlightRootUnitIds.length > 0) {
		params.set("hl", entry.highlightRootUnitIds.join(","));
	}
	const query = params.toString();
	return `${document.canonicalUrl}${query ? `?${query}` : ""}#${encodeURIComponent(entry.anchor)}`;
}

function isJsonResponse(response: Response): boolean {
	return (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}
