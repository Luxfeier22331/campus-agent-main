import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
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
	it("lists every public document without restoring directory routes", async () => {
		await renderDirectory({
			kind: "directory",
			siteIndex: createLargeDocsSiteIndex(),
		});

		expect(screen.getByRole("heading", { level: 1, name: "校园文档" })).toBeVisible();
		expect(screen.getByText("192 篇公开文档")).toBeVisible();
		for (const corpus of ["培养方案", "规章制度"]) {
			expect(screen.getByRole("heading", { level: 2, name: corpus })).toBeVisible();
			expect(screen.queryByRole("link", { name: corpus })).not.toBeInTheDocument();
		}

		const undergraduateSection = screen
			.getByText("本科培养方案", { selector: ".docs-start-section-title" })
			.closest("details");
		expect(undergraduateSection).toHaveAttribute("open");
		expect(
			within(undergraduateSection as HTMLElement).getByRole("link", {
				name: "本科培养方案文档 01",
			}),
		).toHaveAttribute("href", "/docs/curriculum/undergraduate/document-01");
		expect(screen.getByRole("link", { name: "本科培养方案文档 32" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "学生手册文档 01" })).toHaveAttribute(
			"href",
			"/docs/regulations/student_rules/document-01",
		);
		expect(screen.queryByRole("link", { name: "本科培养方案" })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "学生手册" })).not.toBeInTheDocument();
	});

	it("uses the same study-stage and regulation-topic order as the navigation tree", async () => {
		await renderDirectory({
			kind: "directory",
			siteIndex: createLargeDocsSiteIndex(),
		});

		const labels = [...document.querySelectorAll(".docs-start-section-title")].map((item) =>
			item.textContent?.trim(),
		);
		expect(labels).toEqual([
			"本科培养方案",
			"二学位培养方案",
			"通识教育",
			"学生手册",
			"校级规章",
			"专项规章",
		]);
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
