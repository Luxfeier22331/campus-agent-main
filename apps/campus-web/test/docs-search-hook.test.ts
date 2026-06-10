import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchSuggestion } from "../src/docs/search/docs-api-search-core";

vi.mock("virtual-page-data", () => ({
	searchIndexHash: { "default###zh": "hash" },
}));

interface SearchGroup {
	group: string;
	renderType: "default";
	result: SearchSuggestion[];
}

describe("campus docs Rspress search hook", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it("replaces local Rspress matches with app-api canonical search results", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("search_index.default.zh.hash.json")) {
				return new Response(
					JSON.stringify([
						{
							content: "奖学金评审。",
							routePath: "/docs/regulations/student_rules/national-scholarship",
							title: "国家奖学金评审办法",
							toc: [{ charIndex: 0, id: "scholarship", text: "奖学金" }],
						},
						{
							content: "培养方案。",
							routePath: "/docs/curriculum/curriculum_plan/law",
							title: "法学培养方案",
							toc: [{ charIndex: 0, id: "semester-4", text: "第四学期" }],
						},
					]),
					{ status: 200 },
				);
			}
			if (url.includes("/api/docs/collections/regulations/student_rules/search")) {
				return new Response(
					JSON.stringify({
						query: "奖学金",
						results: [
							{
								anchor: "scholarship",
								canonicalUrl:
									"/docs/regulations/student_rules/national-scholarship?hl=root-a#scholarship",
								documentTitle: "国家奖学金评审办法",
								highlightRootUnitIds: ["root-a"],
								kind: "section_hit",
								snippet: "奖学金评定需要满足对应条件。",
								title: "奖学金评定",
							},
						],
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				);
			}
			if (url.includes("/api/docs/collections/curriculum/curriculum_plan/search")) {
				return new Response(JSON.stringify({ query: "奖学金", results: [] }), {
					headers: { "content-type": "application/json" },
					status: 200,
				});
			}
			throw new Error(`unexpected fetch URL: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("document", {
			querySelector: () => ({
				src: "https://campus.muc.wiki/static/js/main.js",
			}),
		});
		vi.stubGlobal("window", { location: { href: "https://campus.muc.wiki/docs/" } });

		const { onSearch } = await import("../src/docs/search/docs-search-hook");
		const matchedResult: SearchGroup[] = [
			{
				group: "默认搜索",
				renderType: "default",
				result: [
					{
						header: "本地结果",
						highlightInfoList: [{ length: 3, start: 0 }],
						link: "/docs/local",
						query: "奖学金",
						title: "本地结果",
						type: "content",
					},
				],
			},
		];

		await onSearch("奖学金", matchedResult);

		expect(matchedResult).toEqual([
			{
				group: "文档命中",
				renderType: "default",
				result: [
					expect.objectContaining({
						header: "国家奖学金评审办法 > 奖学金评定",
						link: "/docs/regulations/student_rules/national-scholarship?hl=root-a#scholarship",
						statement: "奖学金评定需要满足对应条件。",
						title: "国家奖学金评审办法",
					}),
				],
			},
		]);
	});

	it("clears local matches when app-api search fails closed", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("search_index.default.zh.hash.json")) {
				return new Response(
					JSON.stringify([
						{
							content: "奖学金评审。",
							routePath: "/docs/regulations/student_rules/national-scholarship",
							title: "国家奖学金评审办法",
							toc: [{ charIndex: 0, id: "scholarship", text: "奖学金" }],
						},
					]),
					{ status: 200 },
				);
			}
			if (url.includes("/api/docs/collections/")) {
				return new Response("unavailable", { status: 503 });
			}
			throw new Error(`unexpected fetch URL: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("document", {
			querySelector: () => ({
				src: "https://campus.muc.wiki/static/js/main.js",
			}),
		});
		vi.stubGlobal("window", { location: { href: "https://campus.muc.wiki/docs/" } });

		const { onSearch } = await import("../src/docs/search/docs-search-hook");
		const matchedResult: SearchGroup[] = [
			{
				group: "默认搜索",
				renderType: "default",
				result: [
					{
						header: "本地结果",
						highlightInfoList: [{ length: 3, start: 0 }],
						link: "/docs/local",
						query: "奖学金",
						title: "本地结果",
						type: "content",
					},
				],
			},
		];

		await onSearch("奖学金", matchedResult);

		expect(matchedResult).toEqual([]);
	});
});
