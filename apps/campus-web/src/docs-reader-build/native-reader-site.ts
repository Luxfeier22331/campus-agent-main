import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	buildReaderDescription,
	type DocsReaderElement,
	type DocsReaderPayload,
	parseDocsReaderPayload,
} from "../features/docs/model.ts";
import {
	compareDocsCollections,
	DOCS_SEARCH_INDEX_SCHEMA,
	DOCS_SITE_INDEX_SCHEMA,
	type DocsSearchIndex,
	type DocsSiteCollection,
	type DocsSiteDocument,
	type DocsSiteIndex,
	type DocsSiteVersion,
} from "../features/docs/site-index.ts";
import { compareDocsVersionSlugs } from "../features/docs/version.ts";
import { publicReaderUrl, readPublishedObject } from "./published-reader-assets.ts";
import { resolveCorpusLabel, resolveDocumentDisplayTitle } from "./published-reader-labels.ts";
import {
	buildReaderCanonicalUrl,
	buildReaderVersionUrl,
	resolveDocumentVersionKey,
} from "./published-reader-routes.ts";
import { formatJson, writeText } from "./published-reader-text.ts";
import type {
	PublishedReaderCollection,
	PublishedReaderManifest,
	ReaderObjectStoreClient,
	RoutedPublishedReaderManifestEntry,
} from "./published-reader-types.ts";

export const NATIVE_DOCS_CATALOG_SCHEMA = "campus_docs_native_catalog.v5" as const;
export const NATIVE_DOCS_CATALOG_FILE = "catalog.json";

export interface NativeDocsCatalogRoute {
	canonicalUrl: string;
	collection: string;
	collectionLabel: string;
	corpus: string;
	description: string;
	docId: string;
	documentSlug: string;
	readerUrl: string;
	routeSlug: string;
	title: string;
	topicId: string | null;
	versionId: string;
	versionSlug: string;
	versions: Array<{
		canonicalUrl: string;
		versionId: string;
		versionSlug: string;
	}>;
}

export interface NativeDocsCatalog {
	routes: NativeDocsCatalogRoute[];
	schemaVersion: typeof NATIVE_DOCS_CATALOG_SCHEMA;
	siteIndex: DocsSiteIndex;
}

export async function writeNativeReaderSite(input: {
	client: ReaderObjectStoreClient;
	entries: RoutedPublishedReaderManifestEntry[];
	generatedRoot: string;
	manifest: PublishedReaderManifest;
	publicRoot: string;
}): Promise<void> {
	const versionsByDocument = groupVersionsByDocument(input.entries);
	const collectionsByScope = new Map(
		input.manifest.collections.map((collection) => [scopeKey(collection), collection]),
	);
	const readersByVersion = new Map<string, DocsReaderPayload>();
	for (const entry of input.entries) {
		const reader = parseDocsReaderPayload(
			JSON.parse(
				new TextDecoder().decode(
					await readPublishedObject({ client: input.client, ref: entry.reader }),
				),
			),
		);
		if (reader.docId !== entry.docId || reader.versionId !== entry.versionId) {
			throw new Error(`reader identity does not match docs entry: ${entry.versionId}`);
		}
		readersByVersion.set(entry.versionId, reader);
	}
	const routes = input.entries.flatMap((entry) => {
		const reader = readersByVersion.get(entry.versionId);
		if (!reader) {
			throw new Error(`reader is missing after validation: ${entry.versionId}`);
		}
		const collection = collectionsByScope.get(scopeKey(entry));
		if (!collection) {
			throw new Error(`docs source collection is missing: ${scopeKey(entry)}`);
		}
		const documentEntries = versionsByDocument.get(resolveDocumentVersionKey(entry)) ?? [];
		const latest = latestVersionEntry(documentEntries);
		const route: NativeDocsCatalogRoute = {
			canonicalUrl: buildReaderCanonicalUrl(entry, latest.versionId),
			collection: entry.collection,
			collectionLabel: collection.displayName,
			corpus: entry.corpus,
			description: buildReaderDescription(reader, entry.title),
			docId: entry.docId,
			documentSlug: entry.documentSlug,
			readerUrl: publicReaderUrl(entry),
			routeSlug: entry.routeSlug,
			title: resolveDocumentDisplayTitle(entry.title),
			topicId: entry.topicId,
			versionId: entry.versionId,
			versionSlug: entry.versionSlug,
			versions: documentEntries.map((version) => ({
				canonicalUrl: buildReaderCanonicalUrl(version, latest.versionId),
				versionId: version.versionId,
				versionSlug: version.versionSlug,
			})),
		};
		return entry.versionId === latest.versionId
			? [route, { ...route, canonicalUrl: buildReaderVersionUrl(entry) }]
			: [route];
	});
	const publicSearchIndex = buildPublicSearchIndex({
		entries: input.entries,
		readersByVersion,
	});
	const searchIndexText = formatJson(publicSearchIndex);
	const searchIndexDigest = createHash("sha256").update(searchIndexText).digest("hex");
	const searchIndexUrl = `/_docs/search/sha256/${searchIndexDigest}.json`;
	const siteIndex = buildSiteIndex({
		collectionsByScope,
		entries: input.entries,
		redirects: input.manifest.redirects,
		searchIndexUrl,
		topics: input.manifest.topics,
	});
	const catalog: NativeDocsCatalog = {
		routes: routes.sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl)),
		schemaVersion: NATIVE_DOCS_CATALOG_SCHEMA,
		siteIndex,
	};

	writeText(resolve(input.generatedRoot, NATIVE_DOCS_CATALOG_FILE), formatJson(catalog));
	writeText(resolve(input.publicRoot, "_docs/site-index.json"), formatJson(siteIndex));
	writeText(resolve(input.publicRoot, searchIndexUrl.slice(1)), searchIndexText);
}

export function readNativeDocsCatalog(path: string): NativeDocsCatalog {
	const value = JSON.parse(readFileSync(path, "utf8")) as NativeDocsCatalog;
	if (value.schemaVersion !== NATIVE_DOCS_CATALOG_SCHEMA || !Array.isArray(value.routes)) {
		throw new Error("native docs catalog is invalid");
	}
	return value;
}

function buildSiteIndex(input: {
	collectionsByScope: Map<string, PublishedReaderCollection>;
	entries: RoutedPublishedReaderManifestEntry[];
	redirects: PublishedReaderManifest["redirects"];
	searchIndexUrl: string;
	topics: PublishedReaderManifest["topics"];
}): DocsSiteIndex {
	const collections = [...input.collectionsByScope.values()]
		.sort(compareDocsCollections)
		.map((collection): DocsSiteCollection => {
			const key = scopeKey(collection);
			const scopedEntries = input.entries.filter((entry) => scopeKey(entry) === key);
			const documentsById = new Map<string, RoutedPublishedReaderManifestEntry[]>();
			for (const entry of scopedEntries) {
				documentsById.set(entry.docId, [...(documentsById.get(entry.docId) ?? []), entry]);
			}
			return {
				collection: collection.collection,
				corpus: collection.corpus,
				corpusLabel: resolveCorpusLabel(collection.corpus),
				description: collection.description,
				documents: [...documentsById.values()]
					.map(buildSiteDocument)
					.sort((left, right) => left.title.localeCompare(right.title, "zh-CN")),
				label: collection.displayName,
			};
		});
	return {
		collections,
		redirects: [...input.redirects],
		searchIndexUrl: input.searchIndexUrl,
		schemaVersion: DOCS_SITE_INDEX_SCHEMA,
		topics: [...input.topics].sort(
			(left, right) => left.corpus.localeCompare(right.corpus) || left.order - right.order,
		),
	};
}

function buildSiteDocument(entries: RoutedPublishedReaderManifestEntry[]): DocsSiteDocument {
	const latest = latestVersionEntry(entries);
	const versions = entries
		.map(
			(entry): DocsSiteVersion => ({
				canonicalUrl: buildReaderCanonicalUrl(entry, latest.versionId),
				readerUrl: publicReaderUrl(entry),
				versionId: entry.versionId,
				versionSlug: entry.versionSlug,
			}),
		)
		.sort(compareSiteVersion);
	return {
		canonicalUrl: buildReaderCanonicalUrl(latest, latest.versionId),
		docId: latest.docId,
		documentSlug: latest.documentSlug,
		title: resolveDocumentDisplayTitle(latest.title),
		topicId: latest.topicId,
		versions,
	};
}

function buildPublicSearchIndex(input: {
	entries: RoutedPublishedReaderManifestEntry[];
	readersByVersion: Map<string, DocsReaderPayload>;
}): DocsSearchIndex {
	const searchEntries: DocsSearchIndex["entries"] = [];
	const latestVersionIds = new Set(
		[...groupVersionsByDocument(input.entries).values()].map(
			(entries) => latestVersionEntry(entries).versionId,
		),
	);
	for (const entry of input.entries) {
		if (!latestVersionIds.has(entry.versionId)) {
			continue;
		}
		const reader = input.readersByVersion.get(entry.versionId);
		if (!reader) {
			throw new Error(`reader is missing for search: ${entry.versionId}`);
		}
		searchEntries.push(
			...buildReaderSearchEntries({
				docId: entry.docId,
				documentTitle: resolveDocumentDisplayTitle(entry.title),
				reader,
			}),
		);
	}
	return {
		entries: searchEntries.sort((left, right) =>
			`${left.docId}:${left.anchor}`.localeCompare(`${right.docId}:${right.anchor}`),
		),
		schemaVersion: DOCS_SEARCH_INDEX_SCHEMA,
	};
}

function buildReaderSearchEntries(input: {
	docId: string;
	documentTitle: string;
	reader: DocsReaderPayload;
}): DocsSearchIndex["entries"] {
	const result: DocsSearchIndex["entries"] = [];
	let current: {
		anchor: string;
		elements: DocsReaderElement[];
		rootUnitId?: string;
		sectionTitle: string;
	} = {
		anchor: "document",
		elements: [],
		sectionTitle: input.documentTitle,
	};
	const appendCurrent = () => {
		if (!(current.rootUnitId || current.elements.length > 0)) {
			return;
		}
		result.push(
			buildSearchEntry({
				anchor: current.anchor,
				docId: input.docId,
				elements: current.elements,
				...(current.rootUnitId ? { rootUnitId: current.rootUnitId } : {}),
				sectionTitle: current.sectionTitle,
			}),
		);
	};
	for (const element of input.reader.elements) {
		if (element.kind !== "heading") {
			current.elements.push(element);
			continue;
		}
		appendCurrent();
		current = {
			anchor: element.anchor,
			elements: [],
			rootUnitId: element.rootUnitId,
			sectionTitle: element.text,
		};
	}
	appendCurrent();
	return result;
}

function buildSearchEntry(input: {
	anchor: string;
	docId: string;
	elements: DocsReaderElement[];
	rootUnitId?: string;
	sectionTitle: string;
}): DocsSearchIndex["entries"][number] {
	const elementTexts = input.elements.map(elementText).filter(Boolean);
	const searchText = [input.sectionTitle, ...elementTexts].join(" ").trim();
	const snippetSource = elementTexts.join(" ").trim() || input.sectionTitle;
	return {
		anchor: input.anchor,
		docId: input.docId,
		highlightRootUnitIds: [
			...(input.rootUnitId ? [input.rootUnitId] : []),
			...input.elements.map((element) => element.rootUnitId),
		].slice(0, 8),
		searchText,
		sectionTitle: input.sectionTitle,
		snippet: snippetSource.length > 180 ? `${snippetSource.slice(0, 177)}...` : snippetSource,
	};
}

function elementText(element: DocsReaderElement): string {
	if (element.kind === "table") {
		return element.rows.flatMap((row) => row.map((cell) => cell.text)).join(" ");
	}
	return element.kind === "heading" ? "" : element.text;
}

function groupVersionsByDocument(
	entries: RoutedPublishedReaderManifestEntry[],
): Map<string, RoutedPublishedReaderManifestEntry[]> {
	const result = new Map<string, RoutedPublishedReaderManifestEntry[]>();
	for (const entry of entries) {
		const key = resolveDocumentVersionKey(entry);
		result.set(key, [...(result.get(key) ?? []), entry].sort(compareEntryVersion));
	}
	return result;
}

function compareEntryVersion(
	left: RoutedPublishedReaderManifestEntry,
	right: RoutedPublishedReaderManifestEntry,
): number {
	return compareDocsVersionSlugs(right.versionSlug, left.versionSlug);
}

function compareSiteVersion(left: DocsSiteVersion, right: DocsSiteVersion): number {
	return compareDocsVersionSlugs(right.versionSlug, left.versionSlug);
}

function latestVersionEntry(
	entries: readonly RoutedPublishedReaderManifestEntry[],
): RoutedPublishedReaderManifestEntry {
	const latest = entries.reduce<RoutedPublishedReaderManifestEntry | undefined>(
		(candidate, entry) => {
			if (!candidate || compareDocsVersionSlugs(entry.versionSlug, candidate.versionSlug) > 0) {
				return entry;
			}
			return candidate;
		},
		undefined,
	);
	if (!latest) {
		throw new Error("public document is missing a version");
	}
	return latest;
}

function scopeKey(value: { collection: string; corpus: string }): string {
	return `${value.corpus}/${value.collection}`;
}
