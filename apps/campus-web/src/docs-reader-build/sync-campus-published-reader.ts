import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolvePublishedReaderSourceObjectKey,
	resolvePublishedReaderTargetObjectByDeliveryMode,
	resolveSafePublishedReaderAssetTarget,
	validatePublishedReaderAssetManifest,
} from "./published-reader-assets.ts";
import { renderReaderBlockText } from "./published-reader-blocks.ts";
import { writeBootstrapPages, writeGatedReaderPage } from "./published-reader-bootstrap-pages.ts";
import {
	buildCourseMapsByHeading,
	countUnrenderedCourseMaps,
	loadReaderCourseMapSupplements,
	renderCourseMapFigure,
} from "./published-reader-course-maps.ts";
import {
	resolveCollectionLabel,
	resolveDocumentDisplayTitle,
	resolveDocumentKind,
	resolveReaderLayout,
	resolveReaderMeasure,
} from "./published-reader-labels.ts";
import { loadPublishedReaderManifest } from "./published-reader-manifest.ts";
import {
	buildEntriesByScope,
	buildHomePage,
	buildRootMeta,
	writeCollectionIndexPages,
	writeCollectionMetaFiles,
} from "./published-reader-navigation.ts";
import { createS3ObjectStore } from "./published-reader-object-store.ts";
import {
	assertProtectedSearchUnitsReferenceReader,
	buildProtectedSearchEntry,
	buildSearchUnitsByVersionId,
} from "./published-reader-search-validation.ts";
import { parsePublishedReaderSyncArgs } from "./published-reader-sync-args.ts";
import {
	escapeAttribute,
	escapeHtml,
	formatJson,
	normalizeText,
	writeText,
} from "./published-reader-text.ts";
import type {
	CourseMapBlock,
	PublishedReaderManifest,
	PublishedReaderManifestEntry,
	ReaderAssetCopy,
	ReaderBlock,
	ReaderDocumentPayload,
	ReaderMetaPayload,
	ReaderObjectStoreClient,
	ReaderPublicVersion,
	ReaderSyncAssetsResult,
	ReaderSyncCheckResult,
	ReaderSyncDocsResult,
	ReaderSyncInput,
	RoutedPublishedReaderManifestEntry,
} from "./published-reader-types.ts";

export {
	resolvePublishedReaderObjectStoreBucket,
	resolvePublishedReaderObjectStoreConfig,
	resolvePublishedReaderObjectStoreCredentials,
} from "./published-reader-object-store.ts";
export { parsePublishedReaderSyncArgs } from "./published-reader-sync-args.ts";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_DOCS_ROOT = resolve(APP_ROOT, ".generated/docs");
const DEFAULT_PUBLIC_ROOT = resolve(APP_ROOT, "public");
const SYNTHETIC_READER_SECTION_TITLES = new Set(["文档正文", "正文内容"]);

export async function syncCampusPublishedReaderDocs(
	input: ReaderSyncInput,
): Promise<ReaderSyncDocsResult> {
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

export async function syncCampusPublishedReaderAssets(
	input: ReaderSyncInput,
): Promise<ReaderSyncAssetsResult> {
	const manifest = await loadPublishedReaderManifest(input);
	const entries = manifest.entries.filter(
		(entry) => entry.deliveryMode === "public_static_asset" || entry.deliveryMode === "gated_asset",
	);
	const targetRoot = resolve(input.targetRoot ?? DEFAULT_PUBLIC_ROOT);
	const seenTargets = new Set<string>();
	let copiedAssetCount = 0;
	rmSync(resolve(targetRoot, "_docs"), { force: true, recursive: true });
	rmSync(resolve(targetRoot, "_gated-docs"), { force: true, recursive: true });
	rmSync(resolve(targetRoot, "_gated-docs-search"), { force: true, recursive: true });
	for (const entry of entries) {
		const copies: ReaderAssetCopy[] = [];
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

export async function checkCampusPublishedReaderInputs(
	input: ReaderSyncInput,
): Promise<ReaderSyncCheckResult> {
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
		const copies: ReaderAssetCopy[] = [];
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
		const searchUnits = entry.versionId ? searchUnitsByVersionId.get(entry.versionId) : undefined;
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

async function writeReaderPage(input: {
	client: ReaderObjectStoreClient;
	docsRoot: string;
	entry: RoutedPublishedReaderManifestEntry;
	publicVersionsByDocument: Map<string, ReaderPublicVersion[]>;
}): Promise<void> {
	if (input.entry.deliveryMode === "gated_asset") {
		writeGatedReaderPage(input);
		return;
	}
	const reader = JSON.parse(
		await input.client.readTextObject({ key: input.entry.sourceObjects.reader }),
	) as ReaderDocumentPayload;
	const meta = input.entry.sourceObjects.meta
		? JSON.parse(await input.client.readTextObject({ key: input.entry.sourceObjects.meta }))
		: ({} as ReaderMetaPayload);
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

function buildReaderMdx(input: {
	courseMaps?: CourseMapBlock[];
	entry: RoutedPublishedReaderManifestEntry;
	meta: ReaderMetaPayload;
	reader: ReaderDocumentPayload;
	searchable: boolean;
	versions: ReaderPublicVersion[];
}): string {
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
		const blocks = Array.isArray(section.blocks) ? section.blocks : [];
		for (const block of blocks) {
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

function isReaderHeadingBlock(block: ReaderBlock, text: string): boolean {
	const kind = String(block?.kind ?? "").trim();
	if (kind) {
		return kind === "heading";
	}
	return text.length <= 32 && isReaderHeadingText(text);
}

function isReaderHeadingText(text: string): boolean {
	return /^(第[一二三四五六七八九十百]+章\b|[一二三四五六七八九十]+、\S|（[一二三四五六七八九十]+）\S|\([一二三四五六七八九十]+\)\S|[1-9][0-9]{0,1}\.\S)/u.test(
		text,
	);
}

function resolveReaderHeadingLevel(text: string): number {
	if (/^(第[一二三四五六七八九十百]+章\b|[一二三四五六七八九十]+、\S)/u.test(text)) {
		return 2;
	}
	return 3;
}

function shouldRenderReaderSectionTitle(input: { sectionTitle: string; title: string }): boolean {
	const normalizedTitle = normalizeText(input.title);
	const normalizedDisplayTitle = resolveDocumentDisplayTitle(normalizedTitle);
	return Boolean(
		input.sectionTitle &&
			input.sectionTitle !== normalizedTitle &&
			input.sectionTitle !== normalizedDisplayTitle &&
			!SYNTHETIC_READER_SECTION_TITLES.has(input.sectionTitle),
	);
}

function buildMetaPanel(input: {
	entry: RoutedPublishedReaderManifestEntry;
	meta: ReaderMetaPayload;
	versions: ReaderPublicVersion[];
}): string {
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

function buildPublicVersionsByDocument(
	entries: RoutedPublishedReaderManifestEntry[],
): Map<string, ReaderPublicVersion[]> {
	const versionsByDocument = new Map<string, ReaderPublicVersion[]>();
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

function resolveDocumentVersionKey(entry: PublishedReaderManifestEntry): string {
	return `${entry.corpus}/${entry.collection}/${entry.documentSlug}`;
}

function attachReaderRouteSlugs(
	entries: PublishedReaderManifestEntry[],
): RoutedPublishedReaderManifestEntry[] {
	const routeSlugByDocument = new Map<string, string>();
	const documentByRouteSlug = new Map<string, string>();
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

function buildDocumentRouteSlug(entry: PublishedReaderManifestEntry): string {
	if (isSafeReaderRouteSlug(entry.documentSlug)) {
		return entry.documentSlug;
	}
	const digest = createHash("sha256")
		.update(resolveDocumentVersionKey(entry))
		.digest("hex")
		.slice(0, 12);
	return `doc-${digest}`;
}

function isSafeReaderRouteSlug(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(value) && value !== "." && value !== "..";
}

function assertUniqueCurrentPublicReaderDisplayTitles(
	entries: RoutedPublishedReaderManifestEntry[],
): void {
	const seen = new Map<string, string>();
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

async function writeProtectedSearchIndexes(input: {
	client: ReaderObjectStoreClient;
	entries: PublishedReaderManifestEntry[];
	manifest: PublishedReaderManifest;
	targetRoot: string;
}): Promise<void> {
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

function compareEntryRoute(
	left: RoutedPublishedReaderManifestEntry,
	right: RoutedPublishedReaderManifestEntry,
): number {
	return `${left.corpus}/${left.collection}/${left.documentSlug}/${left.versionSlug}`.localeCompare(
		`${right.corpus}/${right.collection}/${right.documentSlug}/${right.versionSlug}`,
	);
}

function comparePublicVersion(left: ReaderPublicVersion, right: ReaderPublicVersion): number {
	if (left.isCurrent !== right.isCurrent) {
		return left.isCurrent ? -1 : 1;
	}
	return left.versionSlug.localeCompare(right.versionSlug);
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
