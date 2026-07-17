import { afterEach, describe, expect, it, vi } from "vitest";

import {
	clearProtectedSearchIndexCache,
	onSearch,
	prioritizeProtectedSearchResults,
} from "../src/docs/search/rspress-search-hooks";

const originalFetch = globalThis.fetch;
const originalLocation = window.location;

afterEach(() => {
	document.body.innerHTML = "";
	globalThis.fetch = originalFetch;
	Object.defineProperty(window, "location", {
		configurable: true,
		value: originalLocation,
	});
	vi.restoreAllMocks();
	clearProtectedSearchIndexCache();
});

function setPathname(pathname: string): void {
	Object.defineProperty(window, "location", {
		configurable: true,
		value: { ...originalLocation, pathname },
	});
}

function renderReaderMeta(input: {
	documentSlug: string;
	visibility?: string;
	versionSlug: string;
}): void {
	const element = document.createElement("section");
	element.dataset.docsReaderMeta = "true";
	element.dataset.docsDocumentSlug = input.documentSlug;
	element.dataset.docsVersionSlug = input.versionSlug;
	if (input.visibility) {
		element.dataset.docsSearchVisibility = input.visibility;
	}
	document.body.appendChild(element);
}

describe("Rspress docs search hooks", () => {
	it("shows protected matches first when public search has no results", () => {
		const results = [
			{ group: "中央民族大学校园问答", renderType: "default", result: [] },
			{
				group: "当前账号可见",
				renderType: "custom",
				result: [{ kind: "result", documentTitle: "受保护制度" }],
			},
		];

		prioritizeProtectedSearchResults(results);

		expect(results.map((item) => item.group)).toEqual(["当前账号可见", "中央民族大学校园问答"]);
	});

	it("does not request gated search indexes for public reader pages", async () => {
		setPathname("/docs/curriculum/curriculum_plan/doc-public");
		renderReaderMeta({
			documentSlug: "public-program",
			versionSlug: "2022-current",
			visibility: "public_current",
		});
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy;

		await expect(onSearch("光电", [])).resolves.toEqual([]);

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("does not request gated search indexes for empty queries", async () => {
		setPathname("/docs/curriculum/curriculum_plan/restricted-program");
		renderReaderMeta({
			documentSlug: "restricted-program",
			versionSlug: "2026-current",
			visibility: "gated_bootstrap",
		});
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy;

		await expect(onSearch("  ", [])).resolves.toEqual([]);

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("keeps unauthorized or missing protected index responses invisible", async () => {
		setPathname("/docs/curriculum/curriculum_plan/restricted-program");
		renderReaderMeta({
			documentSlug: "restricted-program",
			versionSlug: "2026-current",
			visibility: "gated_bootstrap",
		});
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(new Response("", { status: 401 }))
			.mockResolvedValueOnce(new Response("", { status: 404 }));
		globalThis.fetch = fetchSpy;

		await expect(onSearch("光电", [])).resolves.toEqual([]);
		clearProtectedSearchIndexCache();
		await expect(onSearch("光电", [])).resolves.toEqual([]);
	});

	it("shows a protected search status when the index response is not JSON", async () => {
		setPathname("/docs/curriculum/curriculum_plan/restricted-program");
		renderReaderMeta({
			documentSlug: "restricted-program",
			versionSlug: "2026-current",
			visibility: "gated_bootstrap",
		});
		globalThis.fetch = vi.fn(
			async () =>
				new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html; charset=utf-8" },
					status: 200,
				}),
		);

		await expect(onSearch("光电", [])).resolves.toEqual([
			{
				group: "当前账号可见",
				result: [
					{
						kind: "status",
						message: "账号可见文档搜索暂不可用",
					},
				],
			},
		]);
	});

	it("does not cache transient protected search failures", async () => {
		setPathname("/docs/curriculum/curriculum_plan/restricted-program");
		renderReaderMeta({
			documentSlug: "restricted-program",
			versionSlug: "2026-current",
			visibility: "gated_bootstrap",
		});
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(new Response("service unavailable", { status: 503 }))
			.mockResolvedValueOnce(createProtectedSearchIndexResponse());
		globalThis.fetch = fetchSpy;

		await expect(onSearch("光电", [])).resolves.toEqual([
			{
				group: "当前账号可见",
				result: [
					{
						kind: "status",
						message: "账号可见文档搜索暂不可用",
					},
				],
			},
		]);
		await expect(onSearch("光电", [])).resolves.toMatchObject([
			{
				group: "当前账号可见",
				result: [
					{
						documentTitle: "光电信息科学与工程培养方案",
						sectionTitle: "培养目标",
					},
				],
			},
		]);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("requests protected indexes for gated reader bootstrap pages", async () => {
		setPathname("/docs/curriculum/curriculum_plan/restricted-program");
		renderReaderMeta({
			documentSlug: "restricted-program",
			versionSlug: "2026-current",
			visibility: "gated_bootstrap",
		});
		const fetchSpy = vi.fn(async () => createProtectedSearchIndexResponse());
		globalThis.fetch = fetchSpy;

		await expect(onSearch("光电", [])).resolves.toMatchObject([
			{
				group: "当前账号可见",
				result: [
					{
						documentTitle: "光电信息科学与工程培养方案",
						sectionTitle: "培养目标",
					},
				],
			},
		]);
		expect(fetchSpy).toHaveBeenCalledWith(
			"/_gated-docs-search/curriculum/curriculum_plan/restricted-program/2026-current/index.json",
			expect.objectContaining({
				credentials: "include",
				headers: { accept: "application/json" },
			}),
		);
	});

	it("caches protected indexes for repeated searches on the same gated page", async () => {
		setPathname("/docs/curriculum/curriculum_plan/restricted-program");
		renderReaderMeta({
			documentSlug: "restricted-program",
			versionSlug: "2026-current",
			visibility: "gated_bootstrap",
		});
		const fetchSpy = vi.fn(async () => createProtectedSearchIndexResponse());
		globalThis.fetch = fetchSpy;

		await onSearch("光电", []);
		await onSearch("培养", []);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});

function createProtectedSearchIndexResponse(): Response {
	return new Response(
		JSON.stringify({
			entries: [
				{
					anchor: "program-root",
					canonicalUrl: "/docs/curriculum/curriculum_plan/restricted-program",
					collection: "curriculum_plan",
					collectionLabel: "培养方案",
					corpus: "curriculum",
					documentSlug: "restricted-program",
					documentTitle: "光电信息科学与工程培养方案",
					highlightRootUnitIds: ["root-1"],
					searchText: "光电 培养方案",
					searchUnitId: "search_unit_1",
					sectionTitle: "培养目标",
					snippet: "光电专业培养方案要求。",
					versionSlug: "2026-current",
				},
			],
			schemaVersion: "campus_docs_protected_search_index_v1",
			visibilityMode: "principal_protected_static",
		}),
		{ headers: { "content-type": "application/json" }, status: 200 },
	);
}
