import {
	createDocsSearchFlexIndex,
	type DocsSearchFlexIndex,
	importDocsSearchChunks,
} from "./search-index";
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
	index: DocsSearchFlexIndex;
}

export function searchDocsIndex(
	query: string,
	searchIndex: DocsSearchIndex,
	siteIndex: DocsSiteIndex,
	limit?: number,
): DocsSearchResult[] {
	return searchDocsEngine(query, createDocsSearchEngine(searchIndex, siteIndex), limit);
}

export function createDocsSearchEngine(
	searchIndex: DocsSearchIndex,
	siteIndex: DocsSiteIndex,
): DocsSearchEngine {
	const documents = buildDocumentMap(siteIndex);
	const entries = searchIndex.entries.map((entry) => {
		const document = documents.get(entry.docId);
		if (!document) {
			throw new Error(`docs search entry references missing document: ${entry.docId}`);
		}
		return { document, entry };
	});
	const index = createDocsSearchFlexIndex();
	importDocsSearchChunks(index, searchIndex.chunks);
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
	const completeMatches = resolveResolvers(
		terms.map((term) => createTermResolver(engine.index, term)),
		"and",
		engine.entries.length,
	);
	const partialMatches = resolveResolvers(
		terms.map((term) => createTermResolver(engine.index, term)),
		"or",
		engine.entries.length,
	);
	const entryIds = uniqueEntryIds([...completeMatches, ...partialMatches]);

	return entryIds
		.slice(0, requestedLimit)
		.map((entryId) => engine.entries[entryId])
		.filter((item): item is DocsSearchEngine["entries"][number] => item !== undefined)
		.map(({ document, entry }) => ({
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

function createTermResolver(index: DocsSearchFlexIndex, term: string) {
	return index
		.search(term, { field: "documentTitle", resolve: false })
		.or({ query: term, field: "sectionTitle", boost: 1 })
		.or({ query: term, field: "topicLabel", boost: 2 })
		.or({ query: term, field: "searchText", boost: 3 });
}

function resolveResolvers(
	resolvers: ReturnType<typeof createTermResolver>[],
	operator: "and" | "or",
	limit: number,
): Array<string | number> {
	const first = resolvers[0];
	if (!first) {
		return [];
	}
	let combined = first;
	for (const resolver of resolvers.slice(1)) {
		combined = operator === "and" ? combined.and(resolver) : combined.or(resolver);
	}
	return combined.resolve({ limit });
}

function uniqueEntryIds(ids: Array<string | number>): number[] {
	const result: number[] = [];
	const seen = new Set<number>();
	for (const id of ids) {
		const entryId = Number(id);
		if (Number.isSafeInteger(entryId) && entryId >= 0 && !seen.has(entryId)) {
			seen.add(entryId);
			result.push(entryId);
		}
	}
	return result;
}

function uniqueTerms(query: string): string[] {
	return [...new Set(query.split(" ").filter(Boolean))];
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
