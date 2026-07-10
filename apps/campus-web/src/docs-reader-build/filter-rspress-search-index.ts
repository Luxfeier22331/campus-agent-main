import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_CURRENT_SEARCH_VISIBILITY = "public_current";
const SEARCH_INDEX_FILE_PREFIX = "search_index";
export const RSPRESS_LOCAL_SEARCH_STATIC_DIR = "static";

interface RspressSearchPage {
	frontmatter?: Record<string, unknown>;
	[key: string]: unknown;
}

export function filterRspressSearchIndexFile(filePath: string): {
	keptPageCount: number;
	removedPageCount: number;
} {
	const pages = JSON.parse(readFileSync(filePath, "utf8"));
	if (!Array.isArray(pages)) {
		throw new Error(`Rspress search index must be an array: ${filePath}`);
	}
	const searchablePages = (pages as RspressSearchPage[])
		.filter((page) => page?.frontmatter?.docsSearchVisibility === PUBLIC_CURRENT_SEARCH_VISIBILITY)
		.map((page) => ({
			...page,
			frontmatter: filterPublicSearchFrontmatter(page.frontmatter),
		}));
	writeFileSync(filePath, `${JSON.stringify(searchablePages)}\n`, "utf8");
	return {
		keptPageCount: searchablePages.length,
		removedPageCount: pages.length - searchablePages.length,
	};
}

export function filterRspressSearchIndexes(buildRoot: string): {
	files: Array<{ file: string; keptPageCount: number; removedPageCount: number }>;
} {
	const staticDir = resolve(buildRoot, RSPRESS_LOCAL_SEARCH_STATIC_DIR);
	const searchIndexFiles = readdirSync(staticDir)
		.filter((name) => name.startsWith(SEARCH_INDEX_FILE_PREFIX) && name.endsWith(".json"))
		.sort();
	if (searchIndexFiles.length === 0) {
		throw new Error(`Rspress search index files are missing under: ${staticDir}`);
	}
	const results = searchIndexFiles.map((name) => ({
		file: name,
		...filterRspressSearchIndexFile(join(staticDir, name)),
	}));
	return { files: results };
}

function filterPublicSearchFrontmatter(frontmatter: unknown): Record<string, unknown> {
	if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
		return { docsSearchVisibility: PUBLIC_CURRENT_SEARCH_VISIBILITY };
	}
	const record = frontmatter as Record<string, unknown>;
	return {
		docsSearchVisibility: PUBLIC_CURRENT_SEARCH_VISIBILITY,
		documentKind: record.documentKind,
		readerLayout: record.readerLayout,
		readerMeasure: record.readerMeasure,
		readerOutline: record.readerOutline,
	};
}

function main(): void {
	const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
	const buildRoot = process.argv[2]?.trim() || join(appRoot, "doc_build");
	console.log(JSON.stringify(filterRspressSearchIndexes(buildRoot)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	}
}
