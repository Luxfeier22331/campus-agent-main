import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { CampusPageMetadataHead } from "../src/app/page-metadata-head";
import { DocsPage } from "../src/components/docs/docs-page-view";
import type { DocsDirectoryRouteData } from "../src/features/docs/data-source";
import { createLargeDocsSiteIndex } from "./helpers/docs-site-index-fixture";

const DIRECTORY_DATA: DocsDirectoryRouteData = {
	kind: "directory",
	siteIndex: createLargeDocsSiteIndex(),
};

afterEach(() => {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

describe("campus page metadata head", () => {
	it("removes React-owned metadata while preserving the host title", () => {
		document.head.innerHTML = "<title>Campus UI</title>";
		const view = render(
			<CampusPageMetadataHead
				metadata={{
					canonicalPath: "/docs",
					description: "中央民族大学校园文档。",
					robots: "index,follow",
					title: "校园文档 | 中央民族大学校园问答",
				}}
			/>,
		);

		expect(document.title).toBe("校园文档 | 中央民族大学校园问答");
		expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute(
			"content",
			"中央民族大学校园文档。",
		);
		expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
			"href",
			"https://campus.muc.wiki/docs",
		);

		view.unmount();

		expect(document.title).toBe("Campus UI");
		expect(document.head.querySelector('meta[name="description"]')).toBeNull();
		expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
	});

	it("adopts the static canonical and updates or removes it across route remounts", async () => {
		document.head.innerHTML = '<link rel="canonical" href="https://campus.muc.wiki/docs">';
		const staticCanonical = document.head.querySelector('link[rel="canonical"]');
		const container = document.createElement("div");
		document.body.appendChild(container);
		const errors: unknown[] = [];
		function head(path: string | null, key: string) {
			return (
				<StrictMode>
					<CampusPageMetadataHead
						key={key}
						metadata={{
							canonicalPath: path,
							description: "文档",
							robots: "index,follow",
							title: "文档",
						}}
					/>
				</StrictMode>
			);
		}
		let root!: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, head("/docs", "directory"), {
				onRecoverableError: (error) => errors.push(error),
			});
		});
		try {
			expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
			expect(document.head.querySelector('link[rel="canonical"]')).toBe(staticCanonical);
			for (const [key, path] of [
				["document", "/docs/regulations/student_rules/rules"],
				["history", "/docs/regulations/student_rules/rules/v/2025"],
				["directory", "/docs"],
				["public-app", "/map"],
				["private-app", null],
				["public-again", "/docs"],
			] as const) {
				await act(async () => root.render(head(path, key)));
				expect(
					[...document.head.querySelectorAll('link[rel="canonical"]')].map((link) =>
						link.getAttribute("href"),
					),
				).toEqual(path === null ? [] : [`https://campus.muc.wiki${path}`]);
			}
			expect(errors).toEqual([]);
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
		expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
	});

	it("allows a docs preview to opt out of page metadata", async () => {
		document.head.innerHTML = "<title>Campus UI</title>";
		const view = await renderDocsPage(false);

		expect(document.title).toBe("Campus UI");
		expect(document.head.querySelector('meta[name="description"]')).toBeNull();
		expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
		expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();

		view.unmount();
	});

	it("renders docs metadata through the same React head component", async () => {
		document.head.innerHTML = "<title>Docs host</title>";
		const view = await renderDocsPage(true);

		expect(document.title).toBe("校园文档 | 中央民族大学校园问答");
		expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
			"content",
			"index,follow",
		);
		expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);

		view.unmount();
		expect(document.title).toBe("Docs host");
	});
});

async function renderDocsPage(renderMetadata: boolean) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const docsRoute = createRoute({
		component: () => <DocsPage data={DIRECTORY_DATA} renderMetadata={renderMetadata} />,
		getParentRoute: () => rootRoute,
		path: "/",
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: ["/"] }),
		routeTree: rootRoute.addChildren([docsRoute]),
	});
	await router.load();
	return render(<RouterProvider router={router} />);
}
