import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	checkPublicDocsSearchIndexBudget,
	pruneSearchIndexContent,
} from "../scripts/search-index-budget";

function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), "public-docs-search-index-budget-"));
}

function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

describe("public docs search index budget", () => {
	it("keeps only route metadata in the static Rspress search index", () => {
		const pages = [
			{
				_filepath: "/repo/apps/public-docs/docs/docs/regulations/student_rules/rule.mdx",
				_relativePath: "docs/regulations/student_rules/rule.mdx",
				content: "第一条 为规范奖学金评审工作。",
				_flattenContent: "第一条 为规范奖学金评审工作。",
				frontmatter: {},
				lang: "zh",
				routePath: "/docs/regulations/student_rules/rule",
				title: "奖学金评审办法",
				toc: [{ id: "第一条", text: "第一条", depth: 2, charIndex: 0 }],
				version: "",
			},
		];

		pruneSearchIndexContent(pages);

		expect(pages[0]).toMatchObject({
			content: "",
			_flattenContent: "",
			routePath: "/docs/regulations/student_rules/rule",
			title: "奖学金评审办法",
			toc: [{ id: "第一条", text: "第一条" }],
		});
	});

	it("passes when built search index content is pruned and under budget", () => {
		const buildDir = createTempDir();
		writeFile(
			resolve(buildDir, "static/search_index.zh.demo.json"),
			JSON.stringify([
				{
					content: "",
					_flattenContent: "",
					routePath: "/docs/regulations/student_rules/rule",
					title: "奖学金评审办法",
				},
			]),
		);

		expect(checkPublicDocsSearchIndexBudget({ buildDir })).toMatchObject({
			checkedPageCount: 1,
			checkedSearchIndexCount: 1,
			ok: true,
		});
	});

	it("fails when built search index keeps full document content", () => {
		const buildDir = createTempDir();
		writeFile(
			resolve(buildDir, "static/search_index.zh.demo.json"),
			JSON.stringify([
				{
					content: "第一条 为规范奖学金评审工作。",
					routePath: "/docs/regulations/student_rules/rule",
					title: "奖学金评审办法",
				},
			]),
		);

		expect(() => checkPublicDocsSearchIndexBudget({ buildDir })).toThrow(
			"public docs search index contains unpruned content",
		);
	});
});
