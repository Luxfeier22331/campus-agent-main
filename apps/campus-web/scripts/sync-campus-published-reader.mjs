import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolvePublishedReaderSourceObjectKey,
	resolvePublishedReaderTargetObjectByDeliveryMode,
	resolveSafePublishedReaderAssetTarget,
	validatePublishedReaderAssetManifest,
} from "./published-reader-assets.mjs";
import { renderReaderBlockText } from "./published-reader-blocks.mjs";
import { writeBootstrapPages, writeGatedReaderPage } from "./published-reader-bootstrap-pages.mjs";
import {
	buildCourseMapsByHeading,
	countUnrenderedCourseMaps,
	loadReaderCourseMapSupplements,
	renderCourseMapFigure,
} from "./published-reader-course-maps.mjs";
import {
	resolveCollectionLabel,
	resolveCorpusLabel,
	resolveDocumentDisplayTitle,
	resolveDocumentKind,
	resolveReaderLayout,
	resolveReaderMeasure,
} from "./published-reader-labels.mjs";
import { loadPublishedReaderManifest } from "./published-reader-manifest.mjs";
import { createS3ObjectStore } from "./published-reader-object-store.mjs";
import {
	assertProtectedSearchUnitsReferenceReader,
	buildProtectedSearchEntry,
	buildSearchUnitsByVersionId,
} from "./published-reader-search-validation.mjs";
import { parsePublishedReaderSyncArgs } from "./published-reader-sync-args.mjs";
import {
	escapeAttribute,
	escapeHtml,
	formatJson,
	normalizeText,
	writeText,
} from "./published-reader-text.mjs";

export {
	resolvePublishedReaderObjectStoreBucket,
	resolvePublishedReaderObjectStoreConfig,
	resolvePublishedReaderObjectStoreCredentials,
} from "./published-reader-object-store.mjs";
export { parsePublishedReaderSyncArgs } from "./published-reader-sync-args.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DOCS_ROOT = resolve(APP_ROOT, ".generated/docs");
const DEFAULT_PUBLIC_ROOT = resolve(APP_ROOT, "public");
const CORPUS_ORDER = ["regulations", "curriculum"];
const COLLECTION_ORDER = [
	"student_rules",
	"institutional_rules",
	"scoped_rules",
	"curriculum_plan",
];
const SYNTHETIC_READER_SECTION_TITLES = new Set(["文档正文", "正文内容"]);

export async function syncCampusPublishedReaderDocs(input) {
	const docsRoot = resolve(
		input.docsRoot ?? process.env.CAMPUS_WEB_RSPRESS_DOCS_ROOT?.trim() ?? DEFAULT_DOCS_ROOT,
	);
	const manifest = await loadPublishedReaderManifest(input);
	const readerEntries = attachReaderRouteSlugs(
		manifest.entries.filter(
			(entry) =>
				entry.deliveryMode === "public_static_asset" || entry.deliveryMode === "gated_asset",
		),
	).sort(compareEntryRoute);
	const publicEntries = readerEntries.filter(
		(entry) => entry.deliveryMode === "public_static_asset",
	);
	const currentPublicEntries = publicEntries.filter((entry) => entry.isCurrent);
	const currentPublicEntriesByScope = buildEntriesByScope(currentPublicEntries);
	assertUniqueCurrentPublicReaderDisplayTitles(currentPublicEntries);
	const publicVersionsByDocument = buildPublicVersionsByDocument(publicEntries);
	rmSync(resolve(docsRoot, "docs"), { force: true, recursive: true });
	writeText(resolve(docsRoot, "_meta.json"), formatJson(buildRootMeta()));
	writeText(resolve(docsRoot, "index.md"), buildHomePage());
	writeBootstrapPages(docsRoot);
	writeCollectionIndexPages({ byScope: currentPublicEntriesByScope, docsRoot });
	writeCollectionMetaFiles({ byScope: currentPublicEntriesByScope, docsRoot });
	for (const entry of readerEntries) {
		await writeReaderPage({ client: input.client, docsRoot, entry, publicVersionsByDocument });
	}
	return {
		generatedDocumentCount: readerEntries.length,
		generatedGatedDocumentCount: readerEntries.filter(
			(entry) => entry.deliveryMode === "gated_asset",
		).length,
		generatedPublicDocumentCount: publicEntries.length,
	};
}

export async function syncCampusPublishedReaderAssets(input) {
	const manifest = await loadPublishedReaderManifest(input);
	const entries = manifest.entries.filter(
		(entry) => entry.deliveryMode === "public_static_asset" || entry.deliveryMode === "gated_asset",
	);
	const targetRoot = resolve(input.targetRoot ?? DEFAULT_PUBLIC_ROOT);
	const seenTargets = new Set();
	let copiedAssetCount = 0;
	rmSync(resolve(targetRoot, "_docs"), { force: true, recursive: true });
	rmSync(resolve(targetRoot, "_gated-docs"), { force: true, recursive: true });
	rmSync(resolve(targetRoot, "_gated-docs-search"), { force: true, recursive: true });
	for (const entry of entries) {
		const copies = [];
		for (const [targetLabel, targetObject] of Object.entries(entry.targetObjects)) {
			const sourceObject = resolvePublishedReaderSourceObjectKey(entry, targetLabel);
			const target = resolveSafePublishedReaderAssetTarget({
				targetObject: resolvePublishedReaderTargetObjectByDeliveryMode(
					entry.deliveryMode,
					targetObject,
				),
				targetRoot,
			});
			if (seenTargets.has(target.targetPath)) {
				throw new Error(`duplicate reader asset target: ${target.targetObject}`);
			}
			seenTargets.add(target.targetPath);
			const bytes = await input.client.readOptionalBytesObject({ key: sourceObject });
			if (!bytes) {
				throw new Error(`missing reader asset source object: ${sourceObject}`);
			}
			copies.push({ ...target, bytes });
		}
		validatePublishedReaderAssetManifest(entry, copies);
		for (const copy of copies) {
			mkdirSync(dirname(copy.targetPath), { recursive: true });
			writeFileSync(copy.targetPath, copy.bytes);
			copiedAssetCount += 1;
		}
	}
	await writeProtectedSearchIndexes({ client: input.client, entries, manifest, targetRoot });
	return {
		copiedAssetCount,
		copiedDocumentCount: entries.length,
		copiedGatedDocumentCount: entries.filter((entry) => entry.deliveryMode === "gated_asset")
			.length,
		copiedPublicDocumentCount: entries.filter(
			(entry) => entry.deliveryMode === "public_static_asset",
		).length,
	};
}

export async function checkCampusPublishedReaderInputs(input) {
	const manifest = await loadPublishedReaderManifest(input);
	const entries = attachReaderRouteSlugs(
		manifest.entries.filter(
			(entry) =>
				entry.deliveryMode === "public_static_asset" || entry.deliveryMode === "gated_asset",
		),
	);
	assertUniqueCurrentPublicReaderDisplayTitles(
		entries.filter((entry) => entry.deliveryMode === "public_static_asset" && entry.isCurrent),
	);
	let checkedObjectCount = 0;
	for (const entry of entries) {
		const copies = [];
		for (const [targetLabel, targetObject] of Object.entries(entry.targetObjects)) {
			const sourceObject = resolvePublishedReaderSourceObjectKey(entry, targetLabel);
			const target = resolveSafePublishedReaderAssetTarget({
				targetObject: resolvePublishedReaderTargetObjectByDeliveryMode(
					entry.deliveryMode,
					targetObject,
				),
				targetRoot: input.targetRoot ?? DEFAULT_PUBLIC_ROOT,
			});
			const bytes = await input.client.readOptionalBytesObject({ key: sourceObject });
			if (!bytes) {
				throw new Error(`missing reader asset source object: ${sourceObject}`);
			}
			copies.push({ ...target, bytes });
			checkedObjectCount += 1;
		}
		validatePublishedReaderAssetManifest(entry, copies);
	}
	const searchUnitsByVersionId = buildSearchUnitsByVersionId(manifest.searchUnits);
	let checkedProtectedSearchIndexCount = 0;
	for (const entry of entries) {
		if (entry.deliveryMode !== "gated_asset" || !entry.isCurrent) {
			continue;
		}
		const searchUnits = searchUnitsByVersionId.get(entry.versionId);
		if (!searchUnits) {
			throw new Error(`missing protected search units for version: ${entry.versionId}`);
		}
		await assertProtectedSearchUnitsReferenceReader({
			client: input.client,
			entries: [entry],
			searchUnitsByVersionId,
		});
		checkedProtectedSearchIndexCount += 1;
	}
	return {
		checkedDocumentCount: entries.length,
		checkedObjectCount,
		checkedProtectedSearchIndexCount,
	};
}

async function writeReaderPage(input) {
	if (input.entry.deliveryMode === "gated_asset") {
		writeGatedReaderPage(input);
		return;
	}
	const reader = JSON.parse(
		await input.client.readTextObject({ key: input.entry.sourceObjects.reader }),
	);
	const meta = input.entry.sourceObjects.meta
		? JSON.parse(await input.client.readTextObject({ key: input.entry.sourceObjects.meta }))
		: {};
	const courseMaps = await loadReaderCourseMapSupplements({
		client: input.client,
		entry: input.entry,
		reader,
	});
	const mdx = buildReaderMdx({
		entry: input.entry,
		meta,
		reader,
		courseMaps,
		searchable: false,
		versions: input.publicVersionsByDocument.get(resolveDocumentVersionKey(input.entry)) ?? [],
	});
	const versionPath = resolve(
		input.docsRoot,
		"docs",
		input.entry.corpus,
		input.entry.collection,
		input.entry.routeSlug,
		"v",
		`${input.entry.versionSlug}.mdx`,
	);
	writeText(versionPath, mdx);
	if (input.entry.isCurrent) {
		writeText(
			resolve(
				input.docsRoot,
				"docs",
				input.entry.corpus,
				input.entry.collection,
				`${input.entry.routeSlug}.mdx`,
			),
			buildReaderMdx({
				entry: input.entry,
				meta,
				reader,
				courseMaps,
				searchable: true,
				versions: input.publicVersionsByDocument.get(resolveDocumentVersionKey(input.entry)) ?? [],
			}),
		);
	}
}

function buildReaderMdx(input) {
	const title = input.reader.document?.title || input.entry.title;
	const courseMapsByHeading = buildCourseMapsByHeading(input.courseMaps ?? []);
	const lines = [
		"---",
		`title: ${JSON.stringify(title)}`,
		"footer: false",
		`docsSearchVisibility: ${JSON.stringify(input.searchable ? "public_current" : "noindex")}`,
		`documentKind: ${JSON.stringify(resolveDocumentKind(input.entry))}`,
		`readerLayout: ${JSON.stringify(resolveReaderLayout(input.entry))}`,
		`readerMeasure: ${JSON.stringify(resolveReaderMeasure(input.entry))}`,
		'readerOutline: "document"',
		"---",
		"",
		buildMetaPanel({ entry: input.entry, meta: input.meta, versions: input.versions }),
		"",
	];
	for (const section of input.reader.sections ?? []) {
		const anchor = String(section.anchor ?? "").trim();
		if (anchor) {
			lines.push(`<span id="${escapeAttribute(anchor)}"></span>`, "");
		}
		const sectionTitle = normalizeText(section.title);
		if (shouldRenderReaderSectionTitle({ sectionTitle, title })) {
			lines.push(`## ${sectionTitle}`, "");
		}
		for (const block of section.blocks ?? []) {
			const text = normalizeText(block.text);
			if (!text) {
				continue;
			}
			if (isReaderHeadingBlock(block, text)) {
				const headingLevel = resolveReaderHeadingLevel(text);
				lines.push(`${"#".repeat(headingLevel)} ${text}`, "");
				for (const courseMap of courseMapsByHeading.get(text) ?? []) {
					lines.push(renderCourseMapFigure(courseMap), "");
				}
				courseMapsByHeading.delete(text);
				continue;
			}
			const rootUnitId = String(block.rootUnitId ?? "").trim();
			lines.push(
				`<div className="reader-block" data-root-unit-id="${escapeAttribute(rootUnitId)}">`,
				"",
				renderReaderBlockText(text),
				"",
				"</div>",
				"",
			);
			for (const courseMap of courseMapsByHeading.get(text) ?? []) {
				lines.push(renderCourseMapFigure(courseMap), "");
			}
			courseMapsByHeading.delete(text);
		}
	}
	const unrenderedCourseMapCount = countUnrenderedCourseMaps(courseMapsByHeading);
	if (unrenderedCourseMapCount > 0) {
		throw new Error(
			`course map supplement has no matching reader heading: ${input.entry.documentSlug}`,
		);
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

function isReaderHeadingBlock(block, text) {
	const kind = String(block?.kind ?? "").trim();
	if (kind) {
		return kind === "heading";
	}
	return text.length <= 32 && isReaderHeadingText(text);
}

function isReaderHeadingText(text) {
	return /^(第[一二三四五六七八九十百]+章\b|[一二三四五六七八九十]+、\S|（[一二三四五六七八九十]+）\S|\([一二三四五六七八九十]+\)\S|[1-9][0-9]{0,1}\.\S)/u.test(
		text,
	);
}

function resolveReaderHeadingLevel(text) {
	if (/^(第[一二三四五六七八九十百]+章\b|[一二三四五六七八九十]+、\S)/u.test(text)) {
		return 2;
	}
	return 3;
}

function shouldRenderReaderSectionTitle(input) {
	const normalizedTitle = normalizeText(input.title);
	const normalizedDisplayTitle = resolveDocumentDisplayTitle(normalizedTitle);
	return Boolean(
		input.sectionTitle &&
			input.sectionTitle !== normalizedTitle &&
			input.sectionTitle !== normalizedDisplayTitle &&
			!SYNTHETIC_READER_SECTION_TITLES.has(input.sectionTitle),
	);
}

function buildMetaPanel(input) {
	const versionLabel = input.entry.versionLabel || input.meta.resolvedVersion?.label || "当前版";
	const collectionLabel = resolveCollectionLabel(input.entry);
	const sourceLabel = input.meta.source?.title || input.meta.sourceLabel || collectionLabel;
	const details = [
		["文档集合", collectionLabel],
		["版本", versionLabel],
		["来源", sourceLabel],
	];
	const versionPayload = JSON.stringify({
		versions: input.versions.map((version) => ({
			isCurrent: version.isCurrent,
			label: version.label,
			versionSlug: version.versionSlug,
		})),
	});
	return [
		`<section className="document-meta-panel" aria-label="文档来源与版本" data-docs-reader-meta="true" data-docs-corpus="${escapeAttribute(input.entry.corpus)}" data-docs-collection="${escapeAttribute(input.entry.collection)}" data-docs-document-slug="${escapeAttribute(input.entry.documentSlug)}" data-docs-route-slug="${escapeAttribute(input.entry.routeSlug)}" data-docs-version-slug="${escapeAttribute(input.entry.versionSlug)}" data-docs-search-visibility="${input.entry.deliveryMode === "gated_asset" ? "gated_bootstrap" : input.entry.isCurrent ? "public_current" : "noindex"}" data-docs-is-current="${input.entry.isCurrent ? "true" : "false"}" data-docs-versions="${escapeAttribute(versionPayload)}">`,
		'\t<p className="document-meta-summary">',
		`\t\t<span>${escapeHtml(versionLabel)}</span>`,
		`\t\t<span>来源：${escapeHtml(sourceLabel)}</span>`,
		"\t</p>",
		'\t<details className="document-meta-details">',
		"\t\t<summary>来源详情</summary>",
		"\t\t<dl>",
		...details.flatMap(([label, value]) => [
			"\t\t\t<div>",
			`\t\t\t\t<dt>${escapeHtml(label)}</dt>`,
			`\t\t\t\t<dd>${escapeHtml(value)}</dd>`,
			"\t\t\t</div>",
		]),
		"\t\t</dl>",
		"\t</details>",
		"</section>",
	].join("\n");
}

function buildPublicVersionsByDocument(entries) {
	const versionsByDocument = new Map();
	for (const entry of entries) {
		const key = resolveDocumentVersionKey(entry);
		versionsByDocument.set(key, [
			...(versionsByDocument.get(key) ?? []),
			{
				isCurrent: entry.isCurrent,
				label: entry.versionLabel || "当前版",
				versionSlug: entry.versionSlug,
			},
		]);
	}
	for (const [key, versions] of versionsByDocument) {
		versionsByDocument.set(key, versions.sort(comparePublicVersion));
	}
	return versionsByDocument;
}

function resolveDocumentVersionKey(entry) {
	return `${entry.corpus}/${entry.collection}/${entry.documentSlug}`;
}

function attachReaderRouteSlugs(entries) {
	const routeSlugByDocument = new Map();
	const documentByRouteSlug = new Map();
	return entries.map((entry) => {
		const documentKey = resolveDocumentVersionKey(entry);
		const routeSlug = routeSlugByDocument.get(documentKey) ?? buildDocumentRouteSlug(entry);
		routeSlugByDocument.set(documentKey, routeSlug);

		const routeKey = `${entry.corpus}/${entry.collection}/${routeSlug}`;
		const existingDocumentSlug = documentByRouteSlug.get(routeKey);
		if (existingDocumentSlug && existingDocumentSlug !== entry.documentSlug) {
			throw new Error(`duplicate docs reader route slug: ${routeKey}`);
		}
		documentByRouteSlug.set(routeKey, entry.documentSlug);
		return { ...entry, routeSlug };
	});
}

function buildDocumentRouteSlug(entry) {
	if (isSafeReaderRouteSlug(entry.documentSlug)) {
		return entry.documentSlug;
	}
	const digest = createHash("sha256")
		.update(resolveDocumentVersionKey(entry))
		.digest("hex")
		.slice(0, 12);
	return `doc-${digest}`;
}

function isSafeReaderRouteSlug(value) {
	return /^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(value) && value !== "." && value !== "..";
}

function writeCollectionMetaFiles(input) {
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

function writeCollectionIndexPages(input) {
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

function buildEntriesByScope(entries) {
	const byScope = new Map();
	for (const entry of entries) {
		const key = `${entry.corpus}/${entry.collection}`;
		byScope.set(key, [...(byScope.get(key) ?? []), entry]);
	}
	return byScope;
}

function buildRootMeta() {
	return [{ type: "dir", name: "docs", label: "文档", collapsed: false }];
}

function buildDocsMeta(byScope) {
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

function buildCorpusMeta(corpus, byScope) {
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

function buildCollectionMeta(entries) {
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

function buildHomePage() {
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

function buildDocsIndexPage(byScope) {
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

function buildCorpusIndexPage(corpus, byScope) {
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

function buildCollectionIndexPage(input) {
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

function assertUniqueCurrentPublicReaderDisplayTitles(entries) {
	const seen = new Map();
	for (const entry of entries) {
		const title = resolveDocumentDisplayTitle(entry.title);
		const key = `${entry.corpus}/${entry.collection}/${title}`;
		const existing = seen.get(key);
		if (existing) {
			throw new Error(
				`duplicate current public reader display title: ${key} (${existing}, ${entry.documentSlug})`,
			);
		}
		seen.set(key, entry.documentSlug);
	}
}

async function writeProtectedSearchIndexes(input) {
	const routeEntries = attachReaderRouteSlugs(input.entries);
	const searchUnitsByVersionId = buildSearchUnitsByVersionId(input.manifest.searchUnits);
	await assertProtectedSearchUnitsReferenceReader({
		client: input.client,
		entries: routeEntries,
		searchUnitsByVersionId,
	});
	for (const entry of routeEntries) {
		if (entry.deliveryMode !== "gated_asset" || !entry.isCurrent) {
			continue;
		}
		if (!entry.versionId) {
			throw new Error(`protected search index requires versionId: ${entry.documentSlug}`);
		}
		const searchUnits = searchUnitsByVersionId.get(entry.versionId);
		if (!searchUnits) {
			throw new Error(`missing protected search units for version: ${entry.versionId}`);
		}
		const targetPath = resolve(
			input.targetRoot,
			"_gated-docs-search",
			entry.corpus,
			entry.collection,
			entry.documentSlug,
			entry.versionSlug,
			"index.json",
		);
		writeText(
			targetPath,
			formatJson({
				entries: searchUnits.map((unit) =>
					buildProtectedSearchEntry({ entry, resolveCollectionLabel, unit }),
				),
				generatedAt: input.manifest.generatedAt ?? null,
				schemaVersion: "campus_docs_protected_search_index_v1",
				visibilityMode: "principal_protected_static",
			}),
		);
	}
}

function compareEntryRoute(left, right) {
	return `${left.corpus}/${left.collection}/${left.documentSlug}/${left.versionSlug}`.localeCompare(
		`${right.corpus}/${right.collection}/${right.documentSlug}/${right.versionSlug}`,
	);
}

function comparePublicVersion(left, right) {
	if (left.isCurrent !== right.isCurrent) {
		return left.isCurrent ? -1 : 1;
	}
	return left.versionSlug.localeCompare(right.versionSlug);
}

function sortedCorpora(byScope) {
	return [...new Set([...byScope.keys()].map((scope) => scope.split("/", 1)[0]))].sort(
		compareCorpus,
	);
}

function sortedCollections(corpus, byScope) {
	return [...byScope.keys()]
		.filter((scope) => scope.startsWith(`${corpus}/`))
		.map((scope) => scope.split("/")[1])
		.filter(Boolean)
		.sort(compareCollection);
}

function compareCorpus(left, right) {
	return compareOrdered(left, right, CORPUS_ORDER);
}

function compareCollection(left, right) {
	return compareOrdered(left, right, COLLECTION_ORDER);
}

function compareOrdered(left, right, order) {
	const leftIndex = order.indexOf(left);
	const rightIndex = order.indexOf(right);
	if (leftIndex !== rightIndex) {
		return normalizeOrderIndex(leftIndex) - normalizeOrderIndex(rightIndex);
	}
	return left.localeCompare(right);
}

function normalizeOrderIndex(index) {
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

async function main() {
	const options = parsePublishedReaderSyncArgs(process.argv.slice(2));
	const client = createS3ObjectStore();
	if (options.command === "all" || options.command === "docs") {
		console.log(
			JSON.stringify(
				await syncCampusPublishedReaderDocs({
					client,
					manifestFilePath: options.manifestFilePath,
					manifestObjectKey: options.manifestObjectKey,
				}),
			),
		);
	}
	if (options.command === "all" || options.command === "assets") {
		console.log(
			JSON.stringify(
				await syncCampusPublishedReaderAssets({
					client,
					manifestFilePath: options.manifestFilePath,
					manifestObjectKey: options.manifestObjectKey,
				}),
			),
		);
	}
	if (options.command === "check") {
		console.log(
			JSON.stringify(
				await checkCampusPublishedReaderInputs({
					client,
					manifestFilePath: options.manifestFilePath,
					manifestObjectKey: options.manifestObjectKey,
				}),
			),
		);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
