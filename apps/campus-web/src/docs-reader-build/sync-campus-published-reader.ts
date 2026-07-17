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
	escapeMdxHeadingText,
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
	const manifest = input.manifest ?? (await loadPublishedReaderManifest(input));
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
	const manifest = input.manifest ?? (await loadPublishedReaderManifest(input));
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
	const manifest = input.manifest ?? (await loadPublishedReaderManifest(input));
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
	const description = buildReaderDescription(title, input.reader);
	const canonicalUrl = buildReaderCanonicalUrl(input.entry);
	const readerPermalinks = buildReaderPermalinkMap(input.reader, title);
	const lines = [
		"---",
		`title: ${JSON.stringify(title)}`,
		`description: ${JSON.stringify(description)}`,
		`head: ${JSON.stringify([["link", { href: canonicalUrl, rel: "canonical" }]])}`,
		"footer: false",
		`docsSearchVisibility: ${JSON.stringify(input.searchable ? "public_current" : "noindex")}`,
		`documentKind: ${JSON.stringify(resolveDocumentKind(input.entry))}`,
		`readerLayout: ${JSON.stringify(resolveReaderLayout(input.entry))}`,
		`readerMeasure: ${JSON.stringify(resolveReaderMeasure(input.entry))}`,
		`readerPermalinks: ${JSON.stringify(readerPermalinks)}`,
		'readerOutline: "document"',
		"---",
		"",
		buildMetaPanel({ entry: input.entry, meta: input.meta, versions: input.versions }),
		"",
	];
	for (const section of input.reader.sections ?? []) {
		const anchor = String(section.anchor ?? "").trim();
		const sectionTitle = normalizeText(section.title);
		const renderSectionTitle = shouldRenderReaderSectionTitle({ sectionTitle, title });
		if (anchor && !(renderSectionTitle && isSafeReaderAnchor(anchor))) {
			lines.push(`<ReaderAnchor id={${JSON.stringify(anchor)}} />`, "");
		}
		if (renderSectionTitle) {
			const safeSectionTitle = escapeMdxHeadingText(sectionTitle);
			lines.push(
				anchor && isSafeReaderAnchor(anchor)
					? `## ${safeSectionTitle} {#${anchor}}`
					: `## ${safeSectionTitle}`,
				"",
			);
		}
		const blocks = Array.isArray(section.blocks) ? section.blocks : [];
		for (const block of blocks) {
			const text = normalizeText(block.text);
			if (!text) {
				continue;
			}
			if (isReaderHeadingBlock(block, text)) {
				const headingLevel = resolveReaderHeadingLevel(text);
				lines.push(`${"#".repeat(headingLevel)} ${escapeMdxHeadingText(text)}`, "");
				for (const courseMap of courseMapsByHeading.get(text) ?? []) {
					lines.push(renderCourseMapFigure(courseMap), "");
				}
				courseMapsByHeading.delete(text);
				continue;
			}
			const rootUnitId = String(block.rootUnitId ?? "").trim();
			lines.push(
				`<ReaderBlock rootUnitId={${JSON.stringify(rootUnitId)}}>`,
				"",
				renderReaderBlockText(text),
				"",
				"</ReaderBlock>",
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
	const versionLabel = input.entry.versionLabel;
	const collectionLabel = resolveCollectionLabel(input.entry);
	const sourceLabel = input.meta.source?.title || input.meta.sourceLabel || collectionLabel;
	const versions = input.versions.map((version) => ({
		isCurrent: version.isCurrent,
		label: version.label,
		versionSlug: version.versionSlug,
	}));
	return [
		"<ReaderDocumentMeta",
		`\tcollection={${JSON.stringify(input.entry.collection)}}`,
		`\tcollectionLabel={${JSON.stringify(collectionLabel)}}`,
		`\tcorpus={${JSON.stringify(input.entry.corpus)}}`,
		`\tdocumentSlug={${JSON.stringify(input.entry.documentSlug)}}`,
		`\tisCurrent={${JSON.stringify(input.entry.isCurrent)}}`,
		`\trouteSlug={${JSON.stringify(input.entry.routeSlug)}}`,
		`\tsearchVisibility={${JSON.stringify(input.entry.isCurrent ? "public_current" : "noindex")}}`,
		`\tsourceLabel={${JSON.stringify(sourceLabel)}}`,
		`\tversionLabel={${JSON.stringify(versionLabel)}}`,
		`\tversionSlug={${JSON.stringify(input.entry.versionSlug)}}`,
		`\tversions={${JSON.stringify(versions)}}`,
		"/>",
	].join("\n");
}

function buildReaderDescription(title: string, reader: ReaderDocumentPayload): string {
	for (const section of reader.sections ?? []) {
		const blocks = Array.isArray(section.blocks) ? (section.blocks as ReaderBlock[]) : [];
		for (const block of blocks) {
			const text = normalizeText(block.text);
			if (!text || isReaderHeadingBlock(block, text) || /^<table\b/iu.test(text)) {
				continue;
			}
			return text.length > 150 ? `${text.slice(0, 147)}...` : text;
		}
	}
	return `${title}的校园文档阅读页。`;
}

function buildReaderCanonicalUrl(entry: RoutedPublishedReaderManifestEntry): string {
	const base = `/docs/${entry.corpus}/${entry.collection}/${entry.routeSlug}`;
	return entry.isCurrent ? base : `${base}/v/${encodeURIComponent(entry.versionSlug)}`;
}

function buildReaderPermalinkMap(
	reader: ReaderDocumentPayload,
	title: string,
): Record<string, string> {
	const permalinks: Record<string, string> = {};
	for (const section of reader.sections ?? []) {
		const anchor = String(section.anchor ?? "").trim();
		const sectionTitle = normalizeText(section.title);
		if (
			!(
				anchor &&
				isSafeReaderAnchor(anchor) &&
				shouldRenderReaderSectionTitle({ sectionTitle, title })
			)
		) {
			continue;
		}
		const blocks = Array.isArray(section.blocks) ? (section.blocks as ReaderBlock[]) : [];
		const rootUnitId = blocks.map((block) => String(block.rootUnitId ?? "").trim()).find(Boolean);
		if (rootUnitId) {
			permalinks[anchor] = rootUnitId;
		}
	}
	return permalinks;
}

function isSafeReaderAnchor(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
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
				label: entry.versionLabel,
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
	const manifest = await loadPublishedReaderManifest({
		manifestFilePath: options.manifestFilePath,
	});
	if (options.command === "all" || options.command === "docs") {
		console.log(
			JSON.stringify(
				await syncCampusPublishedReaderDocs({
					client,
					manifest,
					manifestFilePath: options.manifestFilePath,
				}),
			),
		);
	}
	if (options.command === "all" || options.command === "assets") {
		console.log(
			JSON.stringify(
				await syncCampusPublishedReaderAssets({
					client,
					manifest,
					manifestFilePath: options.manifestFilePath,
				}),
			),
		);
	}
	if (options.command === "check") {
		console.log(
			JSON.stringify(
				await checkCampusPublishedReaderInputs({
					client,
					manifest,
					manifestFilePath: options.manifestFilePath,
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
