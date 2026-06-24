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
});
