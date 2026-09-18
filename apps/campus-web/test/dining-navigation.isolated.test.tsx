import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiningPageViewProps } from "../src/components/dining/dining-page-view";
import { DINING_FIXTURE_MAP } from "./dining-fixture-test-utils";

const editor = vi.hoisted(() => ({ dirty: false, pending: false }));

vi.mock("../src/components/dining/dining-page-view", () => ({
	DiningPageView: (props: DiningPageViewProps) => {
		useEffect(() => props.onMapReady?.(), [props.onMapReady]);
		return (
			<div>
				{props.headerActions}
				<input
					aria-label="搜索窗口"
					value={props.query}
					onChange={(e) => props.onQueryChange(e.target.value)}
				/>
				<button type="button" onClick={() => props.onSelectWindow("haidian:haidian-1f:window-1")}>
					选择窗口
				</button>
				<button
					type="button"
					onClick={() =>
						props.onViewportChange?.({
							floorId: "haidian-1f",
							scale: 3,
							positionX: -100,
							positionY: -50,
						})
					}
				>
					移动地图
				</button>
				<output data-testid="viewport">{props.initialViewport?.scale ?? 1}</output>
				<div ref={props.detailRef}>
					<h2>{props.selectedWindow?.name ?? "未选择"}</h2>
				</div>
				{props.windowExtra}
			</div>
		);
	},
}));
vi.mock("../src/components/dining/dining-my-submissions", () => ({
	DiningMySubmissions: (props: { onOpenSubmission(value: { submissionId: string }): void }) => (
		<button type="button" onClick={() => props.onOpenSubmission({ submissionId: "test" })}>
			查看状态
		</button>
	),
}));
vi.mock("../src/components/dining/dining-window-submissions", () => ({
	DiningWindowSubmissions: (props: {
		onOpen(id: string): void;
		onSaved(value: { submissionId: string }): void;
	}) => (
		<>
			<button type="button" onClick={() => props.onOpen("test")}>
				查看投稿
			</button>
			<button type="button" onClick={() => props.onSaved({ submissionId: "new" })}>
				保存投稿
			</button>
		</>
	),
}));
vi.mock("../src/components/dining/dining-submission-sheet", () => ({
	DiningSubmissionSheet: (props: { onClose(): void }) => {
		const exit = useDiningSubmissionExit();
		useEffect(() => exit.register(() => editor), [exit.register]);
		return (
			<div role="dialog">
				<button type="button" onClick={props.onClose}>
					关闭详情
				</button>
			</div>
		);
	},
}));

import { DiningPage } from "../src/app/routes/dining-page";
import { useDiningSubmissionExit } from "../src/components/dining/dining-submission-exit";
import { diningQueryKeys } from "../src/features/dining/queries";
import { diningQueryClient } from "../src/features/dining/query-client";

beforeEach(() => {
	editor.dirty = false;
	editor.pending = false;
	diningQueryClient.setQueryData(diningQueryKeys.map, DINING_FIXTURE_MAP);
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
	diningQueryClient.clear();
	vi.restoreAllMocks();
});
async function mount(entry = "/dining?hall=haidian&floor=haidian-1f") {
	const root = createRootRoute();
	const dining = createRoute({
		getParentRoute: () => root,
		path: "/dining",
		component: DiningPage,
		validateSearch: (value: Record<string, unknown>) => value,
	});
	const history = createMemoryHistory({ initialEntries: ["/", entry] });
	const router = createRouter({ routeTree: root.addChildren([dining]), history });
	render(<RouterProvider router={router} />);
	await waitFor(() => expect(router.state.status).toBe("idle"));
	return { router, history };
}

describe("Dining route navigation", () => {
	it("preserves map selection, search and viewport through My submissions", async () => {
		const { router } = await mount();
		fireEvent.change(await screen.findByLabelText("搜索窗口"), { target: { value: "兰州" } });
		fireEvent.click(screen.getByText("选择窗口"));
		await screen.findByText("兰州拉面");
		fireEvent.click(screen.getByText("移动地图"));
		fireEvent.click(screen.getByRole("link", { name: "我的投稿" }));
		fireEvent.click(await screen.findByRole("link", { name: "返回食堂地图" }));
		expect(await screen.findByLabelText("搜索窗口")).toHaveValue("兰州");
		expect(screen.getByTestId("viewport")).toHaveTextContent("3");
		expect(router.state.location.search.window).toBe("haidian:haidian-1f:window-1");
	});
	it("closes an internal detail by returning, so another Back does not reopen it", async () => {
		const { history, router } = await mount();
		fireEvent.click(await screen.findByRole("link", { name: "我的投稿" }));
		fireEvent.click(await screen.findByText("查看状态"));
		fireEvent.click(await screen.findByText("关闭详情"));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		await act(async () => history.back());
		await screen.findByRole("link", { name: "我的投稿" });
		expect(router.state.location.search.submission).toBeUndefined();
	});
	it("supports Back and Forward around a detail", async () => {
		const { history } = await mount("/dining?mine=1");
		fireEvent.click(await screen.findByText("查看状态"));
		await screen.findByRole("dialog");
		await act(async () => history.back());
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		await act(async () => history.forward());
		await screen.findByRole("dialog");
		fireEvent.click(screen.getByText("关闭详情"));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
	});
	it("replaces a direct detail without leaving Dining", async () => {
		const { history, router } = await mount("/dining?mine=1&submission=test");
		const index = history.location.state.__TSR_index;
		fireEvent.click(await screen.findByText("关闭详情"));
		await waitFor(() => expect(router.state.location.search.submission).toBeUndefined());
		expect(history.location.state.__TSR_index).toBe(index);
		expect(router.state.location.pathname).toBe("/dining");
	});
	it("closes a newly saved submission onto My submissions", async () => {
		const { router } = await mount(
			"/dining?hall=haidian&floor=haidian-1f&window=haidian%3Ahaidian-1f%3Awindow-1",
		);
		fireEvent.click(await screen.findByText("保存投稿"));
		fireEvent.click(await screen.findByText("关闭详情"));
		await waitFor(() => expect(router.state.location.search.submission).toBeUndefined());
		expect(router.state.location.search.mine).toBe("1");
	});
});

describe("Dining detail positioning", () => {
	it("scrolls an offscreen mobile selection smoothly, including reselecting the same window", async () => {
		vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
			matches: query === "(max-width: 1023px)",
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}));
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
			top: 1500,
			bottom: 1520,
			left: 0,
			right: 200,
			width: 200,
			height: 20,
			x: 0,
			y: 1500,
			toJSON: () => ({}),
		});
		const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
		await mount();
		fireEvent.click(await screen.findByText("选择窗口"));
		await waitFor(() =>
			expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "smooth" }),
		);
		scroll.mockClear();
		fireEvent.click(screen.getByText("选择窗口"));
		await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
	});
	it("leaves an already visible detail in place", async () => {
		vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
			matches: query === "(max-width: 1023px)",
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}));
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
			top: 200,
			bottom: 220,
			left: 0,
			right: 200,
			width: 200,
			height: 20,
			x: 0,
			y: 200,
			toJSON: () => ({}),
		});
		const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
		await mount();
		fireEvent.click(await screen.findByText("选择窗口"));
		await screen.findByText("兰州拉面");
		await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve())));
		expect(scroll).not.toHaveBeenCalled();
	});
});

describe("Dining route exit protection", () => {
	it("keeps a direct detail open when dirty navigation is cancelled", async () => {
		editor.dirty = true;
		const { router } = await mount("/dining?mine=1&submission=test");
		fireEvent.click(await screen.findByText("关闭详情"));
		fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
		expect(router.state.location.search.submission).toBe("test");
		fireEvent.click(screen.getByText("关闭详情"));
		fireEvent.click(await screen.findByRole("button", { name: "放弃修改" }));
		await waitFor(() => expect(router.state.location.search.submission).toBeUndefined());
	});
	it("does not close a detail during an in-flight save", async () => {
		editor.pending = true;
		const { router } = await mount("/dining?mine=1&submission=test");
		fireEvent.click(await screen.findByText("关闭详情"));
		await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
		expect(router.state.location.search.submission).toBe("test");
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
	});
});
