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
	slug: string;
	title: string;
	key: string;
	collection: string;
	collectionLabel: string;
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
