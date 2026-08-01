import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocsPage } from "../src/app/routes/docs-page";
import type { DocsDirectoryRouteData } from "../src/features/docs/data-source";
import { createLargeDocsSiteIndex } from "./helpers/docs-site-index-fixture";

afterEach(() => {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	window.history.replaceState(null, "", "/");
	vi.restoreAllMocks();
});

describe("docs start page", () => {
	it("keeps the root page light and leaves document browsing to the navigation tree", async () => {
		await renderDirectory({
			kind: "directory",
			siteIndex: createLargeDocsSiteIndex(),
		});

		expect(screen.getByRole("heading", { level: 1, name: "校园文档" })).toBeVisible();
		expect(screen.getByText("192 篇公开文档")).toBeVisible();
		expect(screen.queryByRole("link", { name: /^培养方案/u })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /本科培养方案文档 01/u })).not.toBeInTheDocument();
	});
});

async function renderDirectory(data: DocsDirectoryRouteData) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const directoryRoute = createRoute({
		component: () => <DocsPage data={data} />,
		getParentRoute: () => rootRoute,
		loader: () => data,
		path: "/",
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: ["/"] }),
		routeTree: rootRoute.addChildren([directoryRoute]),
	});
	await router.load();
	render(<RouterProvider router={router} />);
}
