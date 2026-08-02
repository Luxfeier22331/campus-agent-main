import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocsShell, DocsTree } from "../src/components/docs/docs-shell";
import { createLargeDocsSiteIndex } from "./helpers/docs-site-index-fixture";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("docs navigation tree", () => {
	it("keeps a 128-document hierarchy compact and reveals the active document", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const activeCollection = siteIndex.collections[1];
		const activeDocument = activeCollection?.documents[25];
		if (!(activeCollection && activeDocument)) {
			throw new Error("large docs fixture is incomplete");
		}
		const scrollIntoView = vi
			.spyOn(Element.prototype, "scrollIntoView")
			.mockImplementation(() => undefined);

		await renderTree(siteIndex, activeDocument.canonicalUrl);

		expect(screen.getByText("规章制度", { selector: ".docs-tree-corpus" })).toBeInTheDocument();
		expect(screen.getByText("培养方案", { selector: ".docs-tree-corpus" })).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "规章制度" })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "培养方案" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: activeDocument.title })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.queryByRole("link", { name: "学生手册文档 01" })).not.toBeInTheDocument();
		expect(screen.getAllByRole("link").length).toBeLessThan(45);
		await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
	});

	it("expands every document group on the docs index without using directory links", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const collection = siteIndex.collections[2];
		if (!collection) {
			throw new Error("large docs fixture is incomplete");
		}

		await renderTree(siteIndex, "/docs");

		expect(screen.queryByRole("link", { name: collection.label })).not.toBeInTheDocument();
		const toggle = screen.getByRole("button", { name: collection.label });
		expect(toggle).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("link", { name: `${collection.label}文档 01` })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: `${collection.label}文档 32` })).toBeInTheDocument();
		for (const label of ["学生手册", "校级规章", "二学位培养方案", "通识教育", "专项规章"]) {
			expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-expanded", "true");
		}
	});

	it("orders curriculum collections by study stage instead of identifier", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		await renderTree(siteIndex, "/docs");

		const labels = [...document.querySelectorAll(".docs-tree-corpus, .docs-tree-collection")]
			.map((item) => item.textContent?.trim())
			.filter((label) =>
				["培养方案", "本科培养方案", "二学位培养方案", "通识教育"].includes(label ?? ""),
			);

		expect(labels).toEqual(["培养方案", "本科培养方案", "二学位培养方案", "通识教育"]);
	});

	it("lets readers collapse and reopen a collection without changing routes", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		await renderTree(siteIndex, "/docs");

		expect(screen.getByRole("link", { name: "本科培养方案文档 01" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "本科培养方案" }));
		expect(screen.queryByRole("link", { name: "本科培养方案文档 01" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "本科培养方案" })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		fireEvent.click(screen.getByRole("button", { name: "本科培养方案" }));
		expect(screen.getByRole("link", { name: "本科培养方案文档 26" })).toBeInTheDocument();
		expect(screen.queryByRole("searchbox", { name: /筛选.*文档/u })).not.toBeInTheDocument();
	});

	it("preserves a manual collapse when the document index is refreshed", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const rootRoute = createRootRoute({
			component: () => {
				const [currentSiteIndex, setCurrentSiteIndex] = useState(siteIndex);
				return (
					<>
						<button onClick={() => setCurrentSiteIndex(createLargeDocsSiteIndex())} type="button">
							刷新目录
						</button>
						<DocsTree activePath="/docs" siteIndex={currentSiteIndex} />
					</>
				);
			},
		});
		const router = createRouter({
			history: createMemoryHistory({ initialEntries: ["/"] }),
			routeTree: rootRoute,
		});
		await router.load();
		render(<RouterProvider router={router} />);

		const toggle = await screen.findByRole("button", { name: "本科培养方案" });
		fireEvent.click(toggle);
		expect(toggle).toHaveAttribute("aria-expanded", "false");

		fireEvent.click(screen.getByRole("button", { name: "刷新目录" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "本科培养方案" })).toHaveAttribute(
				"aria-expanded",
				"false",
			);
		});
		expect(screen.queryByRole("link", { name: "本科培养方案文档 01" })).not.toBeInTheDocument();
	});

	it("scrolls the new active document into view when navigating within one collection", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const collection = siteIndex.collections[1];
		const firstDocument = collection?.documents[1];
		const nextDocument = collection?.documents[24];
		if (!(firstDocument && nextDocument)) {
			throw new Error("large docs fixture is incomplete");
		}
		const scrollIntoView = vi
			.spyOn(Element.prototype, "scrollIntoView")
			.mockImplementation(() => undefined);

		const rootRoute = createRootRoute({
			component: () => {
				const [activePath, setActivePath] = useState(firstDocument.canonicalUrl);
				return (
					<>
						<button onClick={() => setActivePath(nextDocument.canonicalUrl)} type="button">
							切换文档
						</button>
						<DocsTree activePath={activePath} siteIndex={siteIndex} />
					</>
				);
			},
		});
		const router = createRouter({
			history: createMemoryHistory({ initialEntries: ["/"] }),
			routeTree: rootRoute,
		});
		await router.load();
		render(<RouterProvider router={router} />);
		await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
		scrollIntoView.mockClear();

		fireEvent.click(screen.getByRole("button", { name: "切换文档" }));

		await waitFor(() => {
			expect(screen.getByRole("link", { name: nextDocument.title })).toHaveAttribute(
				"aria-current",
				"page",
			);
			expect(scrollIntoView).toHaveBeenCalledTimes(1);
		});
	});
});

describe("docs page outline", () => {
	it("keeps the active heading link in view", async () => {
		const callbacks: IntersectionObserverCallback[] = [];
		class TestIntersectionObserver implements IntersectionObserver {
			readonly root = null;
			readonly rootMargin = "0px";
			readonly thresholds = [0];

			constructor(callback: IntersectionObserverCallback) {
				callbacks.push(callback);
			}

			disconnect = vi.fn();
			observe = vi.fn();
			takeRecords(): IntersectionObserverEntry[] {
				return [];
			}
			unobserve = vi.fn();
		}
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
		const scrollIntoView = vi
			.spyOn(Element.prototype, "scrollIntoView")
			.mockImplementation(() => undefined);
		const siteIndex = createLargeDocsSiteIndex();
		const outline = [
			{ anchor: "first-heading", level: 2, title: "第一节" },
			{ anchor: "later-heading", level: 2, title: "后续章节" },
		] as const;
		const rootRoute = createRootRoute({
			component: () => (
				<DocsShell activePath="/docs" outline={outline} siteIndex={siteIndex}>
					<h2 id="first-heading">第一节</h2>
					<h2 id="later-heading">后续章节</h2>
				</DocsShell>
			),
		});
		const router = createRouter({
			history: createMemoryHistory({ initialEntries: ["/"] }),
			routeTree: rootRoute,
		});
		await router.load();
		render(<RouterProvider router={router} />);
		expect(callbacks).not.toHaveLength(0);
		scrollIntoView.mockClear();

		const laterHeading = screen.getByRole("heading", { name: "后续章节" });
		const bounds: DOMRectReadOnly = {
			bottom: 140,
			height: 20,
			left: 0,
			right: 100,
			top: 120,
			width: 100,
			x: 0,
			y: 120,
			toJSON: () => ({}),
		};
		const entry: IntersectionObserverEntry = {
			boundingClientRect: bounds,
			intersectionRatio: 1,
			intersectionRect: bounds,
			isIntersecting: true,
			rootBounds: null,
			target: laterHeading,
			time: 0,
		};
		act(() => {
			for (const callback of callbacks) {
				callback([entry], {} as IntersectionObserver);
			}
		});

		await waitFor(() => {
			expect(screen.getByRole("link", { name: "后续章节" })).toHaveAttribute(
				"aria-current",
				"location",
			);
			expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
		});
	});
});

async function renderTree(
	siteIndex: ReturnType<typeof createLargeDocsSiteIndex>,
	activePath: string,
) {
	const rootRoute = createRootRoute({
		component: () => <DocsTree activePath={activePath} siteIndex={siteIndex} />,
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: ["/"] }),
		routeTree: rootRoute,
	});
	await router.load();
	return render(<RouterProvider router={router} />);
}
