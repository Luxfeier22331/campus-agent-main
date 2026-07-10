import { resolve } from "node:path";

import {
	resolveCollectionLabel,
	resolveCorpusLabel,
	resolveDocumentDisplayTitle,
} from "./published-reader-labels.ts";
import { escapeHtml, formatJson, writeText } from "./published-reader-text.ts";
import type {
	EntriesByScope,
	RoutedPublishedReaderManifestEntry,
} from "./published-reader-types.ts";

const CORPUS_ORDER = ["regulations", "curriculum"];
const COLLECTION_ORDER = [
	"student_rules",
	"institutional_rules",
	"scoped_rules",
	"curriculum_plan",
];

export function buildEntriesByScope(entries: RoutedPublishedReaderManifestEntry[]): EntriesByScope {
	const byScope: EntriesByScope = new Map();
	for (const entry of entries) {
		const key = `${entry.corpus}/${entry.collection}`;
		byScope.set(key, [...(byScope.get(key) ?? []), entry]);
	}
	return byScope;
}

export function writeCollectionMetaFiles(input: {
	byScope: EntriesByScope;
	docsRoot: string;
}): void {
	const docsDir = resolve(input.docsRoot, "docs");
	const byScope = input.byScope;
	writeText(resolve(docsDir, "_meta.json"), formatJson(buildDocsMeta(byScope)));
	for (const corpus of sortedCorpora(byScope)) {
		const corpusDir = resolve(docsDir, corpus);
		writeText(resolve(corpusDir, "_meta.json"), formatJson(buildCorpusMeta(corpus, byScope)));
	}
	for (const [scope, entries] of byScope) {
		const [corpus, collection] = scope.split("/");
		const collectionDir = resolve(docsDir, corpus, collection);
		writeText(resolve(collectionDir, "_meta.json"), formatJson(buildCollectionMeta(entries)));
	}
}

export function writeCollectionIndexPages(input: {
	byScope: EntriesByScope;
	docsRoot: string;
}): void {
	const docsDir = resolve(input.docsRoot, "docs");
	const byScope = input.byScope;
	writeText(resolve(docsDir, "index.md"), buildDocsIndexPage(byScope));
	for (const corpus of sortedCorpora(byScope)) {
		const corpusDir = resolve(docsDir, corpus);
		writeText(resolve(corpusDir, "index.md"), buildCorpusIndexPage(corpus, byScope));
	}
	for (const [scope, entries] of byScope) {
		const [corpus, collection] = scope.split("/");
		const collectionDir = resolve(docsDir, corpus, collection);
		writeText(
			resolve(collectionDir, "index.md"),
			buildCollectionIndexPage({ collection, corpus, entries }),
		);
	}
}

function buildDocsMeta(byScope: EntriesByScope): Record<string, unknown>[] {
	return [
		{
			type: "file",
			name: "index",
			label: "目录",
		},
		...sortedCorpora(byScope).map((corpus) => ({
			type: "dir",
			name: corpus,
			label: resolveCorpusLabel(corpus),
			collapsed: false,
		})),
	];
}

function buildCorpusMeta(corpus: string, byScope: EntriesByScope): Record<string, unknown>[] {
	return [
		{
			type: "file",
			name: "index",
			label: "目录",
		},
		...sortedCollections(corpus, byScope).map((collection) => ({
			type: "dir",
			name: collection,
			label: resolveCollectionLabel({ collection, corpus }),
			collapsed: true,
		})),
	];
}

function buildCollectionMeta(
	entries: RoutedPublishedReaderManifestEntry[],
): Record<string, unknown>[] {
	return [
		{
			type: "file",
			name: "index",
			label: "目录",
		},
		...entries.map((entry) => ({
			type: "file",
			name: entry.routeSlug,
			label: resolveDocumentDisplayTitle(entry.title),
		})),
	];
}

export function buildRootMeta(): Record<string, unknown>[] {
	return [{ type: "dir", name: "docs", label: "文档", collapsed: false }];
}

export function buildHomePage(): string {
	return [
		"---",
		'title: "文档"',
		"footer: false",
		"outline: false",
		"---",
		"",
		"# 文档",
		"",
		"请选择文档目录继续阅读。",
		"",
	].join("\n");
}

function buildDocsIndexPage(byScope: EntriesByScope): string {
	const lines = [
		"---",
		'title: "文档"',
		"footer: false",
		"outline: false",
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		"---",
		"",
		"# 文档",
		"",
		"## 文档集合",
		"",
		'<nav className="docs-category-links" aria-label="文档目录">',
		"",
		"<ul>",
	];
	for (const corpus of sortedCorpora(byScope)) {
		lines.push(
			`\t<li><a href="/docs/${corpus}/">${escapeHtml(resolveCorpusLabel(corpus))}</a></li>`,
		);
	}
	lines.push("</ul>", "", "</nav>", "");
	return lines.join("\n");
}

function buildCorpusIndexPage(corpus: string, byScope: EntriesByScope): string {
	const corpusLabel = resolveCorpusLabel(corpus);
	const lines = [
		"---",
		`title: ${JSON.stringify(corpusLabel)}`,
		"footer: false",
		"outline: false",
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		"---",
		"",
		`# ${corpusLabel}`,
		"",
		"## 集合",
		"",
		'<nav className="docs-category-links" aria-label="文档集合目录">',
		"",
		"<ul>",
	];
	for (const collection of sortedCollections(corpus, byScope)) {
		lines.push(
			`\t<li><a href="/docs/${corpus}/${collection}/">${escapeHtml(
				resolveCollectionLabel({ collection, corpus }),
			)}</a></li>`,
		);
	}
	lines.push("</ul>", "", "</nav>", "");
	return lines.join("\n");
}

function buildCollectionIndexPage(input: {
	collection: string;
	corpus: string;
	entries: RoutedPublishedReaderManifestEntry[];
}): string {
	const collectionLabel = resolveCollectionLabel(input);
	const lines = [
		"---",
		`title: ${JSON.stringify(collectionLabel)}`,
		"footer: false",
		"outline: false",
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		"---",
		"",
		`# ${collectionLabel}`,
		"",
		"## 文档",
		"",
		'<nav className="docs-category-links" aria-label="文档列表">',
		"",
		"<ul>",
	];
	for (const entry of input.entries) {
		lines.push(
			`\t<li><a href="/docs/${entry.corpus}/${entry.collection}/${entry.routeSlug}">${escapeHtml(
				resolveDocumentDisplayTitle(entry.title),
			)}</a></li>`,
		);
	}
	lines.push("</ul>", "", "</nav>", "");
	return lines.join("\n");
}

function sortedCorpora(byScope: EntriesByScope): string[] {
	return [...new Set([...byScope.keys()].map((scope) => scope.split("/", 1)[0]))].sort(
		compareCorpus,
	);
}

function sortedCollections(corpus: string, byScope: EntriesByScope): string[] {
	return [...byScope.keys()]
		.filter((scope) => scope.startsWith(`${corpus}/`))
		.map((scope) => scope.split("/")[1])
		.filter(Boolean)
		.sort(compareCollection);
}

function compareCorpus(left: string, right: string): number {
	return compareOrdered(left, right, CORPUS_ORDER);
}

function compareCollection(left: string, right: string): number {
	return compareOrdered(left, right, COLLECTION_ORDER);
}

function compareOrdered(left: string, right: string, order: string[]): number {
	const leftIndex = order.indexOf(left);
	const rightIndex = order.indexOf(right);
	if (leftIndex !== rightIndex) {
		return normalizeOrderIndex(leftIndex) - normalizeOrderIndex(rightIndex);
	}
	return left.localeCompare(right);
}

function normalizeOrderIndex(index: number): number {
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
