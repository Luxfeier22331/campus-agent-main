import { isDocsDocumentPath } from "./docs-redirects";

export const DOCS_SITE_INDEX_SCHEMA = "campus_docs_site_index.v4" as const;
export const DOCS_SEARCH_INDEX_SCHEMA = "campus_docs_search_index.v2" as const;

const DOCS_COLLECTION_ORDER = new Map<string, number>([
	["curriculum/undergraduate", 10],
	["curriculum/second_degree", 20],
	["curriculum/general_education", 30],
]);

export interface DocsSiteVersion {
	canonicalUrl: string;
	effectiveFrom: string | null;
	isCurrent: boolean;
	label: string;
	readerUrl: string;
	sourceLabel: string;
	updatedAt: string;
	versionId: string;
	versionSlug: string;
}

export interface DocsSiteDocument {
	canonicalUrl: string;
	docId: string;
	documentSlug: string;
	title: string;
	topicId: string | null;
	versions: DocsSiteVersion[];
}

export interface DocsSiteTopic {
	corpus: string;
	description: string | null;
	displayName: string;
	order: number;
	topicId: string;
}

export interface DocsSiteRedirect {
	fromPath: string;
	statusCode: 308;
	toPath: string;
}

export interface DocsSiteCollection {
	collection: string;
	corpus: string;
	corpusLabel: string;
	description: string | null;
	documents: DocsSiteDocument[];
	label: string;
}

export interface DocsSiteIndex {
	collections: DocsSiteCollection[];
	redirects: DocsSiteRedirect[];
	searchIndexUrl: string;
	schemaVersion: typeof DOCS_SITE_INDEX_SCHEMA;
	topics: DocsSiteTopic[];
}

export interface DocsNavigationSection {
	description: string | null;
	documents: DocsSiteDocument[];
	key: string;
	label: string;
}

export interface DocsNavigationGroup {
	corpus: string;
	label: string;
	sections: DocsNavigationSection[];
}

export interface DocsSearchEntry {
	anchor: string;
	docId: string;
	highlightRootUnitIds: string[];
	searchText: string;
	sectionTitle: string;
	snippet: string;
}

export interface DocsSearchIndex {
	entries: DocsSearchEntry[];
	schemaVersion: typeof DOCS_SEARCH_INDEX_SCHEMA;
}

export function compareDocsCollections(
	left: Pick<DocsSiteCollection, "collection" | "corpus">,
	right: Pick<DocsSiteCollection, "collection" | "corpus">,
): number {
	const corpusOrder = left.corpus.localeCompare(right.corpus);
	if (corpusOrder !== 0) {
		return corpusOrder;
	}
	const leftScope = `${left.corpus}/${left.collection}`;
	const rightScope = `${right.corpus}/${right.collection}`;
	const leftOrder = DOCS_COLLECTION_ORDER.get(leftScope) ?? 1000;
	const rightOrder = DOCS_COLLECTION_ORDER.get(rightScope) ?? 1000;
	return leftOrder - rightOrder || leftScope.localeCompare(rightScope);
}

export function buildDocsNavigationGroups(siteIndex: DocsSiteIndex): DocsNavigationGroup[] {
	const collectionsByCorpus = new Map<string, DocsSiteCollection[]>();
	for (const collection of [...siteIndex.collections].sort(compareDocsCollections)) {
		collectionsByCorpus.set(collection.corpus, [
			...(collectionsByCorpus.get(collection.corpus) ?? []),
			collection,
		]);
	}
	return [...collectionsByCorpus.entries()].map(([corpus, collections]) => {
		const documents = collections.flatMap((collection) => collection.documents);
		const topics = siteIndex.topics
			.filter((topic) => topic.corpus === corpus)
			.sort((left, right) => left.order - right.order);
		return {
			corpus,
			label: collections[0]?.corpusLabel ?? corpus,
			sections:
				topics.length > 0
					? topics.map((topic) => ({
							description: topic.description,
							documents: documents
								.filter((document) => document.topicId === topic.topicId)
								.sort((left, right) => left.title.localeCompare(right.title, "zh-CN")),
							key: `${corpus}/topic/${topic.topicId}`,
							label: topic.displayName,
						}))
					: collections.map((collection) => ({
							description: collection.description,
							documents: collection.documents,
							key: `${collection.corpus}/${collection.collection}`,
							label: collection.label,
						})),
		};
	});
}

export function parseDocsSiteIndex(value: unknown): DocsSiteIndex {
	const record = requiredRecord(value, "docs site index");
	if (
		record.schemaVersion !== DOCS_SITE_INDEX_SCHEMA ||
		!Array.isArray(record.collections) ||
		!Array.isArray(record.topics) ||
		!Array.isArray(record.redirects)
	) {
		throw new Error("docs site index schema is invalid");
	}
	assertExactKeys(
		record,
		["collections", "redirects", "schemaVersion", "searchIndexUrl", "topics"],
		"docs site index",
	);
	const siteIndex = {
		collections: record.collections.map(parseCollection),
		redirects: record.redirects.map(parseRedirect),
		searchIndexUrl: requiredLocalPath(record.searchIndexUrl, "searchIndexUrl"),
		schemaVersion: DOCS_SITE_INDEX_SCHEMA,
		topics: record.topics.map(parseTopic),
	};
	assertDocumentRedirects(siteIndex);
	return siteIndex;
}

function parseTopic(value: unknown): DocsSiteTopic {
	const record = requiredRecord(value, "docs site topic");
	return {
		corpus: requiredString(record.corpus, "topic corpus"),
		description: optionalString(record.description) ?? null,
		displayName: requiredString(record.displayName, "topic displayName"),
		order: requiredPositiveInteger(record.order, "topic order"),
		topicId: requiredString(record.topicId, "topicId"),
	};
}

function parseRedirect(value: unknown): DocsSiteRedirect {
	const record = requiredRecord(value, "docs site redirect");
	if (record.statusCode !== 308) {
		throw new Error("docs site redirect statusCode must be 308");
	}
	return {
		fromPath: requiredDocsPath(record.fromPath, "redirect fromPath"),
		statusCode: 308,
		toPath: requiredDocsPath(record.toPath, "redirect toPath"),
	};
}

function assertDocumentRedirects(siteIndex: DocsSiteIndex): void {
	const publishedDocumentPaths = new Set(
		siteIndex.collections.flatMap((collection) =>
			collection.documents.flatMap((document) =>
				document.versions.map((version) => version.canonicalUrl),
			),
		),
	);
	for (const redirect of siteIndex.redirects) {
		if (!isDocsDocumentPath(redirect.fromPath)) {
			throw new Error(`docs redirect source must be a document URL: ${redirect.fromPath}`);
		}
		if (publishedDocumentPaths.has(redirect.fromPath)) {
			throw new Error(`docs redirect source is already published: ${redirect.fromPath}`);
		}
		if (!publishedDocumentPaths.has(redirect.toPath)) {
			throw new Error(`docs redirect target must be a published document URL: ${redirect.toPath}`);
		}
	}
}

export function parseDocsSearchIndex(value: unknown): DocsSearchIndex {
	const record = requiredRecord(value, "docs search index");
	if (record.schemaVersion !== DOCS_SEARCH_INDEX_SCHEMA || !Array.isArray(record.entries)) {
		throw new Error("docs search index schema is invalid");
	}
	return {
		entries: record.entries.map(parseSearchEntry),
		schemaVersion: DOCS_SEARCH_INDEX_SCHEMA,
	};
}

function parseCollection(value: unknown): DocsSiteCollection {
	const record = requiredRecord(value, "docs site collection");
	if (!Array.isArray(record.documents)) {
		throw new Error("docs site collection documents must be an array");
	}
	return {
		collection: requiredString(record.collection, "collection"),
		corpus: requiredString(record.corpus, "corpus"),
		corpusLabel: requiredString(record.corpusLabel, "corpusLabel"),
		description: optionalString(record.description) ?? null,
		documents: record.documents.map(parseDocument),
		label: requiredString(record.label, "label"),
	};
}

function parseDocument(value: unknown): DocsSiteDocument {
	const record = requiredRecord(value, "docs site document");
	if (!Array.isArray(record.versions) || record.versions.length === 0) {
		throw new Error("docs site document versions must be a non-empty array");
	}
	return {
		canonicalUrl: requiredDocsPath(record.canonicalUrl, "canonicalUrl"),
		docId: requiredString(record.docId, "docId"),
		documentSlug: requiredString(record.documentSlug, "documentSlug"),
		title: requiredString(record.title, "title"),
		topicId: optionalString(record.topicId) ?? null,
		versions: record.versions.map(parseVersion),
	};
}

function parseVersion(value: unknown): DocsSiteVersion {
	const record = requiredRecord(value, "docs site version");
	return {
		canonicalUrl: requiredDocsPath(record.canonicalUrl, "version canonicalUrl"),
		effectiveFrom: optionalString(record.effectiveFrom) ?? null,
		isCurrent: requiredBoolean(record.isCurrent, "isCurrent"),
		label: requiredString(record.label, "version label"),
		readerUrl: requiredLocalPath(record.readerUrl, "readerUrl"),
		sourceLabel: requiredString(record.sourceLabel, "sourceLabel"),
		updatedAt: requiredString(record.updatedAt, "updatedAt"),
		versionId: requiredString(record.versionId, "versionId"),
		versionSlug: requiredString(record.versionSlug, "versionSlug"),
	};
}

function parseSearchEntry(value: unknown): DocsSearchEntry {
	const record = requiredRecord(value, "docs search entry");
	return {
		anchor: requiredString(record.anchor, "anchor"),
		docId: requiredString(record.docId, "docId"),
		highlightRootUnitIds: requiredStringArray(record.highlightRootUnitIds, "highlightRootUnitIds"),
		searchText: requiredString(record.searchText, "searchText"),
		sectionTitle: requiredString(record.sectionTitle, "sectionTitle"),
		snippet: requiredString(record.snippet, "snippet"),
	};
}

function requiredDocsPath(value: unknown, field: string): string {
	const path = requiredLocalPath(value, field);
	if (!(path === "/docs" || path.startsWith("/docs/"))) {
		throw new Error(`${field} must be a docs path`);
	}
	return path;
}

function requiredLocalPath(value: unknown, field: string): string {
	const path = requiredString(value, field);
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
		throw new Error(`${field} must be a same-origin path`);
	}
	const parsed = new URL(path, "https://campus.local");
	if (parsed.origin !== "https://campus.local") {
		throw new Error(`${field} must be a same-origin path`);
	}
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
	const normalized = optionalString(value);
	if (!normalized) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return normalized;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredBoolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`${field} must be a boolean`);
	}
	return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
	if (!(typeof value === "number" && Number.isSafeInteger(value) && value > 0)) {
		throw new Error(`${field} must be a positive integer`);
	}
	return value;
}

function requiredStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${field} must be an array`);
	}
	return value.map((item) => requiredString(item, field));
}

function assertExactKeys(
	record: Record<string, unknown>,
	expected: readonly string[],
	field: string,
): void {
	const actual = Object.keys(record).sort();
	const keys = [...expected].sort();
	if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
		throw new Error(`${field} has unsupported fields`);
	}
}
