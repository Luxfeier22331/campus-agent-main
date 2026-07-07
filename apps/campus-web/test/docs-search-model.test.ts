import type { DefaultMatchResultItem } from "@rspress/core/theme";
import { describe, expect, it } from "vitest";

import type { DocsProtectedSearchIndex } from "../src/docs/search/docs-search-model";
import {
	filterRspressLiteralResults,
	normalizeDocsSearchQuery,
	parseDocsProtectedSearchIndexPayload,
	searchProtectedDocsIndex,
} from "../src/docs/search/docs-search-model";

describe("docs search model", () => {
	it("normalizes only literal Chinese queries without alias expansion", () => {
		expect(normalizeDocsSearchQuery("　培养，计划  ")).toBe("培养计划");
		expect(normalizeDocsSearchQuery("转系")).toBe("转系");
		expect(normalizeDocsSearchQuery("")).toBe("");
	});

	it("filters Rspress results to literal contiguous matches", () => {
		const groups: Array<{ result: DefaultMatchResultItem[] }> = [
			{
				result: [
					{
						header: "培养方案",
						highlightInfoList: [],
						link: "/docs/a",
						query: "培养计划",
						statement: "培养方案中列出课程计划。",
						title: "培养方案",
						type: "content",
					},
					{
						header: "培养计划",
						highlightInfoList: [],
						link: "/docs/b",
						query: "培养计划",
						statement: "培养计划适用于本专业。",
						title: "培养计划",
						type: "content",
					},
				],
			},
		];

		filterRspressLiteralResults("培养计划", groups);

		expect(groups[0]?.result).toHaveLength(1);
		expect(groups[0]?.result[0]?.link).toBe("/docs/b");
	});

	it("parses only protected static search indexes", () => {
		const index = parseDocsProtectedSearchIndexPayload({
			entries: [
				{
					anchor: "restricted",
					canonicalUrl: "/docs/regulations/student_rules/restricted-policy",
					collection: "student_rules",
					collectionLabel: "学生规则",
					corpus: "regulations",
					documentSlug: "restricted-policy",
					documentTitle: "受限制度",
					highlightRootUnitIds: ["restricted-root"],
					searchText: "受限制度 受限章节 这是一条受限正文。",
					searchUnitId: "search_gated_current_restricted",
					sectionTitle: "受限章节",
					snippet: "这是一条受限正文。",
					versionSlug: "2026-current",
				},
			],
			schemaVersion: "campus_docs_protected_search_index_v1",
			visibilityMode: "principal_protected_static",
		});

		expect(index.entries).toHaveLength(1);
		expect(index.entries[0]?.documentTitle).toBe("受限制度");
		expect(() =>
			parseDocsProtectedSearchIndexPayload({
				entries: [],
				schemaVersion: "campus_docs_protected_search_index_v1",
				visibilityMode: "anonymous_static",
			}),
		).toThrow("protected docs search index payload is invalid");
	});

	it("rejects protected search entries that point outside the docs reader path", () => {
		for (const canonicalUrl of [
			"https://evil.example/docs/regulations/student_rules/restricted-policy",
			"//evil.example/docs/regulations/student_rules/restricted-policy",
			"/account/login",
			"/docs/regulations/student_rules/restricted-policy?redirect=https://evil.example",
			"/docs/regulations/student_rules/restricted-policy#restricted",
		]) {
			expect(() =>
				parseDocsProtectedSearchIndexPayload({
					entries: [
						{
							...createProtectedIndex().entries[0],
							canonicalUrl,
						},
					],
					schemaVersion: "campus_docs_protected_search_index_v1",
					visibilityMode: "principal_protected_static",
				}),
			).toThrow("protected docs search entry canonicalUrl is invalid");
		}
	});

	it("searches protected indexes locally and returns reader permalinks", () => {
		const results = searchProtectedDocsIndex("受限正文", createProtectedIndex());

		expect(results).toEqual([
			{
				documentTitle: "受限制度",
				excerpt: "这是一条受限正文。",
				kind: "result",
				sectionTitle: "受限章节",
				url: "/docs/regulations/student_rules/restricted-policy?hl=restricted-root#restricted",
			},
		]);
	});

	it("does not return protected results for non-literal aliases", () => {
		const results = searchProtectedDocsIndex("转系", {
			...createProtectedIndex(),
			entries: [
				{
					...createProtectedIndex().entries[0],
					documentTitle: "转专业规定",
					searchText: "转专业规定",
					sectionTitle: "转专业",
					snippet: "学生可以申请转专业。",
				},
			],
		});

		expect(results).toEqual([]);
	});
});

function createProtectedIndex(): DocsProtectedSearchIndex {
	return {
		entries: [
			{
				anchor: "restricted",
				canonicalUrl: "/docs/regulations/student_rules/restricted-policy",
				collection: "student_rules",
				collectionLabel: "学生规则",
				corpus: "regulations",
				documentSlug: "restricted-policy",
				documentTitle: "受限制度",
				highlightRootUnitIds: ["restricted-root"],
				searchText: "受限制度 受限章节 这是一条受限正文。",
				searchUnitId: "search_gated_current_restricted",
				sectionTitle: "受限章节",
				snippet: "这是一条受限正文。",
				versionSlug: "2026-current",
			},
		],
		generatedAt: null,
		schemaVersion: "campus_docs_protected_search_index_v1",
		visibilityMode: "principal_protected_static",
	};
}
