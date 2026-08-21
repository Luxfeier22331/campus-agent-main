import { createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createDocsRouter, DocsRouterProvider } from "../src/app/docs-router";
import {
	type DocsDataSource,
	type DocsDocumentRouteData,
	documentPath,
} from "../src/features/docs/data-source";
import { createLargeDocsSiteIndex } from "./helpers/docs-site-index-fixture";

describe("docs router", () => {
	it("returns 404 for retired corpus and collection directories", async () => {
		for (const path of [
			"/docs/curriculum",
			"/docs/regulations",
			"/docs/curriculum/undergraduate",
		]) {
			const router = createDocsRouter({
				docsDataSource: createDocsDataSource(),
				history: createMemoryHistory({ initialEntries: [path] }),
			});

			await router.load();

			expect(router.state.location.pathname).toBe(path);
			expect(router.state.matches.some((match) => match._notFound)).toBe(true);
		}
	});

	it("redirects retired document addresses declared by the source catalog", async () => {
		const target = "/docs/regulations/student_rules/document-01";
		const redirects = [
			{
				fromPath: "/docs/regulations/student_rules/retired-attendance",
				statusCode: 308 as const,
				toPath: target,
			},
		];
		const router = createDocsRouter({
			docsDataSource: createDocsDataSource([...redirects]),
			history: createMemoryHistory({
				initialEntries: ["/docs/regulations/student_rules/retired-attendance"],
			}),
		});

		await router.load();

		expect(router.state.location.pathname).toBe(target);
		expect(redirects[0]?.statusCode).toBe(308);
		expect(router.state.matches.at(-1)?.status).toBe("success");
	});

	it("retries a failed document route without reloading the page", async () => {
		const baseDataSource = createDocsDataSource();
		let available = false;
		const loadDirectory = vi.fn(async () => {
			if (!available) {
				throw new Error("docs unavailable");
			}
			return baseDataSource.loadDirectory();
		});
		const router = createDocsRouter({
			docsDataSource: { ...baseDataSource, loadDirectory },
			history: createMemoryHistory({ initialEntries: ["/docs"] }),
		});

		await router.load();
		render(createElement(DocsRouterProvider, { router }));
		await screen.findByRole("heading", { name: "文档暂时无法加载" });
		const failedAttempts = loadDirectory.mock.calls.length;

		available = true;
		fireEvent.click(screen.getByRole("button", { name: "重试" }));

		await waitFor(() =>
			expect(router.state.matches.some((match) => match.status === "error")).toBe(false),
		);
		expect(loadDirectory.mock.calls.length).toBeGreaterThan(failedAttempts);
		expect(screen.queryByRole("heading", { name: "文档暂时无法加载" })).toBeNull();
	});
});

function createDocsDataSource(
	redirects: ReturnType<typeof createLargeDocsSiteIndex>["redirects"] = [],
): DocsDataSource {
	const siteIndex = { ...createLargeDocsSiteIndex(), redirects };
	return {
		async loadDirectory() {
			return { kind: "directory", siteIndex };
		},
		async loadDocument(target) {
			const path = documentPath(target);
			const collection = siteIndex.collections.find((item) =>
				item.documents.some((document) =>
					document.versions.some((version) => version.canonicalUrl === path),
				),
			);
			const document = collection?.documents.find((item) =>
				item.versions.some((version) => version.canonicalUrl === path),
			);
			const version = document?.versions.find((item) => item.canonicalUrl === path);
			if (!(collection && document && version)) {
				throw new Error(`test document is missing: ${path}`);
			}
			return {
				canonicalUrl: version.canonicalUrl,
				collection: collection.collection,
				collectionLabel: collection.label,
				corpus: collection.corpus,
				courseMaps: [],
				description: "测试文档。",
				docId: document.docId,
				documentSlug: document.documentSlug,
				isCurrent: version.isCurrent,
				kind: "document",
				reader: null,
				readerUrl: version.readerUrl,
				routeSlug: target.routeSlug,
				siteIndex,
				sourceLabel: version.sourceLabel,
				title: document.title,
				topicId: document.topicId,
				topicLabel:
					siteIndex.topics.find(
						(item) => item.corpus === collection.corpus && item.topicId === document.topicId,
					)?.displayName ?? null,
				versionLabel: version.label,
				versionSlug: version.versionSlug,
				versions: document.versions.map((item) => ({
					canonicalUrl: item.canonicalUrl,
					isCurrent: item.isCurrent,
					label: item.label,
					versionSlug: item.versionSlug,
				})),
			} satisfies DocsDocumentRouteData;
		},
	};
}
