// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { filterRspressSearchIndexes } from "../scripts/filter-rspress-search-index.mjs";

let tempDir: string | null = null;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { force: true, recursive: true });
		tempDir = null;
	}
});

describe("Rspress public search index filter", () => {
	it("keeps only public-current pages and strips non-search frontmatter", () => {
		tempDir = mkdtempSync(join(tmpdir(), "campus-docs-rspress-search-"));
		const staticDir = join(tempDir, "static");
		mkdirSync(staticDir, { recursive: true });
		const searchIndexPath = join(staticDir, "search_index.zh.test.json");
		writeFileSync(
			searchIndexPath,
			JSON.stringify([
				{
					content: "公开正文",
					frontmatter: {
						docsSearchVisibility: "public_current",
						documentKind: "publicRegulation",
						title: "公开标题",
					},
					routePath: "/docs/public",
					title: "公开标题",
					toc: [],
				},
				{
					content: "",
					frontmatter: {
						docsSearchVisibility: "gated_bootstrap",
						title: "受限标题",
					},
					routePath: "/docs/restricted",
					title: "",
					toc: [],
				},
				{
					content: "",
					frontmatter: {
						docsSearchVisibility: "noindex",
						title: "目录",
					},
					routePath: "/docs",
					title: "",
					toc: [],
				},
			]),
			"utf8",
		);

		const result = filterRspressSearchIndexes(tempDir);
		const filtered = JSON.parse(readFileSync(searchIndexPath, "utf8")) as Array<{
			frontmatter: Record<string, unknown>;
			routePath: string;
		}>;

		expect(result.files).toEqual([
			{
				file: "search_index.zh.test.json",
				keptPageCount: 1,
				removedPageCount: 2,
			},
		]);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.routePath).toBe("/docs/public");
		expect(filtered[0]?.frontmatter).toEqual({
			docsSearchVisibility: "public_current",
			documentKind: "publicRegulation",
		});
	});
});
