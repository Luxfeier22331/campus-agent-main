import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocsSearchPanel } from "../src/components/docs/docs-search-dialog";
import { type DocsSearchResult, searchDocsIndex } from "../src/features/docs/search";
import type { DocsSearchDocumentGroup } from "../src/features/docs/search-client";
import type { DocsSearchIndex } from "../src/features/docs/site-index";
import { createDocsSearchIndex } from "./helpers/docs-search-index-fixture";
import { createLargeDocsSiteIndex } from "./helpers/docs-site-index-fixture";

const searchClientMock = vi.hoisted(() => ({
	expand: vi.fn(),
	ready: vi.fn<() => Promise<void>>(),
	reset: vi.fn(),
	search: vi.fn(),
}));

vi.mock("@/features/docs/search-client", () => ({
	loadDocsSearchClient: () => searchClientMock,
	resetDocsSearchClient: searchClientMock.reset,
}));

beforeEach(() => {
	searchClientMock.ready.mockReset().mockResolvedValue();
	searchClientMock.expand.mockReset();
	searchClientMock.reset.mockReset();
	searchClientMock.search.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("docs search dialog", () => {
	it("groups every match by document and progressively reveals the complete result set", async () => {
		const largeIndex = createLargeDocsSiteIndex();
		const collection = largeIndex.collections[0];
		if (!collection) {
			throw new Error("docs site fixture is incomplete");
		}
		const siteIndex = {
			...largeIndex,
			collections: [{ ...collection, documents: collection.documents.slice(0, 10) }],
		};
		const searchEntries =
			siteIndex.collections[0]?.documents.flatMap((document) =>
				Array.from({ length: 4 }, (_, index) => ({
					anchor: `section-${index + 1}`,
					docId: document.docId,
					highlightRootUnitIds: [`${document.docId}-root-${index + 1}`],
					searchText: `共同关键词 第 ${index + 1} 节正文`,
					sectionTitle: `第 ${index + 1} 节`,
					snippet: `共同关键词对应的第 ${index + 1} 节正文`,
				})),
			) ?? [];
		const searchIndex = createDocsSearchIndex(searchEntries, siteIndex);
		mockSearchResults(siteIndex, searchIndex);

		await renderSearchPanel(siteIndex);
		fireEvent.change(screen.getByRole("combobox", { name: "搜索校园文档" }), {
			target: { value: "共同关键词" },
		});

		await screen.findByText("10 篇文档");
		expect(screen.getAllByRole("button", { name: "显示全部 4 个章节" })).toHaveLength(8);
		expect(screen.queryByText("学生手册文档 09")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "继续显示文档（剩余 2 篇）" }));
		await screen.findByText("学生手册文档 09");

		const firstExpandButton = screen.getAllByRole("button", { name: "显示全部 4 个章节" })[0];
		if (!firstExpandButton) {
			throw new Error("docs search result expand button is missing");
		}
		fireEvent.click(firstExpandButton);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "收起章节" })).toHaveAttribute(
				"aria-expanded",
				"true",
			),
		);
	});

	it("opens the first result with Enter", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const searchIndex = createSearchIndex(siteIndex, 2);
		mockSearchResults(siteIndex, searchIndex);

		const { router } = await renderSearchPanel(siteIndex);
		const input = screen.getByRole("combobox", { name: "搜索校园文档" });
		fireEvent.change(input, { target: { value: "共同关键词" } });
		const firstOption = await screen.findAllByRole("option");
		const expectedHref = readOptionHref(firstOption[0]);

		fireEvent.keyDown(input, { code: "Enter", key: "Enter" });

		await waitFor(() => expect(router.state.location.href).toBe(expectedHref));
	});

	it("opens the next result with ArrowDown and Enter", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const searchIndex = createSearchIndex(siteIndex, 2);
		mockSearchResults(siteIndex, searchIndex);

		const { router } = await renderSearchPanel(siteIndex);
		const input = screen.getByRole("combobox", { name: "搜索校园文档" });
		fireEvent.change(input, { target: { value: "共同关键词" } });
		const options = await screen.findAllByRole("option");
		const expectedHref = readOptionHref(options[1]);

		fireEvent.keyDown(input, { code: "ArrowDown", key: "ArrowDown" });
		fireEvent.keyDown(input, { code: "Enter", key: "Enter" });

		await waitFor(() => expect(router.state.location.href).toBe(expectedHref));
	});

	it("keeps the latest query results when an earlier worker response arrives late", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const searchIndex = createSearchIndex(siteIndex, 2);
		const responses = new Map<
			string,
			(value: {
				documentGroups: DocsSearchDocumentGroup[];
				documentOffset: number;
				totalDocumentCount: number;
			}) => void
		>();
		searchClientMock.search.mockImplementation(
			({ query }: { query: string }) =>
				new Promise((resolve) => {
					responses.set(query, resolve);
				}),
		);

		await renderSearchPanel(siteIndex);
		const input = screen.getByRole("combobox", { name: "搜索校园文档" });
		fireEvent.change(input, { target: { value: "旧查询" } });
		await waitFor(() => expect(responses.has("旧查询")).toBe(true));
		fireEvent.change(input, { target: { value: "共同关键词" } });
		await waitFor(() => expect(responses.has("共同关键词")).toBe(true));

		responses.get("共同关键词")?.(
			toSearchPage(searchDocsIndex("共同关键词", searchIndex, siteIndex), 0, 8),
		);
		await screen.findByText("2 篇文档");
		responses.get("旧查询")?.({
			documentGroups: [],
			documentOffset: 0,
			totalDocumentCount: 0,
		});

		await waitFor(() => expect(screen.getByText("2 篇文档")).toBeInTheDocument());
		expect(screen.queryByText("没有找到相关文档")).not.toBeInTheDocument();
	});

	it("keeps existing results while a new query is pending or fails", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const searchIndex = createSearchIndex(siteIndex, 2);
		const firstPage = toSearchPage(searchDocsIndex("共同关键词", searchIndex, siteIndex), 0, 8);
		searchClientMock.search
			.mockResolvedValueOnce(firstPage)
			.mockRejectedValueOnce(new Error("search unavailable"));

		await renderSearchPanel(siteIndex);
		const input = screen.getByRole("combobox", { name: "搜索校园文档" });
		fireEvent.change(input, { target: { value: "共同关键词" } });
		await screen.findByText("2 篇文档");

		fireEvent.change(input, { target: { value: "新的关键词" } });
		expect(screen.getByText("2 篇文档")).toBeInTheDocument();
		expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "true");

		await screen.findByText("搜索结果暂时无法更新。");
		expect(screen.getByText("2 篇文档")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
	});

	it("retries search initialization locally", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		searchClientMock.ready
			.mockRejectedValueOnce(new Error("worker unavailable"))
			.mockResolvedValueOnce();

		await renderSearchPanel(siteIndex);
		await screen.findByText("搜索暂时不可用。");
		fireEvent.click(screen.getByRole("button", { name: "重试搜索" }));

		await waitFor(() =>
			expect(searchClientMock.reset).toHaveBeenCalledWith(siteIndex.searchIndexUrl),
		);
		await waitFor(() => expect(screen.queryByText("搜索暂时不可用。")).not.toBeInTheDocument());
	});

	it("searches after a 150ms pause", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const searchIndex = createSearchIndex(siteIndex, 2);
		mockSearchResults(siteIndex, searchIndex);
		await renderSearchPanel(siteIndex);
		vi.useFakeTimers();

		const input = screen.getByRole("combobox", { name: "搜索校园文档" });
		fireEvent.change(input, { target: { value: "共同" } });
		await act(() => vi.advanceTimersByTimeAsync(149));
		expect(searchClientMock.search).not.toHaveBeenCalled();

		fireEvent.change(input, { target: { value: "共同关键词" } });
		await act(() => vi.advanceTimersByTimeAsync(149));
		expect(searchClientMock.search).not.toHaveBeenCalled();
		await act(() => vi.advanceTimersByTimeAsync(1));

		expect(searchClientMock.search).toHaveBeenCalledOnce();
		expect(searchClientMock.search).toHaveBeenCalledWith(
			expect.objectContaining({ query: "共同关键词" }),
		);
	});

	it("searches within 500ms while input keeps changing", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		const searchIndex = createSearchIndex(siteIndex, 2);
		mockSearchResults(siteIndex, searchIndex);
		await renderSearchPanel(siteIndex);
		vi.useFakeTimers();

		const input = screen.getByRole("combobox", { name: "搜索校园文档" });
		for (const value of ["共", "共同", "共同关", "共同关键", "共同关键词"]) {
			fireEvent.change(input, { target: { value } });
			await act(() => vi.advanceTimersByTimeAsync(100));
		}

		expect(searchClientMock.search).toHaveBeenCalledOnce();
		expect(searchClientMock.search).toHaveBeenCalledWith(
			expect.objectContaining({ query: "共同关键词" }),
		);
	});

	it("cancels a pending search when the input is cleared", async () => {
		const siteIndex = createLargeDocsSiteIndex();
		mockSearchResults(siteIndex, createSearchIndex(siteIndex, 2));
		await renderSearchPanel(siteIndex);
		vi.useFakeTimers();

		const input = screen.getByRole("combobox", { name: "搜索校园文档" });
		fireEvent.change(input, { target: { value: "共同关键词" } });
		fireEvent.change(input, { target: { value: "" } });
		await act(() => vi.advanceTimersByTimeAsync(500));

		expect(searchClientMock.search).not.toHaveBeenCalled();
		expect(screen.getByText("输入关键词开始搜索")).toBeInTheDocument();
	});
});

function mockSearchResults(
	siteIndex: ReturnType<typeof createLargeDocsSiteIndex>,
	searchIndex: DocsSearchIndex,
): void {
	searchClientMock.search.mockImplementation(
		async ({
			documentLimit,
			documentOffset,
			query,
		}: {
			documentLimit: number;
			documentOffset: number;
			query: string;
		}) =>
			toSearchPage(searchDocsIndex(query, searchIndex, siteIndex), documentOffset, documentLimit),
	);
	searchClientMock.expand.mockImplementation(async (query: string, docId: string) => {
		const group = groupSearchResults(searchDocsIndex(query, searchIndex, siteIndex)).find(
			(candidate) => candidate.document.docId === docId,
		);
		if (!group) {
			throw new Error(`test search group is missing: ${docId}`);
		}
		return group;
	});
}

function toSearchPage(results: DocsSearchResult[], documentOffset: number, documentLimit: number) {
	const groups = groupSearchResults(results);
	return {
		documentGroups: groups.slice(documentOffset, documentOffset + documentLimit).map((group) => ({
			...group,
			isComplete: group.totalSectionCount <= 3,
			results: group.results.slice(0, 3),
		})),
		documentOffset,
		totalDocumentCount: groups.length,
	};
}

function groupSearchResults(results: DocsSearchResult[]): DocsSearchDocumentGroup[] {
	const groups = new Map<string, DocsSearchDocumentGroup>();
	for (const result of results) {
		const existing = groups.get(result.document.docId);
		if (existing) {
			existing.results.push(result);
			continue;
		}
		groups.set(result.document.docId, {
			document: result.document,
			isComplete: true,
			results: [result],
			totalSectionCount: 1,
		});
	}
	for (const group of groups.values()) {
		group.totalSectionCount = group.results.length;
	}
	return [...groups.values()];
}

async function renderSearchPanel(siteIndex: ReturnType<typeof createLargeDocsSiteIndex>) {
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<DocsSearchPanel
					onNavigate={() => undefined}
					searchIndexUrl={siteIndex.searchIndexUrl}
					siteIndex={siteIndex}
				/>
				<Outlet />
			</>
		),
	});
	const resultRoute = createRoute({
		component: () => <p>已打开文档</p>,
		getParentRoute: () => rootRoute,
		path: "$",
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: ["/"] }),
		routeTree: rootRoute.addChildren([resultRoute]),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return { router };
}

function createSearchIndex(
	siteIndex: ReturnType<typeof createLargeDocsSiteIndex>,
	documentCount: number,
) {
	const entries =
		siteIndex.collections[0]?.documents.slice(0, documentCount).flatMap((document) =>
			Array.from({ length: 2 }, (_, index) => ({
				anchor: `section-${index + 1}`,
				docId: document.docId,
				highlightRootUnitIds: [`${document.docId}-root-${index + 1}`],
				searchText: `共同关键词 第 ${index + 1} 节正文`,
				sectionTitle: `第 ${index + 1} 节`,
				snippet: `共同关键词对应的第 ${index + 1} 节正文`,
			})),
		) ?? [];
	return createDocsSearchIndex(entries, siteIndex);
}
function readOptionHref(option: HTMLElement | undefined): string {
	const href = option?.getAttribute("href") ?? option?.querySelector("a")?.getAttribute("href");
	if (!href) {
		throw new Error("docs search option has no reader link");
	}
	return href;
}
