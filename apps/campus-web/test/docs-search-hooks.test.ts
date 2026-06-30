import { afterEach, describe, expect, it, vi } from "vitest";

import { onSearch } from "../src/docs/search/rspress-search-hooks";

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

	it("ignores non-json protected index responses without throwing", async () => {
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

		await expect(onSearch("光电", [])).resolves.toEqual([]);
	});

	it("requests protected indexes for gated reader bootstrap pages", async () => {
		setPathname("/docs/curriculum/curriculum_plan/restricted-program");
		renderReaderMeta({
			documentSlug: "restricted-program",
			versionSlug: "2026-current",
			visibility: "gated_bootstrap",
		});
		const fetchSpy = vi.fn(
			async () =>
				new Response(
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
				),
		);
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
});
