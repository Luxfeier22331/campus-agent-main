import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { PageIndexInfo, RspressPlugin } from "@rspress/core";

const DEFAULT_MAX_SEARCH_INDEX_BYTES = 400_000;

export interface PublicDocsSearchIndexBudgetResult {
	checkedPageCount: number;
	checkedSearchIndexCount: number;
	ok: true;
}

export function publicDocsSearchIndexBudgetPlugin(): RspressPlugin {
	return {
		name: "public-docs-search-index-budget",
		modifySearchIndexData(data) {
			pruneSearchIndexContent(data);
		},
	};
}

export function pruneSearchIndexContent(pages: PageIndexInfo[]): void {
	for (const page of pages) {
		page.content = "";
		page._flattenContent = "";
	}
}

export function checkPublicDocsSearchIndexBudget(input: {
	buildDir: string;
	maxSearchIndexBytes?: number;
}): PublicDocsSearchIndexBudgetResult {
	const maxSearchIndexBytes = input.maxSearchIndexBytes ?? DEFAULT_MAX_SEARCH_INDEX_BYTES;
	const staticDir = resolve(input.buildDir, "static");
	const searchIndexFiles = readdirSync(staticDir).filter(
		(fileName) => fileName.startsWith("search_index") && fileName.endsWith(".json"),
	);
	if (searchIndexFiles.length === 0) {
		throw new Error(`public docs search index is missing under ${staticDir}`);
	}

	let checkedPageCount = 0;
	for (const fileName of searchIndexFiles) {
		const filePath = resolve(staticDir, fileName);
		const byteLength = statSync(filePath).size;
		if (byteLength > maxSearchIndexBytes) {
			throw new Error(
				`public docs search index exceeds budget: ${fileName} (${byteLength} > ${maxSearchIndexBytes})`,
			);
		}
		const pages = parseSearchIndex(readFileSync(filePath, "utf8"), fileName);
		for (const page of pages) {
			checkedPageCount += 1;
			if (hasUnprunedContent(page)) {
				throw new Error(`public docs search index contains unpruned content: ${fileName}`);
			}
		}
	}

	return {
		checkedPageCount,
		checkedSearchIndexCount: searchIndexFiles.length,
		ok: true,
	};
}

function parseSearchIndex(rawSearchIndex: string, fileName: string): unknown[] {
	const parsed = JSON.parse(rawSearchIndex) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error(`public docs search index must be an array: ${fileName}`);
	}
	return parsed;
}

function hasUnprunedContent(page: unknown): boolean {
	if (!page || typeof page !== "object" || Array.isArray(page)) {
		return false;
	}
	const content = (page as { content?: unknown; _flattenContent?: unknown }).content;
	const flattenedContent = (page as { content?: unknown; _flattenContent?: unknown })
		._flattenContent;
	return (
		(typeof content === "string" && content.length > 0) ||
		(typeof flattenedContent === "string" && flattenedContent.length > 0)
	);
}

function main(): void {
	const buildDir = process.argv[2]
		? resolve(process.argv[2])
		: resolve(import.meta.dirname, "..", "doc_build");
	const result = checkPublicDocsSearchIndexBudget({ buildDir });
	console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
