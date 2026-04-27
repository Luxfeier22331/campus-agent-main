import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { APP_ROOT, DOCS_ROOT, escapeHtmlText, formatJsonContent } from "./sync-real-docs/shared";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

export interface PublishedReaderDocsSyncResult {
	generatedDocumentCount: number;
}

interface PublishedReaderDocEntry {
	collection: string;
	corpus: string;
	deliveryMode: string;
	docId?: string;
	documentSlug: string;
	isCurrent: boolean;
	sourceObjects: Record<string, string>;
	targetObjects: Record<string, string>;
	title: string;
	versionId?: string;
	versionLabel?: string;
	versionSlug: string;
}

interface PublishedReaderDocsManifest {
	entries: PublishedReaderDocEntry[];
	generatedAt?: string;
	surface?: string;
}

interface ReaderPayload {
	document?: {
		collection?: string;
		corpus?: string;
		documentSlug?: string;
		title?: string;
	};
	sections?: Array<{
		anchor?: string;
		blocks?: Array<{
			kind?: string;
			rootUnitId?: string;
			text?: string;
		}>;
		order?: number;
		title?: string;
	}>;
}

interface ReaderMetaPayload {
	pageLabel?: string;
	resolvedVersion?: {
		label?: string;
	};
	source?: {
		pageLabel?: string;
		title?: string;
	};
	sourceLabel?: string;
	title?: string;
}

const CORPUS_ORDER = ["regulations", "curriculum"] as const;
const COLLECTION_ORDER = ["student_rules", "curriculum_plan"] as const;

export async function syncPublishedReaderDocs(input: {
	client: ObjectStoreClient;
	docsRoot?: string;
	manifestFilePath?: string;
	manifestObjectKey?: string;
}): Promise<PublishedReaderDocsSyncResult> {
	const docsRoot = resolve(input.docsRoot ?? DOCS_ROOT);
	const manifest = await loadManifest(input);
	const publicEntries = manifest.entries
		.filter((entry) => entry.deliveryMode === "public_static_asset")
		.sort((left, right) =>
			`${left.corpus}/${left.collection}/${left.documentSlug}/${left.versionSlug}`.localeCompare(
				`${right.corpus}/${right.collection}/${right.documentSlug}/${right.versionSlug}`,
			),
		);
	const currentEntries = publicEntries.filter((entry) => entry.isCurrent);

	for (const generatedDir of [
		"docs",
		"student-handbook",
		"curriculum-plan",
		"campus-regulations",
	]) {
		rmSync(resolve(docsRoot, generatedDir), { force: true, recursive: true });
	}
	writeText(resolve(docsRoot, "_meta.json"), formatJsonContent(buildRootMeta()));
	writeText(resolve(docsRoot, "index.md"), buildHomePage(currentEntries));

	const entriesByScope = new Map<string, PublishedReaderDocEntry[]>();
	for (const entry of currentEntries) {
		const key = `${entry.corpus}/${entry.collection}`;
		entriesByScope.set(key, [...(entriesByScope.get(key) ?? []), entry]);
	}
	for (const entry of publicEntries) {
		await writeReaderPage({ client: input.client, docsRoot, entry });
	}

	writeCollectionMetaFiles({ docsRoot, entriesByScope });

	return { generatedDocumentCount: publicEntries.length };
}

async function loadManifest(input: {
	client: ObjectStoreClient;
	manifestFilePath?: string;
	manifestObjectKey?: string;
}): Promise<PublishedReaderDocsManifest> {
	const raw = input.manifestFilePath
		? readFileSync(input.manifestFilePath, "utf8")
		: await input.client.readTextObject({ key: requireValue(input.manifestObjectKey) });
	const parsed = JSON.parse(raw) as Partial<PublishedReaderDocsManifest>;
	if (!Array.isArray(parsed.entries)) {
		throw new Error("published reader docs manifest must contain entries[]");
	}
	return {
		entries: parsed.entries.map(normalizeEntry),
		generatedAt: parsed.generatedAt,
		surface: parsed.surface,
	};
}

function normalizeEntry(value: unknown): PublishedReaderDocEntry {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("published reader docs manifest entry must be an object");
	}
	const entry = value as Partial<PublishedReaderDocEntry>;
	if (entry.deliveryMode === "gated_asset") {
		return {
			collection: entry.collection ?? "",
			corpus: entry.corpus ?? "",
			deliveryMode: entry.deliveryMode ?? "",
			docId: entry.docId,
			documentSlug: entry.documentSlug ?? "",
			isCurrent: entry.isCurrent !== false,
			sourceObjects: isStringRecord(entry.sourceObjects) ? entry.sourceObjects : {},
			targetObjects: isStringRecord(entry.targetObjects) ? entry.targetObjects : {},
			title: entry.title ?? "",
			versionId: entry.versionId,
			versionLabel: entry.versionLabel,
			versionSlug: entry.versionSlug ?? "current",
		};
	}
	if (entry.deliveryMode !== "public_static_asset") {
		throw new Error(`unsupported published reader docs delivery mode: ${entry.deliveryMode ?? ""}`);
	}
	if (!(entry.corpus && entry.collection && entry.documentSlug && entry.title)) {
		throw new Error("published reader docs manifest entry is missing document identity");
	}
	assertSafePathSegment(entry.corpus, "corpus");
	assertSafePathSegment(entry.collection, "collection");
	assertSafePathSegment(entry.documentSlug, "documentSlug");
	assertSafePathSegment(entry.versionSlug ?? "current", "versionSlug");
	if (!isStringRecord(entry.sourceObjects)) {
		throw new Error("published reader docs manifest entry requires sourceObjects");
	}
	if (!isStringRecord(entry.targetObjects)) {
		throw new Error("published reader docs manifest entry requires targetObjects");
	}
	return {
		collection: entry.collection,
		corpus: entry.corpus,
		deliveryMode: entry.deliveryMode ?? "",
		docId: entry.docId,
		documentSlug: entry.documentSlug,
		isCurrent: entry.isCurrent !== false,
		sourceObjects: entry.sourceObjects,
		targetObjects: entry.targetObjects,
		title: entry.title,
		versionId: entry.versionId,
		versionLabel: entry.versionLabel,
		versionSlug: entry.versionSlug ?? "current",
	};
}

async function writeReaderPage(input: {
	client: ObjectStoreClient;
	docsRoot: string;
	entry: PublishedReaderDocEntry;
}): Promise<void> {
	const reader = JSON.parse(
		await input.client.readTextObject({ key: input.entry.sourceObjects.reader }),
	) as ReaderPayload;
	const meta = input.entry.sourceObjects.meta
		? (JSON.parse(
				await input.client.readTextObject({ key: input.entry.sourceObjects.meta }),
			) as ReaderMetaPayload)
		: {};
	const mdx = buildReaderMdx({ entry: input.entry, meta, reader });
	writeText(
		resolve(
			input.docsRoot,
			"docs",
			input.entry.corpus,
			input.entry.collection,
			input.entry.documentSlug,
			"v",
			`${input.entry.versionSlug}.mdx`,
		),
		mdx,
	);
	if (input.entry.isCurrent) {
		writeText(
			resolve(
				input.docsRoot,
				"docs",
				input.entry.corpus,
				input.entry.collection,
				`${input.entry.documentSlug}.mdx`,
			),
			mdx,
		);
	}
}

function buildReaderMdx(input: {
	entry: PublishedReaderDocEntry;
	meta: ReaderMetaPayload;
	reader: ReaderPayload;
}): string {
	const title = input.reader.document?.title || input.entry.title;
	const lines = [
		"---",
		`title: ${JSON.stringify(title)}`,
		"footer: false",
		`documentKind: ${JSON.stringify(resolveDocumentKind(input.entry))}`,
		`readerLayout: ${JSON.stringify(resolveReaderLayout(input.entry))}`,
		`readerMeasure: ${JSON.stringify(resolveReaderMeasure(input.entry))}`,
		'readerOutline: "document"',
		"---",
		"",
		buildMetaPanel({ entry: input.entry, meta: input.meta }),
		"",
	];

	for (const section of input.reader.sections ?? []) {
		const anchor = String(section.anchor ?? "").trim();
		if (anchor) {
			lines.push(`<span id="${escapeHtmlText(anchor)}"></span>`, "");
		}
		const sectionTitle = String(section.title ?? "").trim();
		if (sectionTitle && sectionTitle !== title) {
			lines.push(`## ${sectionTitle}`, "");
		}
		for (const block of section.blocks ?? []) {
			const text = String(block.text ?? "").trim();
			if (!text) {
				continue;
			}
			const rootUnitId = String(block.rootUnitId ?? "").trim();
			lines.push(
				`<div className="reader-block" data-root-unit-id="${escapeHtmlText(rootUnitId)}">`,
				"",
				text,
				"",
				"</div>",
				"",
			);
		}
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

function buildMetaPanel(input: {
	entry: PublishedReaderDocEntry;
	meta: ReaderMetaPayload;
}): string {
	const versionLabel =
		input.entry.versionLabel || input.meta.resolvedVersion?.label || "当前展示版";
	const collectionLabel = resolveCollectionLabel(input.entry);
	const sourceTitle = input.meta.source?.title || input.meta.sourceLabel;
	const pageLabel = input.meta.source?.pageLabel || input.meta.pageLabel;
	const visibleItems = [
		versionLabel,
		`来源：${collectionLabel}`,
		...(pageLabel ? [pageLabel] : []),
	];
	const details = [
		["文档集合", collectionLabel],
		["版本", versionLabel],
		...(sourceTitle ? ([["来源文件", sourceTitle]] as const) : []),
		...(pageLabel ? ([["原文位置", pageLabel]] as const) : []),
		...(input.entry.docId ? ([["doc_id", input.entry.docId]] as const) : []),
		...(input.entry.versionId ? ([["version_id", input.entry.versionId]] as const) : []),
	];
	return [
		`<section className="document-meta-panel" aria-label="文档来源与版本" data-docs-reader-meta="true" data-docs-corpus="${escapeHtmlText(input.entry.corpus)}" data-docs-collection="${escapeHtmlText(input.entry.collection)}" data-docs-document-slug="${escapeHtmlText(input.entry.documentSlug)}" data-docs-version-slug="${escapeHtmlText(input.entry.versionSlug)}" data-docs-is-current="${input.entry.isCurrent ? "true" : "false"}">`,
		'\t<p className="document-meta-summary">',
		...visibleItems.map((item) => `\t\t<span>${escapeHtmlText(item)}</span>`),
		"\t</p>",
		'\t<details className="document-meta-details">',
		"\t\t<summary>来源详情</summary>",
		"\t\t<dl>",
		...details.flatMap(([label, value]) => [
			"\t\t\t<div>",
			`\t\t\t\t<dt>${escapeHtmlText(label)}</dt>`,
			`\t\t\t\t<dd>${escapeHtmlText(value)}</dd>`,
			"\t\t\t</div>",
		]),
		"\t\t</dl>",
		"\t</details>",
		"</section>",
	].join("\n");
}

function writeCollectionMetaFiles(input: {
	docsRoot: string;
	entriesByScope: Map<string, PublishedReaderDocEntry[]>;
}): void {
	const docsDir = resolve(input.docsRoot, "docs");
	const entries = [...input.entriesByScope.values()].flat();
	writeText(resolve(docsDir, "index.md"), buildDocsIndex(entries));
	writeText(resolve(docsDir, "_meta.json"), formatJsonContent(buildDocsMeta(input.entriesByScope)));
	for (const corpus of sortedCorpora(input.entriesByScope)) {
		const corpusEntries = entries.filter((entry) => entry.corpus === corpus);
		const corpusDir = resolve(docsDir, corpus);
		writeText(resolve(corpusDir, "index.md"), buildCorpusIndex(corpus, corpusEntries));
		writeText(
			resolve(corpusDir, "_meta.json"),
			formatJsonContent(buildCorpusMeta(corpus, input.entriesByScope)),
		);
	}
	for (const [scope, collectionEntries] of input.entriesByScope) {
		const [corpus, collection] = scope.split("/");
		if (!(corpus && collection)) {
			continue;
		}
		const collectionDir = resolve(docsDir, corpus, collection);
		writeText(
			resolve(collectionDir, "_meta.json"),
			formatJsonContent(buildCollectionMeta(collectionEntries)),
		);
		writeText(
			resolve(collectionDir, "index.md"),
			buildCollectionIndex(corpus, collection, collectionEntries),
		);
	}
}

function buildRootMeta(): unknown[] {
	return [
		{ type: "file", name: "index", label: "文档首页" },
		{ type: "dir", name: "docs", label: "公开文档", collapsed: false },
	];
}

function buildDocsMeta(entriesByScope: Map<string, PublishedReaderDocEntry[]>): unknown[] {
	return [
		{ type: "file", name: "index", label: "全部文档" },
		...sortedCorpora(entriesByScope).map((corpus) => ({
			type: "dir",
			name: corpus,
			label: resolveCorpusLabel(corpus),
			collapsed: false,
		})),
	];
}

function buildCorpusMeta(
	corpus: string,
	entriesByScope: Map<string, PublishedReaderDocEntry[]>,
): unknown[] {
	return [
		{ type: "file", name: "index", label: resolveCorpusLabel(corpus) },
		...sortedCollections(corpus, entriesByScope).map((collection) => ({
			type: "dir",
			name: collection,
			label: resolveCollectionLabel({ collection, corpus } as PublishedReaderDocEntry),
			collapsed: true,
		})),
	];
}

function buildCollectionMeta(entries: PublishedReaderDocEntry[]): unknown[] {
	return [
		{ type: "file", name: "index", label: "目录" },
		...entries.map((entry) => ({
			type: "file" as const,
			name: entry.documentSlug,
			label: entry.title,
		})),
	];
}

function buildCollectionIndex(
	corpus: string,
	collection: string,
	entries: PublishedReaderDocEntry[],
): string {
	const title = resolveCollectionLabel({ collection, corpus } as PublishedReaderDocEntry);
	const corpusLabel = resolveCorpusLabel(corpus);
	return [
		"---",
		`title: ${JSON.stringify(title)}`,
		"footer: false",
		'documentKind: "collectionLanding"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		`# ${title}`,
		"",
		`当前公开发布 ${entries.length} 篇文档，归属「${corpusLabel}」。`,
		"",
		...entries.flatMap((entry) => [
			`- [${escapeMarkdownLinkText(entry.title)}](./${entry.documentSlug})`,
		]),
		"",
	].join("\n");
}

function buildHomePage(entries: PublishedReaderDocEntry[]): string {
	const collectionSummaries = summarizeCollections(entries);
	return [
		"---",
		'title: "文档首页"',
		"footer: false",
		'documentKind: "home"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		"# 校园公开文档",
		"",
		'<section className="docs-home-hero">',
		'<p className="docs-home-kicker">公开文档入口</p>',
		'<p className="docs-home-lede">集中阅读学生手册、培养方案与公开规章。正文来自清洗归一后的 canonical 文档，并保留版本与来源线索。</p>',
		"</section>",
		"",
		'<div className="docs-home-grid">',
		...collectionSummaries.map(
			(summary) =>
				`<a className="docs-home-card" href="${summary.href}"><strong>${escapeHtmlText(summary.label)}</strong><span>${escapeHtmlText(summary.description)}</span><small>${summary.count} 篇文档</small></a>`,
		),
		"</div>",
		"",
		"## 阅读方式",
		"",
		'<ul className="docs-home-guide">',
		"<li><strong>按集合进入</strong>从左侧目录选择学生手册、培养方案或公开规章。</li>",
		"<li><strong>按关键词检索</strong>使用顶部搜索查找文件名、章节标题或制度关键词。</li>",
		"<li><strong>按来源核对</strong>每篇正文顶部展示版本和来源摘要，技术身份放入折叠详情。</li>",
		"</ul>",
		"",
		`当前公开发布 ${entries.length} 篇文档。`,
		"",
	].join("\n");
}

function buildDocsIndex(entries: PublishedReaderDocEntry[]): string {
	return [
		"---",
		'title: "公开文档总览"',
		"footer: false",
		'documentKind: "home"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		"# 公开文档总览",
		"",
		`当前公开发布 ${entries.length} 篇文档。请选择左侧目录中的集合继续阅读。`,
		"",
		...summarizeCollections(entries).map(
			(summary) => `- [${summary.label}](${summary.href})：${summary.count} 篇文档`,
		),
		"",
	].join("\n");
}

function buildCorpusIndex(corpus: string, entries: PublishedReaderDocEntry[]): string {
	const label = resolveCorpusLabel(corpus);
	return [
		"---",
		`title: ${JSON.stringify(label)}`,
		"footer: false",
		'documentKind: "collectionLanding"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		`# ${label}`,
		"",
		`当前公开发布 ${entries.length} 篇文档。`,
		"",
		...summarizeCollections(entries).map(
			(summary) => `- [${summary.label}](./${summary.collection}/)：${summary.count} 篇文档`,
		),
		"",
	].join("\n");
}

function resolveDocumentKind(entry: PublishedReaderDocEntry): string {
	if (entry.collection === "curriculum_plan") {
		return "curriculumPlan";
	}
	if (entry.collection === "student_rules") {
		return "studentHandbookArticle";
	}
	return "publicRegulation";
}

function resolveReaderLayout(entry: PublishedReaderDocEntry): string {
	return entry.collection === "curriculum_plan" ? "tabular" : "article";
}

function resolveReaderMeasure(entry: PublishedReaderDocEntry): string {
	return entry.collection === "curriculum_plan" ? "wide" : "standard";
}

function resolveCorpusLabel(corpus: string): string {
	return corpus === "curriculum" ? "培养方案" : corpus === "regulations" ? "规章制度" : corpus;
}

function resolveCollectionLabel(entry: PublishedReaderDocEntry): string {
	if (entry.collection === "curriculum_plan") {
		return "培养方案";
	}
	if (entry.collection === "student_rules") {
		return "学生手册";
	}
	return entry.collection;
}

function writeText(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}

function summarizeCollections(entries: PublishedReaderDocEntry[]): Array<{
	collection: string;
	count: number;
	description: string;
	href: string;
	label: string;
}> {
	const byScope = new Map<string, PublishedReaderDocEntry[]>();
	for (const entry of entries) {
		const key = `${entry.corpus}/${entry.collection}`;
		byScope.set(key, [...(byScope.get(key) ?? []), entry]);
	}
	return [...byScope.entries()]
		.sort(([left], [right]) => compareScope(left, right))
		.map(([scope, scopedEntries]) => {
			const [corpus, collection] = scope.split("/");
			const normalizedCorpus = corpus ?? "";
			const normalizedCollection = collection ?? "";
			const label = resolveCollectionLabel({
				collection: normalizedCollection,
				corpus: normalizedCorpus,
			} as PublishedReaderDocEntry);
			return {
				collection: normalizedCollection,
				count: scopedEntries.length,
				description: collectionDescription(normalizedCorpus, normalizedCollection),
				href: `/docs/${normalizedCorpus}/${normalizedCollection}/`,
				label,
			};
		});
}

function sortedCorpora(entriesByScope: Map<string, PublishedReaderDocEntry[]>): string[] {
	const corpora = new Set([...entriesByScope.keys()].map((scope) => scope.split("/", 1)[0]));
	return [...corpora].sort(compareCorpus);
}

function sortedCollections(
	corpus: string,
	entriesByScope: Map<string, PublishedReaderDocEntry[]>,
): string[] {
	return [...entriesByScope.keys()]
		.filter((scope) => scope.startsWith(`${corpus}/`))
		.map((scope) => scope.split("/")[1])
		.filter((collection): collection is string => Boolean(collection))
		.sort(compareCollection);
}

function compareScope(left: string, right: string): number {
	const [leftCorpus, leftCollection] = left.split("/");
	const [rightCorpus, rightCollection] = right.split("/");
	return (
		compareCorpus(leftCorpus ?? "", rightCorpus ?? "") ||
		compareCollection(leftCollection ?? "", rightCollection ?? "")
	);
}

function compareCorpus(left: string, right: string): number {
	const leftIndex = CORPUS_ORDER.indexOf(left as (typeof CORPUS_ORDER)[number]);
	const rightIndex = CORPUS_ORDER.indexOf(right as (typeof CORPUS_ORDER)[number]);
	if (leftIndex !== rightIndex) {
		return normalizeOrderIndex(leftIndex) - normalizeOrderIndex(rightIndex);
	}
	return left.localeCompare(right);
}

function compareCollection(left: string, right: string): number {
	const leftIndex = COLLECTION_ORDER.indexOf(left as (typeof COLLECTION_ORDER)[number]);
	const rightIndex = COLLECTION_ORDER.indexOf(right as (typeof COLLECTION_ORDER)[number]);
	if (leftIndex !== rightIndex) {
		return normalizeOrderIndex(leftIndex) - normalizeOrderIndex(rightIndex);
	}
	return left.localeCompare(right);
}

function normalizeOrderIndex(index: number): number {
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function collectionDescription(corpus: string, collection: string): string {
	if (collection === "student_rules") {
		return "学生管理制度、办事流程和校园生活相关规定。";
	}
	if (collection === "curriculum_plan") {
		return "专业培养目标、毕业要求、课程安排与课程地图。";
	}
	return `${resolveCorpusLabel(corpus)}公开文档。`;
}

function escapeMarkdownLinkText(value: string): string {
	return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === "string")
	);
}

function requireValue(value: string | undefined): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error("manifestObjectKey is required");
	}
	return normalized;
}

function assertSafePathSegment(value: string, label: string): void {
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.includes("/") ||
		normalized.includes("\\") ||
		normalized === "." ||
		normalized === ".."
	) {
		throw new Error(`published reader docs manifest entry has unsafe ${label}`);
	}
}

async function main(): Promise<void> {
	const result = await syncPublishedReaderDocs({
		client: createS3ObjectStore(),
		docsRoot: process.env.PUBLIC_DOCS_SOURCE_DIR?.trim() || resolve(APP_ROOT, "docs"),
		manifestFilePath: process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH,
		manifestObjectKey: process.env.PUBLIC_DOCS_SYNC_MANIFEST_KEY,
	});
	console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
