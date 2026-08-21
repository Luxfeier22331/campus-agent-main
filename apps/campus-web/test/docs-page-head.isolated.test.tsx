import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
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
		expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "/docs");

		view.unmount();

		expect(document.title).toBe("Campus UI");
		expect(document.head.querySelector('meta[name="description"]')).toBeNull();
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
