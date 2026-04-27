import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatJsonContent } from "./sync-real-docs/shared";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(scriptDir, "..");
const DOCS_ROOT = resolve(APP_ROOT, "docs");

interface ScaffoldCollection {
	corpus: string;
	corpusLabel: string;
	description: string;
	dirName: string;
	title: string;
}

const SCAFFOLD_COLLECTIONS: readonly ScaffoldCollection[] = [
	{
		corpus: "regulations",
		corpusLabel: "规章制度",
		description: "学生管理制度、办事流程和校园生活相关规定。",
		dirName: "student_rules",
		title: "学生手册",
	},
	{
		corpus: "curriculum",
		corpusLabel: "培养方案",
		description: "专业培养目标、毕业要求、课程安排与课程地图。",
		dirName: "curriculum_plan",
		title: "培养方案",
	},
] as const;

export function ensurePublicDocsScaffold(input: { docsRoot?: string } = {}): void {
	const docsRoot = input.docsRoot ?? DOCS_ROOT;
	writeFileIfMissing(resolve(docsRoot, "_meta.json"), formatJsonContent(buildRootMeta()));
	writeFileIfMissing(resolve(docsRoot, "index.md"), buildHomePage());
	const publicDocsRoot = resolve(docsRoot, "docs");
	writeFileIfMissing(resolve(publicDocsRoot, "_meta.json"), formatJsonContent(buildDocsMeta()));
	writeFileIfMissing(resolve(publicDocsRoot, "index.md"), buildDocsIndex());
	for (const corpus of uniqueCorpora()) {
		const corpusDir = resolve(publicDocsRoot, corpus.corpus);
		writeFileIfMissing(
			resolve(corpusDir, "_meta.json"),
			formatJsonContent(buildCorpusMeta(corpus.corpus)),
		);
		writeFileIfMissing(resolve(corpusDir, "index.md"), buildCorpusIndex(corpus));
	}
	for (const collection of SCAFFOLD_COLLECTIONS) {
		const collectionDir = resolve(publicDocsRoot, collection.corpus, collection.dirName);
		mkdirSync(collectionDir, { recursive: true });
		writeFileIfMissing(resolve(collectionDir, "_meta.json"), "[]\n");
		writeFileIfMissing(resolve(collectionDir, "index.md"), buildCollectionIndex(collection));
	}
}

function writeFileIfMissing(path: string, content: string): void {
	if (existsSync(path)) {
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
}

function buildRootMeta(): unknown[] {
	return [
		{ type: "file", name: "index", label: "文档首页" },
		{ type: "dir", name: "docs", label: "公开文档", collapsed: false },
	];
}

function buildDocsMeta(): unknown[] {
	return [
		{ type: "file", name: "index", label: "全部文档" },
		...uniqueCorpora().map((corpus) => ({
			type: "dir",
			name: corpus.corpus,
			label: corpus.corpusLabel,
			collapsed: false,
		})),
	];
}

function buildCorpusMeta(corpus: string): unknown[] {
	return [
		{ type: "file", name: "index", label: resolveCorpusLabel(corpus) },
		...SCAFFOLD_COLLECTIONS.filter((collection) => collection.corpus === corpus).map(
			(collection) => ({
				type: "dir",
				name: collection.dirName,
				label: collection.title,
				collapsed: true,
			}),
		),
	];
}

function buildHomePage(): string {
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
		"这里是公开文档站的本地占位入口。公开正文会在发布链路同步后写入。",
		"",
		"- [公开文档总览](/docs/)",
		"- [学生手册](/docs/regulations/student_rules/)",
		"- [培养方案](/docs/curriculum/curriculum_plan/)",
		"",
	].join("\n");
}

function buildDocsIndex(): string {
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
		"当前本地环境尚未同步公开正文。请选择左侧目录查看已生成的集合入口。",
		"",
		...SCAFFOLD_COLLECTIONS.map(
			(collection) =>
				`- [${collection.title}](/docs/${collection.corpus}/${collection.dirName}/)：当前公开发布 0 篇文档`,
		),
		"",
	].join("\n");
}

function buildCorpusIndex(corpus: { corpus: string; corpusLabel: string }): string {
	const collections = SCAFFOLD_COLLECTIONS.filter(
		(collection) => collection.corpus === corpus.corpus,
	);
	return [
		"---",
		`title: ${corpus.corpusLabel}`,
		"footer: false",
		'documentKind: "collectionLanding"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		`# ${corpus.corpusLabel}`,
		"",
		"当前本地环境尚未同步公开正文。",
		"",
		...collections.map(
			(collection) => `- [${collection.title}](./${collection.dirName}/)：当前公开发布 0 篇文档`,
		),
		"",
	].join("\n");
}

function buildCollectionIndex(collection: ScaffoldCollection): string {
	return [
		"---",
		`title: ${collection.title}`,
		`description: ${collection.description}`,
		"footer: false",
		'documentKind: "collectionLanding"',
		'readerLayout: "landing"',
		'readerMeasure: "standard"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		`# ${collection.title}`,
		"",
		collection.description,
		"",
		"当前公开发布 0 篇文档。公开正文会在发布链路同步后写入。",
		"",
	].join("\n");
}

function uniqueCorpora(): Array<{ corpus: string; corpusLabel: string }> {
	const corpora = new Map<string, string>();
	for (const collection of SCAFFOLD_COLLECTIONS) {
		corpora.set(collection.corpus, collection.corpusLabel);
	}
	return [...corpora].map(([corpus, corpusLabel]) => ({ corpus, corpusLabel }));
}

function resolveCorpusLabel(corpus: string): string {
	return uniqueCorpora().find((entry) => entry.corpus === corpus)?.corpusLabel ?? corpus;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	ensurePublicDocsScaffold();
}
