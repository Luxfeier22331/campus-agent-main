import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StaticSearchSuggestion } from "../src/search/static-search-suggestions";

vi.mock("virtual-page-data", () => ({
	searchIndexHash: { "default###zh": "hash" },
}));

describe("public docs search hook", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it("does not hide docs API failures with static search suggestions", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("search_index.default.zh.hash.json")) {
				return new Response(
					JSON.stringify([
						{
							content: "第一条 奖学金评审。",
							routePath: "/docs/regulations/student_rules/national-scholarship",
							title: "国家奖学金评审办法",
							toc: [{ charIndex: 0, id: "第一条", text: "第一条" }],
						},
					]),
					{ status: 200 },
				);
			}
			if (url.includes("/api/docs/collections/")) {
				return new Response("docs api unavailable", { status: 503 });
			}
			throw new Error(`unexpected fetch URL: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("document", {
			querySelector: () => ({
				src: "https://docs.example.com/static/js/main.js",
			}),
		});
		vi.stubGlobal("window", { location: { href: "https://docs.example.com/docs/" } });

		const { onSearch } = await import("../src/search/docs-search-hook");
		const matchedResult: SearchGroup[] = [];

		await onSearch("奖学金", matchedResult);

		expect(matchedResult).toEqual([]);
	});

	it("uses static search suggestions only after docs API returns successfully with no hits", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("search_index.default.zh.hash.json")) {
				return new Response(
					JSON.stringify([
						{
							content: "第一条 奖学金评审。",
							routePath: "/docs/regulations/student_rules/national-scholarship",
							title: "国家奖学金评审办法",
							toc: [{ charIndex: 0, id: "第一条", text: "第一条" }],
						},
					]),
					{ status: 200 },
				);
			}
			if (url.includes("/api/docs/collections/")) {
				return new Response(JSON.stringify({ query: "奖学金", results: [] }), { status: 200 });
			}
			throw new Error(`unexpected fetch URL: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("document", {
			querySelector: () => ({
				src: "https://docs.example.com/static/js/main.js",
			}),
		});
		vi.stubGlobal("window", { location: { href: "https://docs.example.com/docs/" } });

		const { onSearch } = await import("../src/search/docs-search-hook");
		const matchedResult: SearchGroup[] = [];

		await onSearch("奖学金", matchedResult);

		expect(matchedResult[0]).toMatchObject({
			group: "Campus Agent 文档站",
			renderType: "default",
		});
		expect(matchedResult[0]?.result).toHaveLength(2);
	});
});

interface SearchGroup {
	group: string;
	renderType: "default";
	result: StaticSearchSuggestion[];
}
