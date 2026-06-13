import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createS3ObjectStore } from "./published-reader-object-store.mjs";
import {
	escapeAttribute,
	escapeHtml,
	escapeMarkdownLinkText,
	formatJson,
	writeText,
} from "./published-reader-text.mjs";

export { resolvePublishedReaderObjectStoreBucket } from "./published-reader-object-store.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DOCS_ROOT = resolve(APP_ROOT, ".generated/docs");
const DEFAULT_PUBLIC_ROOT = resolve(APP_ROOT, "public");
const CORE_SOURCE_LABELS = {
	"asset-manifest": "manifest",
	meta: "meta",
	outline: "outline",
	reader: "reader",
};
const CORPUS_ORDER = ["regulations", "curriculum"];
const COLLECTION_ORDER = [
	"student_rules",
	"institutional_rules",
	"scoped_rules",
	"curriculum_plan",
];

export async function syncCampusPublishedReaderDocs(input) {
	const docsRoot = resolve(
		input.docsRoot ?? process.env.CAMPUS_WEB_RSPRESS_DOCS_ROOT?.trim() ?? DEFAULT_DOCS_ROOT,
	);
	const manifest = await loadManifest(input);
	const readerEntries = manifest.entries
		.filter(
			(entry) =>
				entry.deliveryMode === "public_static_asset" || entry.deliveryMode === "gated_asset",
		)
		.sort(compareEntryRoute);
	const publicEntries = readerEntries.filter(
		(entry) => entry.deliveryMode === "public_static_asset",
	);
	const currentPublicEntries = publicEntries.filter((entry) => entry.isCurrent);
	const publicVersionsByDocument = buildPublicVersionsByDocument(publicEntries);
	rmSync(resolve(docsRoot, "docs"), { force: true, recursive: true });
	writeText(resolve(docsRoot, "_meta.json"), formatJson(buildRootMeta()));
	writeText(resolve(docsRoot, "index.md"), buildHomePage(currentPublicEntries));
	writeBootstrapPages(docsRoot);
	writeCollectionMetaFiles({ docsRoot, entries: currentPublicEntries });
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
	const manifest = await loadManifest(input);
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
			const sourceObject = resolveSourceObjectKey(entry, targetLabel);
			const target = resolveSafeReaderAssetTarget({
				targetObject: resolveTargetObjectByDeliveryMode(entry.deliveryMode, targetObject),
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
		validateAssetManifest(entry, copies);
		for (const copy of copies) {
			mkdirSync(dirname(copy.targetPath), { recursive: true });
			writeFileSync(copy.targetPath, copy.bytes);
			copiedAssetCount += 1;
		}
	}
	writeProtectedSearchIndexes({ entries, manifest, targetRoot });
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
	const mdx = buildReaderMdx({
		entry: input.entry,
		meta,
		reader,
		searchable: false,
		versions: input.publicVersionsByDocument.get(resolveDocumentVersionKey(input.entry)) ?? [],
	});
	const versionPath = resolve(
		input.docsRoot,
		"docs",
		input.entry.corpus,
		input.entry.collection,
		input.entry.documentSlug,
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
				`${input.entry.documentSlug}.mdx`,
			),
			buildReaderMdx({
				entry: input.entry,
				meta,
				reader,
				searchable: true,
				versions: input.publicVersionsByDocument.get(resolveDocumentVersionKey(input.entry)) ?? [],
			}),
		);
	}
}

function writeGatedReaderPage(input) {
	const versionPath = resolve(
		input.docsRoot,
		"docs",
		input.entry.corpus,
		input.entry.collection,
		input.entry.documentSlug,
		"v",
		`${input.entry.versionSlug}.mdx`,
	);
	const currentPath = resolve(
		input.docsRoot,
		"docs",
		input.entry.corpus,
		input.entry.collection,
		`${input.entry.documentSlug}.mdx`,
	);
	const versionMdx = buildGatedReaderMdx({
		entry: input.entry,
		importPath: "@/components/docs/gated-reader-bootstrap",
	});
	writeText(versionPath, versionMdx);
	if (input.entry.isCurrent) {
		writeText(currentPath, versionMdx);
	}
}

function buildGatedReaderMdx(input) {
	return [
		"---",
		`title: ${JSON.stringify(input.entry.title)}`,
		"footer: false",
		'docsSearchVisibility: "gated_bootstrap"',
		`documentKind: ${JSON.stringify(resolveDocumentKind(input.entry))}`,
		'readerLayout: "reference"',
		'readerMeasure: "standard"',
		'readerOutline: "document"',
		"---",
		"",
		`import GatedReaderBootstrap from "${input.importPath}";`,
		"",
		"<GatedReaderBootstrap />",
		"",
	].join("\n");
}

async function loadManifest(input) {
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
function writeBootstrapPages(docsRoot) {
	writeText(
		resolve(docsRoot, "reader-bootstrap.mdx"),
		[
			"---",
			'title: "文档阅读"',
			"footer: false",
			'docsSearchVisibility: "noindex"',
			'readerLayout: "reference"',
			'readerMeasure: "standard"',
			"---",
			"",
			'import GatedReaderBootstrap from "@/components/docs/gated-reader-bootstrap";',
			"",
			"<GatedReaderBootstrap />",
			"",
		].join("\n"),
	);
	writeText(
		resolve(docsRoot, "collection-bootstrap.mdx"),
		[
			"---",
			'title: "文档目录"',
			"footer: false",
			'docsSearchVisibility: "noindex"',
			'readerLayout: "reference"',
			'readerMeasure: "standard"',
			"outline: false",
			"---",
			"",
			'import GatedCollectionBootstrap from "@/components/docs/gated-collection-bootstrap";',
			"",
			"<GatedCollectionBootstrap />",
			"",
		].join("\n"),
	);
}

function buildReaderMdx(input) {
	const title = input.reader.document?.title || input.entry.title;
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
			lines.push(`<span id="${escapeHtml(anchor)}"></span>`, "");
		}
		const sectionTitle = normalizeText(section.title);
		if (sectionTitle && sectionTitle !== title) {
			lines.push(`## ${sectionTitle}`, "");
		}
		for (const block of section.blocks ?? []) {
			const text = normalizeText(block.text);
			if (!text) {
				continue;
			}
			const rootUnitId = String(block.rootUnitId ?? "").trim();
			lines.push(
				`<div className="reader-block" data-root-unit-id="${escapeHtml(rootUnitId)}">`,
				"",
				renderReaderBlockText(text),
				"",
				"</div>",
				"",
			);
		}
	}
	return `${lines.join("\n").trimEnd()}\n`;
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
		`<section className="document-meta-panel" aria-label="文档来源与版本" data-docs-reader-meta="true" data-docs-corpus="${escapeHtml(input.entry.corpus)}" data-docs-collection="${escapeHtml(input.entry.collection)}" data-docs-document-slug="${escapeHtml(input.entry.documentSlug)}" data-docs-version-slug="${escapeHtml(input.entry.versionSlug)}" data-docs-is-current="${input.entry.isCurrent ? "true" : "false"}" data-docs-versions="${escapeAttribute(versionPayload)}">`,
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

function writeCollectionMetaFiles(input) {
	const docsDir = resolve(input.docsRoot, "docs");
	const byScope = new Map();
	for (const entry of input.entries) {
		const key = `${entry.corpus}/${entry.collection}`;
		byScope.set(key, [...(byScope.get(key) ?? []), entry]);
	}
	writeText(resolve(docsDir, "index.md"), buildDocsIndex(input.entries));
	writeText(resolve(docsDir, "_meta.json"), formatJson(buildDocsMeta(byScope)));
	for (const corpus of sortedCorpora(byScope)) {
		const corpusEntries = input.entries.filter((entry) => entry.corpus === corpus);
		const corpusDir = resolve(docsDir, corpus);
		writeText(resolve(corpusDir, "index.md"), buildCorpusIndex(corpus, corpusEntries));
		writeText(resolve(corpusDir, "_meta.json"), formatJson(buildCorpusMeta(corpus, byScope)));
	}
	for (const [scope, entries] of byScope) {
		const [corpus, collection] = scope.split("/");
		const collectionDir = resolve(docsDir, corpus, collection);
		writeText(
			resolve(collectionDir, "index.md"),
			buildCollectionIndex(corpus, collection, entries),
		);
		writeText(resolve(collectionDir, "_meta.json"), formatJson(buildCollectionMeta(entries)));
	}
}

function buildRootMeta() {
	return [
		{ type: "file", name: "index", label: "文档" },
		{ type: "dir", name: "docs", label: "文档库", collapsed: false },
	];
}

function buildDocsMeta(byScope) {
	return [
		{ type: "file", name: "index", label: "全部文档" },
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
		{ type: "file", name: "index", label: resolveCorpusLabel(corpus) },
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
		{ type: "file", name: "index", label: "目录" },
		...entries.map((entry) => ({
			type: "file",
			name: entry.documentSlug,
			label: resolveDocumentDisplayTitle(entry.title),
		})),
	];
}

function buildHomePage(entries) {
	return [
		"---",
		'title: "文档"',
		"footer: false",
		"outline: false",
		"---",
		"",
		"# 文档",
		"",
		entries.length > 0 ? `当前发布 ${entries.length} 篇文档。` : "请选择文档目录继续阅读。",
		"",
	].join("\n");
}

function buildDocsIndex(entries) {
	return [
		"---",
		'title: "文档库"',
		"footer: false",
		"outline: false",
		"---",
		"",
		"# 文档库",
		"",
		entries.length > 0 ? `当前发布 ${entries.length} 篇文档。` : "暂无已发布文档。",
		"",
	].join("\n");
}

function buildCorpusIndex(corpus, entries) {
	const label = resolveCorpusLabel(corpus);
	return [
		"---",
		`title: ${JSON.stringify(label)}`,
		"footer: false",
		"outline: false",
		"---",
		"",
		`# ${label}`,
		"",
		`当前发布 ${entries.length} 篇文档。`,
		"",
	].join("\n");
}

function buildCollectionIndex(corpus, collection, entries) {
	const label = resolveCollectionLabel({ collection, corpus });
	return [
		"---",
		`title: ${JSON.stringify(label)}`,
		"footer: false",
		'docsSearchVisibility: "noindex"',
		"outline: false",
		"---",
		"",
		`# ${label}`,
		"",
		...entries.map(
			(entry) =>
				`- [${escapeMarkdownLinkText(resolveDocumentDisplayTitle(entry.title))}](./${entry.documentSlug})`,
		),
		"",
	].join("\n");
}

function resolveDocumentDisplayTitle(title) {
	const trimmed = requireString(title, "title");
	const displayTitle = trimmed.replace(/^中央民族大学/u, "").trim();
	return displayTitle || trimmed;
}

function writeProtectedSearchIndexes(input) {
	const searchUnitsByVersionId = buildSearchUnitsByVersionId(input.manifest.searchUnits);
	for (const entry of input.entries) {
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
				entries: searchUnits.map((unit) => buildProtectedSearchEntry({ entry, unit })),
				generatedAt: input.manifest.generatedAt ?? null,
				schemaVersion: "campus_docs_protected_search_index_v1",
				visibilityMode: "principal_protected_static",
			}),
		);
	}
}

function buildSearchUnitsByVersionId(searchUnits) {
	const byVersionId = new Map();
	for (const rawUnit of searchUnits) {
		const unit = normalizeSearchUnit(rawUnit);
		byVersionId.set(unit.versionId, [...(byVersionId.get(unit.versionId) ?? []), unit]);
	}
	for (const [versionId, units] of byVersionId) {
		byVersionId.set(versionId, units.sort(compareSearchUnit));
	}
	return byVersionId;
}

function normalizeSearchUnit(value) {
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

function buildProtectedSearchEntry(input) {
	assertSearchUnitMatchesEntry({ entry: input.entry, unit: input.unit });
	const sectionTitle = input.unit.title;
	const canonicalUrl = normalizeReaderCanonicalUrl(input.unit.canonicalUrl);
	return {
		anchor: input.unit.anchor,
		canonicalUrl,
		collection: input.entry.collection,
		collectionLabel: resolveCollectionLabel(input.entry),
		corpus: input.entry.corpus,
		documentSlug: input.entry.documentSlug,
		documentTitle: input.unit.documentTitle,
		highlightRootUnitIds: input.unit.highlightRootUnitIds,
		searchText: [input.unit.documentTitle, sectionTitle, input.unit.snippet].join(" "),
		searchUnitId: input.unit.searchUnitId,
		sectionTitle,
		snippet: input.unit.snippet,
		versionSlug: input.entry.versionSlug,
	};
}

function assertSearchUnitMatchesEntry(input) {
	const pairs = [
		["corpus", input.unit.corpus, input.entry.corpus],
		["collection", input.unit.collection, input.entry.collection],
		["documentSlug", input.unit.documentSlug, input.entry.documentSlug],
		["versionSlug", input.unit.versionSlug, input.entry.versionSlug],
	];
	for (const [label, actual, expected] of pairs) {
		if (actual !== expected) {
			throw new Error(`protected search unit ${label} does not match release entry`);
		}
	}
}

function normalizeReaderCanonicalUrl(value) {
	const raw = value.trim();
	let pathname = raw;
	try {
		const url = new URL(raw, "https://campus.muc.wiki");
		pathname = url.pathname;
	} catch {
		pathname = raw.split(/[?#]/u, 1)[0] ?? raw;
	}
	const withoutTrailingSlash = pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
	return withoutTrailingSlash || "/";
}

function compareSearchUnit(left, right) {
	return (
		left.documentSlug.localeCompare(right.documentSlug) ||
		left.versionSlug.localeCompare(right.versionSlug) ||
		left.anchor.localeCompare(right.anchor) ||
		left.searchUnitId.localeCompare(right.searchUnitId)
	);
}

function resolveSourceObjectKey(entry, targetLabel) {
	const sourceLabel = CORE_SOURCE_LABELS[targetLabel] ?? `supplement.${targetLabel}`;
	const sourceObject = entry.sourceObjects[sourceLabel] ?? entry.sourceObjects[targetLabel];
	if (!sourceObject?.trim()) {
		throw new Error(`missing reader asset source label for target: ${targetLabel}`);
	}
	return sourceObject;
}

function resolveTargetObjectByDeliveryMode(deliveryMode, targetObject) {
	const normalized = targetObject.trim().replaceAll("\\", "/");
	if (deliveryMode === "public_static_asset") {
		if (!normalized.startsWith("_docs/")) {
			throw new Error("public reader asset target must stay under _docs/");
		}
		return normalized;
	}
	if (deliveryMode === "gated_asset") {
		if (normalized.startsWith("_gated-docs/")) {
			return normalized;
		}
		if (normalized.startsWith("_docs/")) {
			return normalized.replace(/^_docs\//u, "_gated-docs/");
		}
		throw new Error("gated reader asset target must stay under _gated-docs/");
	}
	throw new Error(`unsupported reader delivery mode: ${deliveryMode}`);
}

function resolveSafeReaderAssetTarget(input) {
	const normalized = input.targetObject.trim().replaceAll("\\", "/");
	if (
		!(normalized.startsWith("_docs/") || normalized.startsWith("_gated-docs/")) ||
		isAbsolute(normalized) ||
		normalized.split("/").includes("..")
	) {
		throw new Error("reader asset target must stay under _docs/ or _gated-docs/");
	}
	const targetPath = resolve(input.targetRoot, normalized);
	const targetPrefix = `${resolve(input.targetRoot)}${sep}`;
	if (!targetPath.startsWith(targetPrefix)) {
		throw new Error("reader asset target must stay under _docs/ or _gated-docs/");
	}
	return {
		filePath: resolveReaderAssetFilePath(normalized),
		targetObject: normalized,
		targetPath,
	};
}

function resolveReaderAssetFilePath(targetObject) {
	const parts = targetObject.split("/");
	if (parts.length < 6) {
		throw new Error("reader asset target must include document version and file path");
	}
	const filePath = parts.slice(5).join("/");
	if (!filePath || filePath.split("/").includes("..")) {
		throw new Error("reader asset target must include a safe file path");
	}
	return filePath;
}

function validateAssetManifest(entry, copies) {
	const manifestCopy = copies.find((copy) => copy.filePath === "asset-manifest.json");
	if (!manifestCopy) {
		throw new Error(`reader asset entry is missing asset-manifest.json: ${entry.docId ?? ""}`);
	}
	const manifest = JSON.parse(new TextDecoder().decode(manifestCopy.bytes));
	if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
		throw new Error("asset-manifest.json must contain files");
	}
	for (const copy of copies) {
		if (copy.filePath === "asset-manifest.json") {
			continue;
		}
		const expected = manifest.files[copy.filePath];
		if (!expected) {
			throw new Error(`asset-manifest.json is missing file entry: ${copy.filePath}`);
		}
		const actualSha256 = createHash("sha256").update(copy.bytes).digest("hex");
		if (expected.sizeBytes !== copy.bytes.byteLength || expected.sha256 !== actualSha256) {
			throw new Error(`reader asset failed manifest integrity check: ${copy.filePath}`);
		}
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

function resolveDocumentKind(entry) {
	if (entry.collection === "curriculum_plan") {
		return "curriculumPlan";
	}
	if (entry.collection === "student_rules") {
		return "studentHandbookArticle";
	}
	return "publicRegulation";
}

function resolveReaderLayout(entry) {
	return entry.collection === "curriculum_plan" ? "tabular" : "article";
}

function resolveReaderMeasure(entry) {
	return entry.collection === "curriculum_plan" ? "wide" : "standard";
}

function resolveCorpusLabel(corpus) {
	return corpus === "curriculum" ? "培养方案" : corpus === "regulations" ? "规章制度" : corpus;
}

function resolveCollectionLabel(entry) {
	if (entry.collection === "curriculum_plan") {
		return "培养方案";
	}
	if (entry.collection === "student_rules") {
		return "学生手册";
	}
	if (entry.collection === "institutional_rules") {
		return "校级规章";
	}
	if (entry.collection === "scoped_rules") {
		return "专项规章";
	}
	return entry.collection;
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

function normalizeText(value) {
	return String(value ?? "").trim();
}

function renderReaderBlockText(text) {
	const tableHtml = normalizeSafeTableHtml(text);
	if (!tableHtml) {
		return escapeHtml(text);
	}
	return `<div className="docs-table-scroll" data-docs-scrollable="true">\n${tableHtml}\n</div>`;
}

function normalizeSafeTableHtml(value) {
	const text = normalizeText(value);
	if (!/^<table(?:\s[^>]*)?>[\s\S]*<\/table>$/iu.test(text)) {
		return;
	}
	if (text.replace(/<\/?[a-z][^>]*>/giu, "").includes("<")) {
		return;
	}

	const allowedTags = new Set(["table", "thead", "tbody", "tr", "th", "td"]);
	const tagPattern = /<\/?([a-z][a-z0-9-]*)([^>]*)>/giu;
	let normalized = "";
	let cursor = 0;
	let sawTable = false;
	for (const match of text.matchAll(tagPattern)) {
		const [rawTag, rawTagName, rawAttributes = ""] = match;
		const index = match.index ?? 0;
		const tagName = rawTagName.toLowerCase();
		if (!allowedTags.has(tagName)) {
			return;
		}
		normalized += renderJsxTextNode(text.slice(cursor, index));
		cursor = index + rawTag.length;
		if (rawTag.startsWith("</")) {
			normalized += `</${tagName}>`;
			continue;
		}
		if (tagName === "table") {
			if (sawTable) {
				return;
			}
			sawTable = true;
		}
		const attributes = normalizeSafeTableAttributes(rawAttributes);
		if (attributes === undefined) {
			return;
		}
		normalized += `<${tagName}${attributes}>`;
	}
	normalized += renderJsxTextNode(text.slice(cursor));
	return sawTable ? normalized : undefined;
}

function renderJsxTextNode(value) {
	if (!value) {
		return "";
	}
	return `{${JSON.stringify(value)}}`;
}

function normalizeSafeTableAttributes(rawAttributes) {
	const source = rawAttributes.trim();
	if (!source) {
		return "";
	}
	const attributes = [];
	let unsupported = false;
	const consumed = source.replace(
		/([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu,
		(_match, rawName, doubleQuoted, singleQuoted, unquoted) => {
			const name = String(rawName).toLowerCase();
			const value = String(doubleQuoted ?? singleQuoted ?? unquoted ?? "");
			if (name === "rowspan" || name === "colspan") {
				if (!/^[1-9][0-9]{0,2}$/u.test(value)) {
					throw new Error("unsafe table span attribute");
				}
				attributes.push(
					`${name === "rowspan" ? "rowSpan" : "colSpan"}="${escapeAttribute(value)}"`,
				);
				return "";
			}
			unsupported = true;
			return "";
		},
	);
	if (unsupported || consumed.trim()) {
		return;
	}
	return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
}

async function main() {
	const command = process.argv[2];
	const client = createS3ObjectStore();
	const manifestFilePath = process.env.CAMPUS_DOCS_SYNC_MANIFEST_PATH?.trim();
	const manifestObjectKey = process.env.CAMPUS_DOCS_SYNC_MANIFEST_KEY?.trim();
	if (command === "docs") {
		console.log(
			JSON.stringify(
				await syncCampusPublishedReaderDocs({ client, manifestFilePath, manifestObjectKey }),
			),
		);
		return;
	}
	if (command === "assets") {
		console.log(
			JSON.stringify(
				await syncCampusPublishedReaderAssets({ client, manifestFilePath, manifestObjectKey }),
			),
		);
		return;
	}
	throw new Error("usage: node scripts/sync-campus-published-reader.mjs docs|assets");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
