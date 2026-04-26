import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(scriptDir, "..");
const DOCS_ROOT = resolve(APP_ROOT, "docs");

interface ScaffoldCollection {
	description: string;
	dirName: string;
	title: string;
}

const SCAFFOLD_COLLECTIONS: readonly ScaffoldCollection[] = [
	{
		description: "本地尚未同步真实学生手册文档。",
		dirName: "student-handbook",
		title: "学生手册",
	},
	{
		description: "本地尚未同步真实培养方案文档。",
		dirName: "curriculum-plan",
		title: "培养方案",
	},
] as const;

export function ensurePublicDocsScaffold(input: { docsRoot?: string } = {}): void {
	const docsRoot = input.docsRoot ?? DOCS_ROOT;
	for (const collection of SCAFFOLD_COLLECTIONS) {
		const collectionDir = resolve(docsRoot, collection.dirName);
		mkdirSync(collectionDir, { recursive: true });
		writeFileIfMissing(resolve(collectionDir, "_meta.json"), "[]\n");
		writeFileIfMissing(resolve(collectionDir, "index.md"), buildCollectionIndex(collection));
	}
}

function writeFileIfMissing(path: string, content: string): void {
	if (existsSync(path)) {
		return;
	}
	writeFileSync(path, content, "utf-8");
}

function buildCollectionIndex(collection: ScaffoldCollection): string {
	return [
		"---",
		`title: ${collection.title}`,
		`description: ${collection.description}`,
		"footer: false",
		'readerProfile: "collectionLanding"',
		'readerOutline: "none"',
		"outline: false",
		"---",
		"",
		collection.description,
		"",
		"运行 `pnpm --filter public-docs sync:real-docs` 生成本地公开阅读内容。",
		"",
	].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	ensurePublicDocsScaffold();
}
