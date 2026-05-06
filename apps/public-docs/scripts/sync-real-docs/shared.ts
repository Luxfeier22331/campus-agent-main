import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(currentDir, "../../../..");
export const APP_ROOT = resolve(currentDir, "../..");
export const DOCS_ROOT = resolve(APP_ROOT, "docs");
export const HANDBOOK_SPLIT_MANIFEST_PATH = resolve(
	REPO_ROOT,
	"configs/ingestion/regulations/student_rules/split-manifest.v1.json",
);
export const HANDBOOK_SOURCE_PROJECTIONS_PATH = resolve(
	REPO_ROOT,
	"configs/ingestion/regulations/student_rules/source-projections.v1.json",
);

export const DERIVED_BUCKET = "campus-rag-derived";
export const SOURCE_BUCKET = "campus-rag-source";
export const HANDBOOK_NOISE_LINES = new Set(["学生手册"]);
export const HANDBOOK_CORPUS = "regulations";
export const HANDBOOK_COLLECTION = "student_rules";
export const HANDBOOK_REVISION_TRACK = "source-faithful";
export const HANDBOOK_YEAR = "2018";
export const HANDBOOK_FILENAME = "canonical.md";

export const COURSE_MAP_PRACTICE_KEYWORDS = ["实习", "论文", "课程设计", "实践", "训练", "毕业"];
export const COURSE_MAP_EXTENSION_KEYWORDS = [
	"选修",
	"本硕贯通",
	"跨学科",
	"行业协同",
	"行业领域",
	"全球胜任力",
	"专业选修",
];
export const COURSE_MAP_FOUNDATION_KEYWORDS = [
	"思政",
	"马克思主义",
	"毛泽东",
	"习近平",
	"思想道德",
	"近现代史",
	"形势与政策",
	"中华民族共同体",
	"英语",
	"体育",
	"高等数学",
	"高等工程数学",
	"线性代数",
	"概率论",
	"物理",
	"物理实验",
	"汉语",
	"中华文化",
	"国家安全",
	"心理健康",
	"信息素养",
	"基本素养",
	"综合素养",
	"公共",
];

export const MARKDOWN_ORDERED_LIST_RE = /^\d+\.\s+/;
export const MARKDOWN_UNORDERED_LIST_RE = /^[-*+]\s+/;
export const MARKDOWN_DECIMAL_LABEL_RE = /^(?<label>\d+\.\d+(?:\.\d+)*)(?<rest>(?:\s+|$).*)$/;
export const MARKDOWN_LIST_PREFIX_WITH_BREAK_RE = /^((?:\d+(?:\.\d+)*\.?)|[-*+])\s*\n+\s*/gm;
export const MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE = /^(?<marker>\d+\.(?!\d))(?<rest>\S)/gm;
export const HANDBOOK_CHAPTER_HEADING_RE = /^第[0-9一二三四五六七八九十百千零〇]+章(?:\s+.+)?$/;
export const HANDBOOK_ARTICLE_HEADING_RE = /^第[0-9一二三四五六七八九十百千零〇]+条(?:\s+.+)?$/;
export const MARKDOWN_LINE_LIMIT = 80;

export interface HandbookDoc {
	slug: string;
	title: string;
	documentId: string;
}

export interface CurriculumDoc {
	slug: string;
	title: string;
	key: string;
}

export interface PublicRegulationDoc {
	documentId: string;
	slug: string;
	title: string;
	key: string;
	collection: string;
	collectionLabel: string;
	audienceSegment: "student" | "public_service" | "staff_governance";
	docsNavGroup: "student" | "public_service" | "staff_governance";
}

export interface TableCell {
	text: string;
	rowspan: number;
	colspan: number;
}

export interface CourseMapDocEmbed {
	componentImportPath: string;
	dataImportPath: string;
	dataImportName: string;
}

export interface HandbookFlowGraphDoc {
	slug: string;
	title: string;
	filename: string;
}

export interface DocumentReaderTechnicalDetail {
	label: string;
	value: string;
}

export interface DocumentReaderMetadata {
	collectionLabel: string;
	sourceLabel?: string;
	pageLabel?: string;
	versionLabel?: string;
	statusLabel?: string;
	technicalDetails?: DocumentReaderTechnicalDetail[];
}

export type DocumentKind =
	| "home"
	| "collectionLanding"
	| "studentHandbookArticle"
	| "publicRegulation"
	| "curriculumPlan"
	| "workflow";

export type DocumentReaderLayout = "landing" | "article" | "reference" | "tabular" | "graph";

export type DocumentReaderMeasure = "standard" | "wide" | "full";

export type DocumentReaderOutlinePolicy = "none" | "document" | "compact";

export function buildReaderFrontmatterLines(input: {
	kind: DocumentKind;
	layout: DocumentReaderLayout;
	measure: DocumentReaderMeasure;
	outlinePolicy?: DocumentReaderOutlinePolicy;
}): string[] {
	return [
		`documentKind: ${jsonString(input.kind)}`,
		`readerLayout: ${jsonString(input.layout)}`,
		`readerMeasure: ${jsonString(input.measure)}`,
		`readerOutline: ${jsonString(input.outlinePolicy ?? "document")}`,
	];
}

export const HANDBOOK_DOC_SLUG_OVERRIDES = new Map<string, string>([
	["handbook:e53d05ae90e91f1c45843c50c3a777f774a88afc", "student-attendance-management"],
	["handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15", "national-scholarship-evaluation"],
]);

export const CURRICULUM_DOC_SLUG_OVERRIDES = new Map<string, string>([
	["curriculum:法学（民族实验班）本科人才培养方案", "law-ethnic-experimental-program"],
	[
		"curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
		"computer-science-ethnic-experimental-program",
	],
]);

export function normalizeText(value: unknown): string {
	return String(value ?? "").trim();
}

export function removeStaleGeneratedFiles(
	targetDir: string,
	expectedNames: ReadonlySet<string>,
): void {
	for (const name of readdirSync(targetDir)) {
		if (!expectedNames.has(name)) {
			const path = resolve(targetDir, name);
			rmSync(path, { force: true, recursive: true });
		}
	}
}

export function removeLegacySectionDirs(docsRoot: string): void {
	for (const legacyDir of [resolve(docsRoot, "regulations"), resolve(docsRoot, "curriculum")]) {
		rmSync(legacyDir, { force: true, recursive: true });
	}
}

export function buildAppSrcImportPath(input: {
	routeDepthFromDocsRoot: number;
	srcPath: string;
}): string {
	const normalizedSrcPath = input.srcPath.replace(/^\/+/, "");
	const appRootPrefix = "../".repeat(input.routeDepthFromDocsRoot + 1);
	return `${appRootPrefix}src/${normalizedSrcPath}`;
}

export function wrapMarkdownPlainText(text: string): string {
	return wrapMarkdownTextLines(text).join("\n");
}

export function wrapMarkdownTextLines(
	text: string,
	options: { initialPrefix?: string; subsequentPrefix?: string } = {},
): string[] {
	const stripped = text.trim();
	if (!stripped) {
		return [""];
	}
	const initialPrefix = options.initialPrefix ?? "";
	const subsequentPrefix = options.subsequentPrefix ?? "";
	return stripped
		.split(/\r?\n/)
		.map((line, index) => `${index === 0 ? initialPrefix : subsequentPrefix}${line.trim()}`)
		.filter((line) => line.trim());
}

export function jsonString(value: string): string {
	return JSON.stringify(value);
}

export function escapeHtmlText(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function formatJsonContent(value: unknown): string {
	return `${JSON.stringify(value, undefined, "\t")}\n`;
}

export function formatJsObjectLiteral(value: unknown): string {
	return JSON.stringify(value, undefined, "\t").replace(
		/^(\t*)"([A-Za-z_][A-Za-z0-9_]*)":/gm,
		"$1$2:",
	);
}

export function buildDocumentMetaPanelBlock(
	metadata: DocumentReaderMetadata,
	options: { mdx?: boolean } = {},
): string {
	const classAttr = options.mdx ? "className" : "class";
	const compactMetadata = compactDocumentReaderMetadata(metadata);
	const visibleSourceLabel = resolvePublicDocumentSourceLabel(compactMetadata);
	const summaryItems = [
		compactMetadata.versionLabel,
		compactMetadata.pageLabel,
		visibleSourceLabel ? `来源：${visibleSourceLabel}` : undefined,
	].filter((value): value is string => Boolean(value));
	const detailRows = [
		["文档集合", compactMetadata.collectionLabel],
		["原始文件", compactMetadata.sourceLabel],
		["原文位置", compactMetadata.pageLabel],
		["版本", compactMetadata.versionLabel],
		[
			"状态",
			compactMetadata.statusLabel && !isDefaultStatusLabel(compactMetadata.statusLabel)
				? compactMetadata.statusLabel
				: undefined,
		],
		...(compactMetadata.technicalDetails ?? []).map((detail) => [detail.label, detail.value]),
	].filter((row): row is [string, string] => Boolean(row[1]));
	const lines = [
		`<section ${classAttr}="document-meta-panel" aria-label="文档来源与版本">`,
		`\t<p ${classAttr}="document-meta-summary">`,
	];
	for (const item of summaryItems) {
		lines.push(`\t\t<span>${escapeHtmlText(item)}</span>`);
	}
	lines.push("\t</p>");
	if (detailRows.length > 0) {
		lines.push(
			`\t<details ${classAttr}="document-meta-details">`,
			"\t\t<summary>来源详情</summary>",
			"\t\t<dl>",
		);
		for (const [label, value] of detailRows) {
			lines.push(
				"\t\t\t<div>",
				`\t\t\t\t<dt>${escapeHtmlText(label)}</dt>`,
				`\t\t\t\t<dd>${escapeHtmlText(value)}</dd>`,
				"\t\t\t</div>",
			);
		}
		lines.push("\t\t</dl>", "\t</details>");
	}
	lines.push("</section>");
	return lines.join("\n");
}

function resolvePublicDocumentSourceLabel(metadata: DocumentReaderMetadata): string | undefined {
	if (metadata.collectionLabel === "培养方案") {
		return "培养方案汇编";
	}
	if (metadata.collectionLabel === "学生手册") {
		return "学生手册";
	}
	if (metadata.collectionLabel) {
		return metadata.collectionLabel;
	}
	return metadata.sourceLabel && !looksLikeSourceFilename(metadata.sourceLabel)
		? metadata.sourceLabel
		: undefined;
}

function looksLikeSourceFilename(value: string): boolean {
	return /\.[A-Za-z0-9]{2,8}$/.test(value.trim());
}

function isDefaultStatusLabel(value: string): boolean {
	return value.trim() === "当前展示版";
}

export function buildDocumentReaderMetadataFromJsonl(input: {
	jsonlText: string;
	collectionLabel: string;
	objectKey?: string;
	statusLabel?: string;
	fallbackSourceLabel?: string;
}): DocumentReaderMetadata {
	const rows = [...iterJsonlRows(input.jsonlText)];
	const docId = firstNonEmpty(rows.map((row) => normalizeText(row.doc_id)));
	const versionId = firstNonEmpty(rows.map((row) => normalizeText(row.version_id)));
	const sourceLabel =
		firstNonEmpty(
			rows.flatMap((row) => [
				normalizeText(row.source_doc),
				normalizeText(row.source_pdf),
				normalizeText(row.source_file),
				normalizeText(asRecord(row.metadata)?.source_doc),
				normalizeText(asRecord(row.metadata)?.source_pdf),
				normalizeText(asRecord(row.metadata)?.source_file),
			]),
		) || input.fallbackSourceLabel;
	const pageRange = resolvePageRange(rows);
	const versionYear = sourceYearFromObjectKey(input.objectKey);
	const metadata: DocumentReaderMetadata = {
		collectionLabel: input.collectionLabel,
		pageLabel: formatSourcePageRange(pageRange?.start, pageRange?.end),
		sourceLabel,
		statusLabel: input.statusLabel ?? "当前展示版",
		versionLabel: versionYear ? `${versionYear} 版` : "当前展示版",
		technicalDetails: buildTechnicalDetails({ docId, versionId }),
	};
	return compactDocumentReaderMetadata(metadata);
}

export function buildDocumentReaderMetadataFromFrontmatter(input: {
	frontmatterLines: readonly string[];
	collectionLabel: string;
	versionYear?: string;
	statusLabel?: string;
	fallbackSourceLabel?: string;
}): DocumentReaderMetadata {
	const fields = parseSimpleFrontmatterFields(input.frontmatterLines);
	const sourceLabel =
		firstNonEmpty([
			fields.source_doc,
			fields.source_pdf,
			fields.source_file,
			fields.sourceDocument,
			fields.source,
		]) || input.fallbackSourceLabel;
	const pageStart = parseOptionalInt(fields.page_start ?? fields.source_page_start);
	const pageEnd = parseOptionalInt(fields.page_end ?? fields.source_page_end) ?? pageStart;
	return compactDocumentReaderMetadata({
		collectionLabel: input.collectionLabel,
		pageLabel: formatSourcePageRange(pageStart, pageEnd),
		sourceLabel,
		statusLabel: input.statusLabel ?? "当前展示版",
		versionLabel: input.versionYear ? `${input.versionYear} 版` : "当前展示版",
		technicalDetails: buildTechnicalDetails({
			docId: fields.doc_id,
			versionId: fields.version_id,
		}),
	});
}

export function formatSourcePageRange(
	start: number | undefined,
	end: number | undefined,
): string | undefined {
	if (start === undefined) {
		return;
	}
	if (end === undefined || end === start) {
		return `原文第 ${start} 页`;
	}
	return `原文第 ${start}-${end} 页`;
}

export function sourceYearFromObjectKey(key: string | undefined): string | undefined {
	return key?.match(/\/(?<year>(?:19|20)\d{2})(?:\/|$)/)?.groups?.year;
}

export function writeText(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
}

export function sha1Hex(value: string): string {
	return createHash("sha1").update(value, "utf-8").digest("hex");
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function* iterJsonlRows(jsonlText: string): Generator<Record<string, unknown>> {
	for (const line of jsonlText.split(/\r?\n/)) {
		const stripped = line.trim();
		if (stripped) {
			yield JSON.parse(stripped) as Record<string, unknown>;
		}
	}
}

function compactDocumentReaderMetadata(metadata: DocumentReaderMetadata): DocumentReaderMetadata {
	const technicalDetails = metadata.technicalDetails?.filter(
		(detail) => detail.label.trim() && detail.value.trim(),
	);
	return {
		collectionLabel: metadata.collectionLabel,
		...(metadata.sourceLabel ? { sourceLabel: metadata.sourceLabel } : {}),
		...(metadata.pageLabel ? { pageLabel: metadata.pageLabel } : {}),
		...(metadata.versionLabel ? { versionLabel: metadata.versionLabel } : {}),
		...(metadata.statusLabel ? { statusLabel: metadata.statusLabel } : {}),
		...(technicalDetails && technicalDetails.length > 0 ? { technicalDetails } : {}),
	};
}

function parseSimpleFrontmatterFields(frontmatterLines: readonly string[]): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const line of frontmatterLines.slice(1, -1)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("- ")) {
			continue;
		}
		const separatorIndex = trimmed.indexOf(":");
		if (separatorIndex === -1) {
			continue;
		}
		const key = trimmed.slice(0, separatorIndex).trim();
		const value = trimmed
			.slice(separatorIndex + 1)
			.trim()
			.replace(/^['"]|['"]$/g, "");
		if (key) {
			fields[key] = value;
		}
	}
	return fields;
}

function resolvePageRange(rows: readonly Record<string, unknown>[]):
	| {
			start: number;
			end: number;
	  }
	| undefined {
	const pages: number[] = [];
	for (const row of rows) {
		for (const key of ["page_start", "source_page_start", "page", "page_number"]) {
			const value = parseOptionalInt(row[key]);
			if (value !== undefined) {
				pages.push(value);
			}
		}
		for (const key of ["page_end", "source_page_end"]) {
			const value = parseOptionalInt(row[key]);
			if (value !== undefined) {
				pages.push(value);
			}
		}
	}
	if (pages.length === 0) {
		return;
	}
	return { end: Math.max(...pages), start: Math.min(...pages) };
}

function firstNonEmpty(values: readonly (string | undefined)[]): string | undefined {
	return values.find((value) => value?.trim())?.trim();
}

function parseOptionalInt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	const text = normalizeText(value);
	if (!/^\d+$/.test(text)) {
		return;
	}
	const parsed = Number.parseInt(text, 10);
	return parsed > 0 ? parsed : undefined;
}

function buildTechnicalDetails(input: {
	docId?: string;
	versionId?: string;
}): DocumentReaderTechnicalDetail[] | undefined {
	const details = [
		input.docId ? { label: "doc_id", value: input.docId } : undefined,
		input.versionId ? { label: "version_id", value: input.versionId } : undefined,
	].filter((detail): detail is DocumentReaderTechnicalDetail => Boolean(detail));
	return details.length > 0 ? details : undefined;
}
