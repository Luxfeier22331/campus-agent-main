import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DOCS_ROOT = resolve(APP_ROOT, "docs");
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
	const docsRoot = resolve(input.docsRoot ?? DEFAULT_DOCS_ROOT);
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
	rmSync(resolve(docsRoot, "docs"), { force: true, recursive: true });
	writeText(resolve(docsRoot, "_meta.json"), formatJson(buildRootMeta()));
	writeText(resolve(docsRoot, "index.md"), buildHomePage(currentPublicEntries));
	writeBootstrapPages(docsRoot);
	writeCollectionMetaFiles({ docsRoot, entries: currentPublicEntries });
	for (const entry of readerEntries) {
		await writeReaderPage({ client: input.client, docsRoot, entry });
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
	const mdx = buildReaderMdx({ entry: input.entry, meta, reader });
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
			mdx,
		);
	}
}

function writeGatedReaderPage(input) {
	const versionMdx = buildGatedReaderMdx({
		entry: input.entry,
		importPath: "../../../../../../src/components/docs/gated-reader-bootstrap",
	});
	const currentMdx = buildGatedReaderMdx({
		entry: input.entry,
		importPath: "../../../../src/components/docs/gated-reader-bootstrap",
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
	writeText(versionPath, versionMdx);
	if (input.entry.isCurrent) {
		writeText(
			resolve(
				input.docsRoot,
				"docs",
				input.entry.corpus,
				input.entry.collection,
				`${input.entry.documentSlug}.mdx`,
			),
			currentMdx,
		);
	}
}

function buildGatedReaderMdx(input) {
	return [
		"---",
		`title: ${JSON.stringify(input.entry.title)}`,
		"footer: false",
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
	if (!Array.isArray(parsed.entries)) {
		throw new Error("campus docs reader manifest must contain entries[]");
	}
	return { entries: parsed.entries.map(normalizeEntry), generatedAt: parsed.generatedAt };
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
			'readerLayout: "reference"',
			'readerMeasure: "standard"',
			"---",
			"",
			'import GatedReaderBootstrap from "../src/components/docs/gated-reader-bootstrap";',
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
			'readerLayout: "reference"',
			'readerMeasure: "standard"',
			"outline: false",
			"---",
			"",
			'import GatedCollectionBootstrap from "../src/components/docs/gated-collection-bootstrap";',
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
				escapeHtml(text),
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
	return [
		`<section className="document-meta-panel" aria-label="文档来源与版本" data-docs-reader-meta="true" data-docs-corpus="${escapeHtml(input.entry.corpus)}" data-docs-collection="${escapeHtml(input.entry.collection)}" data-docs-document-slug="${escapeHtml(input.entry.documentSlug)}" data-docs-version-slug="${escapeHtml(input.entry.versionSlug)}" data-docs-is-current="${input.entry.isCurrent ? "true" : "false"}">`,
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
		...entries.map((entry) => ({ type: "file", name: entry.documentSlug, label: entry.title })),
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
		"outline: false",
		"---",
		"",
		`# ${label}`,
		"",
		...entries.map(
			(entry) => `- [${escapeMarkdownLinkText(entry.title)}](./${entry.documentSlug})`,
		),
		"",
	].join("\n");
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

function createS3ObjectStore() {
	const endpoint = requireEnv("OBJECT_STORE_ENDPOINT");
	const accessKeyId = requireEnv("OBJECT_STORE_ACCESS_KEY");
	const secretAccessKey = requireEnv("OBJECT_STORE_SECRET_KEY");
	const region = process.env.OBJECT_STORE_REGION?.trim() || "us-east-1";
	const bucket = resolvePublishedReaderObjectStoreBucket(process.env);
	const client = new S3Client({
		credentials: { accessKeyId, secretAccessKey },
		endpoint,
		forcePathStyle: true,
		region,
	});
	return {
		async readOptionalBytesObject(input) {
			try {
				const response = await client.send(
					new GetObjectCommand({ Bucket: bucket, Key: input.key }),
				);
				if (!response.Body) {
					throw new Error(`empty object body: ${input.key}`);
				}
				return response.Body.transformToByteArray();
			} catch (error) {
				if (isMissingObjectError(error)) {
					return;
				}
				throw error;
			}
		},
		async readTextObject(input) {
			const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: input.key }));
			if (!response.Body) {
				throw new Error(`empty object body: ${input.key}`);
			}
			return new TextDecoder().decode(await response.Body.transformToByteArray());
		},
	};
}

export function resolvePublishedReaderObjectStoreBucket(env) {
	return env.OBJECT_STORE_BUCKET_DERIVED?.trim() || "campus-rag-derived";
}

function isMissingObjectError(error) {
	return Boolean(
		error &&
			typeof error === "object" &&
			(error.name === "NoSuchKey" ||
				error.Code === "NoSuchKey" ||
				error.Code === "NotFound" ||
				error.$metadata?.httpStatusCode === 404),
	);
}

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for campus docs published reader sync`);
	}
	return value;
}

function compareEntryRoute(left, right) {
	return `${left.corpus}/${left.collection}/${left.documentSlug}/${left.versionSlug}`.localeCompare(
		`${right.corpus}/${right.collection}/${right.documentSlug}/${right.versionSlug}`,
	);
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

function assertSafePathSegment(value, label) {
	if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
		throw new Error(`campus docs reader manifest entry has unsafe ${label}`);
	}
}

function normalizeText(value) {
	return String(value ?? "").trim();
}

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeMarkdownLinkText(value) {
	return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function writeText(path, content) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}

function formatJson(value) {
	return `${JSON.stringify(value, undefined, "\t")}\n`;
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
