import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createBrowserHistory,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Link,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTransportSchedulePeriod,
	fetchTransportRoutes,
	fetchTransportSchedulePeriods,
	updateTransportSchedulePeriod,
} from "../src/app/ops-api-client";
import { TransportCalendar } from "../src/app/transport-calendar";
import { TransportPeriodEditor } from "../src/app/transport-editors";
import {
	buildTransportImpactDays,
	effectiveDetails,
	previewPeriod,
	TransportImpact,
} from "../src/app/transport-impact";
import { TransportPage } from "../src/app/transport-page";
import type {
	TransportOpsRoute,
	TransportOpsSchedulePeriod,
} from "../src/server/transport-store-contract";

vi.mock("../src/app/ops-api-client", () => ({
	createTransportSchedulePeriod: vi.fn(),
	updateTransportSchedulePeriod: vi.fn(),
	createTransportRoute: vi.fn(),
	updateTransportRoute: vi.fn(),
	fetchTransportRoutes: vi.fn(),
	fetchTransportSchedulePeriods: vi.fn(),
	deleteTransportRoute: vi.fn(),
	deleteTransportSchedulePeriod: vi.fn(),
}));

const route: TransportOpsRoute = {
	routeId: "route:test",
	serviceKind: "commute",
	origin: "海淀校区",
	destination: "丰台校区",
	displayOrder: 0,
	defaultBoardingPoint: "东门",
	dropOffPoint: "南门",
	boardingGuide: null,
	createdAt: "2026-09-01T00:00:00.000Z",
	updatedAt: "2026-09-01T00:00:00.000Z",
	updatedBy: "test",
};
const source: TransportOpsSchedulePeriod = {
	sourceReleasedAt: null,
	scheduleId: "schedule:test",
	routeId: route.routeId,
	validFrom: "2026-09-01",
	validTo: null,
	weekdays: [1, 2, 3, 4, 5],
	status: "operating",
	boardingPointOverride: null,
	note: null,
	createdAt: route.createdAt,
	updatedAt: route.updatedAt,
	updatedBy: "test",
	items: [
		{
			itemId: "item:test",
			kind: "fixed",
			departureTime: "08:00",
			riderType: "all",
			boardingPoint: null,
			capacity: null,
			note: null,
			sortOrder: 0,
		},
	],
};

function renderEditor(onCancel = vi.fn(), onSaved = vi.fn()) {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<TransportPeriodEditor
				source={source}
				copy={false}
				route={route}
				periods={[source]}
				onDirty={vi.fn()}
				onBusy={vi.fn()}
				onCancel={onCancel}
				onSaved={onSaved}
			/>
		</QueryClientProvider>,
	);
}

async function renderWorkspace(
	input: {
		path?: string;
		routes?: TransportOpsRoute[];
		periods?: TransportOpsSchedulePeriod[];
		browserHistory?: boolean;
	} = {},
) {
	const client = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
	});
	const routes = input.routes ?? [route];
	const periods = input.periods ?? [source];
	client.setQueryData(["transport", "ops", "routes"], { routes });
	client.setQueryData(["transport", "ops", "schedule-periods"], { schedulePeriods: periods });
	vi.mocked(fetchTransportRoutes).mockResolvedValue({ routes });
	vi.mocked(fetchTransportSchedulePeriods).mockResolvedValue({ schedulePeriods: periods });
	const root = createRootRoute({
		component: () => (
			<>
				<Link to="/notices">通知维护</Link>
				<Outlet />
			</>
		),
	});
	const transport = createRoute({
		getParentRoute: () => root,
		path: "/transport",
		validateSearch: (search: Record<string, unknown>) => ({
			scheduleId: typeof search.scheduleId === "string" ? search.scheduleId : undefined,
			kind:
				search.kind === "commute" || search.kind === "subway" || search.kind === "special"
					? search.kind
					: undefined,
		}),
		component: () => (
			<TransportPage
				initialScheduleId={transport.useSearch().scheduleId}
				requestedKind={transport.useSearch().kind}
			/>
		),
	});
	const notices = createRoute({
		getParentRoute: () => root,
		path: "/notices",
		component: () => <h1>通知队列</h1>,
	});
	const history = input.browserHistory
		? createBrowserHistory()
		: createMemoryHistory({ initialEntries: ["/notices", input.path ?? "/transport"] });
	if (input.browserHistory) {
		history.replace("/notices");
		history.flush();
		history.push(input.path ?? "/transport");
		history.flush();
	}
	const router = createRouter({
		routeTree: root.addChildren([transport, notices]),
		history,
		defaultPendingMinMs: 0,
	});
	const rendered = render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	await act(async () => {
		await router.load();
	});
	return { ...rendered, router, client };
}

describe("班车服务类型切换", () => {
	const subwayRoute: TransportOpsRoute = {
		...route,
		routeId: "route:subway",
		serviceKind: "subway",
		origin: "地铁站",
		destination: "校区",
	};

	it("tracks the selected service kind in the URL", async () => {
		const { router } = await renderWorkspace({
			path: "/transport?kind=subway",
			routes: [route, subwayRoute],
		});
		expect(screen.getByRole("tab", { name: "地铁接驳", selected: true })).toBeInTheDocument();
		fireEvent.mouseDown(screen.getByRole("tab", { name: "两校区通勤" }));
		await waitFor(() => expect(router.state.location.search).toEqual({ kind: "commute" }));
		expect(screen.getByRole("tab", { name: "两校区通勤", selected: true })).toBeInTheDocument();
		await act(async () => router.history.back());
		await waitFor(() =>
			expect(screen.getByRole("tab", { name: "地铁接驳", selected: true })).toBeInTheDocument(),
		);
		await act(async () => router.history.forward());
		await waitFor(() =>
			expect(screen.getByRole("tab", { name: "两校区通勤", selected: true })).toBeInTheDocument(),
		);
	});
});

describe("班车时间段编辑器", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-11T10:00:00+08:00"));
		HTMLElement.prototype.scrollIntoView = vi.fn();
	});
	afterEach(() => vi.useRealTimers());
	it("copies date-effective drop-off and includes it in the impact and save payload", async () => {
		const overridden = { ...source, dropOffPointOverride: "聚雅餐厅东侧停车场路口" };
		vi.mocked(createTransportSchedulePeriod).mockResolvedValue({
			schedulePeriod: { ...overridden, scheduleId: "copied" },
		});
		await renderWorkspace({ periods: [overridden] });
		fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-10-01" } });
		fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-10-01" } });
		fireEvent.click(screen.getByRole("button", { name: "套用到所选日期" }));
		expect(screen.getByLabelText("本时间段下车点")).toHaveValue("聚雅餐厅东侧停车场路口");
		fireEvent.change(screen.getByLabelText("本时间段下车点"), {
			target: { value: "智慧中心南侧" },
		});
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		expect(screen.getByText("下车点：智慧中心南侧")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
		await waitFor(() =>
			expect(createTransportSchedulePeriod).toHaveBeenCalledWith(
				expect.objectContaining({
					dropOffPointOverride: "智慧中心南侧",
					validFrom: "2026-10-01",
					validTo: "2026-10-01",
				}),
			),
		);
	});
	it("updates weekday selections without saving and validates an empty selection", async () => {
		renderEditor();
		for (const label of ["周一", "周二", "周三", "周四", "周五"]) {
			fireEvent.click(screen.getByRole("button", { name: label }));
		}
		expect(updateTransportSchedulePeriod).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		expect(screen.queryByRole("button", { name: "确认保存" })).not.toBeInTheDocument();
		expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("button", { name: "周三" }));
		fireEvent.click(screen.getByRole("button", { name: "周一" }));
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		vi.mocked(updateTransportSchedulePeriod).mockResolvedValue({
			schedulePeriod: { ...source, weekdays: [1, 3] },
		});
		fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
		await waitFor(() =>
			expect(updateTransportSchedulePeriod).toHaveBeenCalledWith(
				source.scheduleId,
				expect.objectContaining({ weekdays: [1, 3] }),
			),
		);
	});
	it("opens additional fields when their validation fails", () => {
		renderEditor();
		const more = screen.getByText(/^更多$/);
		fireEvent.click(more);
		const capacity = screen.getByLabelText("容量（可空）");
		fireEvent.change(capacity, { target: { value: "-1" } });
		fireEvent.click(more);
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		expect(capacity).toBeVisible();
		expect(capacity).toHaveAttribute("aria-invalid", "true");
	});
	it("keeps one primary action and shows pending feedback on the save button", async () => {
		let finish!: (value: { schedulePeriod: TransportOpsSchedulePeriod }) => void;
		vi.mocked(updateTransportSchedulePeriod).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		renderEditor();
		expect(screen.getByRole("button", { name: "预览保存" })).toHaveClass("bg-primary");
		expect(screen.getByRole("button", { name: "取消" })).not.toHaveClass("bg-primary");
		fireEvent.change(screen.getByLabelText("结束日期（留空长期）"), {
			target: { value: "2026-09-30" },
		});
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		const preview = screen.getByRole("button", { name: "更新预览" });
		const confirm = screen.getByRole("button", { name: "确认保存" });
		expect(preview).not.toHaveClass("bg-primary");
		expect(confirm).toHaveClass("bg-primary", "min-w-32");
		fireEvent.click(confirm);
		await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
		expect(confirm).toHaveTextContent("保存中…");
		expect(preview).toHaveTextContent("更新预览");
		expect(preview).toBeDisabled();
		expect(confirm).toBeDisabled();
		fireEvent.click(confirm);
		expect(updateTransportSchedulePeriod).toHaveBeenCalledTimes(1);
		await act(async () => finish({ schedulePeriod: source }));
	});
	it("套用来源默认选择当天生效时间段，非法范围不能继续", () => {
		const weekend = { ...source, scheduleId: "weekend", weekdays: [6, 7] };
		const apply = vi.fn();
		const select = vi.fn();
		render(
			<TransportCalendar
				periods={[source, weekend]}
				date="2026-09-12"
				month="2026-09-01"
				onMonthChange={vi.fn()}
				onDateChange={select}
				onApplyPeriod={apply}
				onSuspendPeriod={vi.fn()}
			/>,
		);
		expect(screen.getByLabelText("套用来源时间段")).toHaveValue("weekend");
		fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-09-14" } });
		fireEvent.click(screen.getByRole("button", { name: "套用到所选日期" }));
		expect(apply).toHaveBeenCalledWith(weekend, "2026-09-12", "2026-09-14");
		fireEvent.click(screen.getByRole("button", { name: "2026-09-14，运行" }));
		expect(select).toHaveBeenCalledWith("2026-09-14");
		fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-09-10" } });
		expect(screen.getByRole("button", { name: "套用到所选日期" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "设置停运" })).toBeDisabled();
	});
	it("翻月不改变所选日期，编辑取消后仍保留浏览月份", async () => {
		await renderWorkspace();
		fireEvent.click(screen.getByRole("button", { name: "下个月" }));
		expect(screen.getByRole("heading", { name: "2026年10月" })).toBeVisible();
		expect(screen.getByRole("region", { name: "当天有效班次" })).toHaveTextContent("2026-09-11");
		fireEvent.click(screen.getByRole("button", { name: "编辑生效时间段" }));
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		expect(screen.getByRole("heading", { name: "2026年10月" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "上个月" }));
		expect(screen.getByRole("heading", { name: "2026年9月" })).toBeVisible();
	});
	it("当天新增带入同一天起止日期和星期日", async () => {
		await renderWorkspace();
		fireEvent.click(screen.getByRole("button", { name: "2026-09-13，无安排" }));
		fireEvent.click(
			within(screen.getByRole("region", { name: "当天有效班次" })).getByRole("button", {
				name: "新增时间段",
			}),
		);
		expect(screen.getByLabelText("开始日期")).toHaveValue("2026-09-13");
		expect(screen.getByLabelText("结束日期（留空长期）")).toHaveValue("2026-09-13");
		expect(
			within(screen.getByRole("group", { name: "适用星期" }))
				.getAllByRole("button", { pressed: true })
				.map((button) => button.textContent),
		).toEqual(["周日"]);
	});
	it("范围套用不需要额外修改草稿即可预览和保存，并跳到新范围", async () => {
		vi.mocked(createTransportSchedulePeriod).mockResolvedValue({
			schedulePeriod: {
				...source,
				scheduleId: "copy",
				validFrom: "2026-10-01",
				validTo: "2026-10-03",
			},
		});
		await renderWorkspace();
		fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-10-01" } });
		fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-10-03" } });
		fireEvent.click(screen.getByRole("button", { name: "套用到所选日期" }));
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		expect(screen.getByRole("button", { name: "确认保存" })).toBeEnabled();
		fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
		await waitFor(() =>
			expect(createTransportSchedulePeriod).toHaveBeenCalledWith(
				expect.objectContaining({ validFrom: "2026-10-01", validTo: "2026-10-03" }),
			),
		);
		await waitFor(() =>
			expect(screen.getByRole("region", { name: "当天有效班次" })).toHaveTextContent("2026-10-01"),
		);
		expect(screen.getByRole("heading", { name: "2026年10月" })).toBeVisible();
	});
	it("预填停运可保存，普通编辑未修改不能重复保存", async () => {
		const { unmount } = await renderWorkspace();
		fireEvent.click(screen.getByRole("button", { name: "设置停运" }));
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		expect(screen.getByRole("button", { name: "确认保存" })).toBeEnabled();
		unmount();
		renderEditor();
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		expect(screen.getByRole("button", { name: "确认保存" })).toBeDisabled();
	});
	it("结束安排的预填结束日期可以保存", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<TransportPeriodEditor
					source={source}
					copy={false}
					route={route}
					periods={[source]}
					initial={{ ...source, validTo: "2026-09-30" }}
					onDirty={vi.fn()}
					onBusy={vi.fn()}
					onCancel={vi.fn()}
					onSaved={vi.fn()}
				/>
			</QueryClientProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		expect(screen.getByRole("button", { name: "确认保存" })).toBeEnabled();
	});
	it("编辑保存保留查看日而非跳回时间段开始日", async () => {
		vi.mocked(updateTransportSchedulePeriod).mockResolvedValue({
			schedulePeriod: { ...source, validTo: "2026-09-30" },
		});
		await renderWorkspace();
		fireEvent.click(screen.getByRole("button", { name: "编辑生效时间段" }));
		fireEvent.change(screen.getByLabelText("结束日期（留空长期）"), {
			target: { value: "2026-09-30" },
		});
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
		await waitFor(() =>
			expect(screen.getByRole("region", { name: "当天有效班次" })).toHaveTextContent("2026-09-11"),
		);
	});
	it("相同变化只显示一次且默认展开，不重复未修改班次", () => {
		const original = {
			...source,
			validTo: "2026-09-18",
			items: [
				...source.items,
				...source.items.map((item) => ({ ...item, itemId: "second", departureTime: "08:10" })),
			],
		};
		const value = {
			...original,
			items: original.items.map((item, index) =>
				index === 0 ? { ...item, departureTime: "08:05" } : item,
			),
		};
		render(
			<TransportImpact
				source={original}
				value={value}
				route={route}
				periods={[original]}
				effectiveDate="2026-09-14"
			/>,
		);
		const impact = screen.getByRole("region", { name: "逐日影响范围" });
		expect(impact.querySelectorAll("details[open]")).toHaveLength(1);
		expect(impact).not.toHaveTextContent("08:10");
		expect(within(impact).getAllByText("08:05 · 全体师生 · 东门")).toHaveLength(1);
		expect(impact).toHaveTextContent("2026-09-14、2026-09-15、2026-09-16、2026-09-17、2026-09-18");
	});
	it("逐日预览实际覆盖、周末和结束后的恢复，而非仅比较班次数量", () => {
		const value = {
			...source,
			validFrom: "2026-09-10",
			validTo: "2026-09-13",
			weekdays: [1, 2, 3, 4, 5, 6, 7],
			items: source.items.map((item) => ({
				...item,
				departureTime: "09:00",
				boardingPoint: "西门",
			})),
		};
		const blocked = {
			...source,
			scheduleId: "blocked",
			validFrom: "2026-09-11",
			validTo: "2026-09-11",
			status: "suspended" as const,
			items: [],
		};
		render(
			<TransportImpact source={null} value={value} route={route} periods={[source, blocked]} />,
		);
		const impact = screen.getByRole("region", { name: "逐日影响范围" });
		expect(impact).toHaveTextContent("2026-09-10");
		expect(impact).toHaveTextContent("08:00 · 全体师生 · 东门");
		expect(impact).toHaveTextContent("09:00 · 全体师生 · 西门");
		expect(impact).toHaveTextContent("显示 2 天无变化日期");
		fireEvent.click(screen.getByText("显示 2 天无变化日期"));
		expect(impact).toHaveTextContent("2026-09-11");
	});
	it("完整有限范围可翻页，长期安排可跳转未来日期", () => {
		render(
			<TransportImpact
				source={null}
				value={{ ...source, validTo: "2026-11-30" }}
				route={route}
				periods={[]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "后31天" }));
		expect(screen.getByText(/当前查看 2026-10-02/)).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("影响范围查看日期"), {
			target: { value: "2026-11-30" },
		});
		expect(screen.getByText(/当前查看 2026-11-30/)).toBeInTheDocument();
		expect(screen.getByText(/当前查看 2026-11-30 — 2026-12-01/)).toBeInTheDocument();
	});
	it("班次的容量和备注也进入实际结果比较", () => {
		expect(
			effectiveDetails(
				{
					...source,
					items: source.items.map((item) => ({ ...item, capacity: 40, note: "须预约" })),
				},
				route,
			)[0],
		).toBe("08:00 · 全体师生 · 东门 · 40人 · 须预约");
	});
	it("先预览字段变化，再确认保存", async () => {
		vi.mocked(updateTransportSchedulePeriod).mockResolvedValue({ schedulePeriod: source });
		renderEditor();
		fireEvent.change(screen.getByLabelText("结束日期（留空长期）"), {
			target: { value: "2026-09-30" },
		});
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		expect(await screen.findByRole("region", { name: "保存前变更预览" })).toHaveTextContent(
			"结束日期：长期 → 2026-09-30",
		);
		expect(updateTransportSchedulePeriod).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
		await waitFor(() =>
			expect(updateTransportSchedulePeriod).toHaveBeenCalledWith(
				source.scheduleId,
				expect.objectContaining({ validTo: "2026-09-30" }),
			),
		);
	});

	it("日期为空时显示中文字段错误并阻止保存", async () => {
		renderEditor();
		fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "" } });
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("请检查标出的日期、星期或班次信息");
		expect(screen.getByLabelText("开始日期")).toHaveAttribute("aria-invalid", "true");
		expect(updateTransportSchedulePeriod).not.toHaveBeenCalled();
	});

	it("侧栏离开只提醒一次，继续编辑保留草稿，放弃才跳转", async () => {
		const { router } = await renderWorkspace();
		fireEvent.click(screen.getByRole("button", { name: "编辑生效时间段" }));
		fireEvent.change(screen.getByLabelText("发车时间"), { target: { value: "08:05" } });
		fireEvent.click(screen.getByRole("link", { name: "通知维护" }));
		expect(await screen.findAllByRole("alertdialog")).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
		expect(screen.getByLabelText("发车时间")).toHaveValue("08:05");
		expect(router.state.location.pathname).toBe("/transport");
		fireEvent.click(screen.getByRole("link", { name: "通知维护" }));
		await screen.findByRole("alertdialog");
		fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
		expect(await screen.findByRole("heading", { name: "通知队列" })).toBeVisible();
	});

	it("历史后退也保护草稿，放弃后前进可以正常返回", async () => {
		const { router, unmount } = await renderWorkspace({ browserHistory: true });
		fireEvent.click(screen.getByRole("button", { name: "编辑生效时间段" }));
		fireEvent.change(screen.getByLabelText("发车时间"), { target: { value: "08:05" } });
		act(() => router.history.back());
		await screen.findByRole("alertdialog");
		fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
		await screen.findByRole("heading", { name: "通知队列" });
		act(() => router.history.forward());
		expect(await screen.findByRole("region", { name: "当天有效班次" })).toBeVisible();
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		unmount();
		router.history.destroy();
	});

	it("快捷取消产生的预填停运草稿，未手动输入也会提醒", async () => {
		await renderWorkspace();
		fireEvent.click(screen.getByRole("button", { name: "取消班次 08:00 全体师生" }));
		expect(screen.getByLabelText("状态")).toHaveValue("suspended");
		fireEvent.click(screen.getByRole("link", { name: "通知维护" }));
		await screen.findByRole("alertdialog");
		fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
		expect(screen.getByLabelText("状态")).toHaveValue("suspended");
	});

	it("历史安排默认折叠，展开后可读取并再次收起", async () => {
		await renderWorkspace({
			periods: [
				source,
				{ ...source, scheduleId: "history", validFrom: "2026-04-28", validTo: "2026-05-05" },
			],
		});
		expect(screen.queryByRole("region", { name: "已结束" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "显示已结束安排（1）" }));
		expect(screen.getByRole("region", { name: "已结束" })).toHaveTextContent("2026-04-28");
		fireEvent.click(screen.getByRole("button", { name: "收起已结束安排" }));
		expect(screen.queryByRole("region", { name: "已结束" })).not.toBeInTheDocument();
	});

	it("有效链接打开历史安排，刷新不重置草稿，关闭清理参数并保留日期", async () => {
		const history = {
			...source,
			scheduleId: "history",
			validFrom: "2026-04-28",
			validTo: "2026-05-05",
		};
		const { router, client } = await renderWorkspace({
			path: "/transport?scheduleId=history",
			periods: [source, history],
		});
		expect(screen.getByLabelText("开始日期")).toHaveValue("2026-04-28");
		fireEvent.change(screen.getByLabelText("发车时间"), { target: { value: "08:05" } });
		act(() =>
			client.setQueryData(["transport", "ops", "schedule-periods"], {
				schedulePeriods: [source, { ...history, note: "刷新内容" }],
			}),
		);
		expect(screen.getByLabelText("发车时间")).toHaveValue("08:05");
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
		await waitFor(() => expect(router.state.location.search).toEqual({ kind: "commute" }));
		expect(screen.getByRole("region", { name: "当天有效班次" })).toHaveTextContent("2026-04-28");
		expect(screen.getByRole("heading", { name: "2026年4月" })).toBeVisible();
		expect(screen.getByRole("region", { name: "已结束" })).toBeVisible();
	});

	it("切换链接先保护草稿，确认后准确打开另一个时间段", async () => {
		const history = {
			...source,
			scheduleId: "history",
			validFrom: "2026-04-28",
			validTo: "2026-05-05",
		};
		const { router } = await renderWorkspace({
			path: "/transport?scheduleId=schedule%3Atest",
			periods: [source, history],
		});
		fireEvent.change(screen.getByLabelText("发车时间"), { target: { value: "08:05" } });
		act(() => {
			void router.navigate({ to: "/transport", search: { scheduleId: "history" } });
		});
		await screen.findByRole("alertdialog");
		fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
		await waitFor(() => expect(screen.getByLabelText("开始日期")).toHaveValue("2026-04-28"));
		expect(screen.getByLabelText("发车时间")).toHaveValue("08:00");
	});

	it("失效链接不静默打开其他安排，可主动选择第二条线路恢复", async () => {
		const other = { ...route, routeId: "other", origin: "丰台校区", destination: "海淀校区" };
		const { router } = await renderWorkspace({
			path: "/transport?scheduleId=missing",
			routes: [route, other],
		});
		expect(screen.getByRole("alert")).toHaveTextContent("不存在或已删除");
		expect(screen.queryByRole("region", { name: "当天有效班次" })).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("线路方向"), { target: { value: "other" } });
		await waitFor(() => expect(router.state.location.search).toEqual({ kind: "commute" }));
		expect(screen.getByLabelText("线路方向")).toHaveValue("other");
		expect(screen.getByRole("region", { name: "当天有效班次" })).toBeVisible();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("失效链接的返回入口替换当前历史记录", async () => {
		const { router } = await renderWorkspace({ path: "/transport?scheduleId=missing" });
		const length = router.history.length;
		fireEvent.click(screen.getByRole("button", { name: "返回班车维护" }));
		await waitFor(() => expect(router.state.location.search).toEqual({ kind: "commute" }));
		expect(router.history.length).toBe(length);
		expect(screen.getByRole("region", { name: "当天有效班次" })).toBeVisible();
	});

	it("保存中不能离开，成功后可以离开且不再提醒", async () => {
		let resolveSave!: (value: { schedulePeriod: TransportOpsSchedulePeriod }) => void;
		vi.mocked(updateTransportSchedulePeriod).mockReturnValue(
			new Promise((resolve) => {
				resolveSave = resolve;
			}),
		);
		const { router } = await renderWorkspace({ path: "/transport?scheduleId=schedule%3Atest" });
		fireEvent.change(screen.getByLabelText("发车时间"), { target: { value: "08:05" } });
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeDisabled());
		fireEvent.click(screen.getByRole("link", { name: "通知维护" }));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(router.state.location.pathname).toBe("/transport");
		await act(async () => resolveSave({ schedulePeriod: source }));
		await screen.findByRole("region", { name: "当天有效班次" });
		fireEvent.click(screen.getByRole("link", { name: "通知维护" }));
		expect(await screen.findByRole("heading", { name: "通知队列" })).toBeVisible();
	});

	it("快捷修改的预览只显示实际差异，不把完整时刻表标为新增", async () => {
		const multi = {
			...source,
			items: [
				...source.items,
				{
					...(source.items[0] as TransportOpsSchedulePeriod["items"][number]),
					itemId: "second",
					departureTime: "12:30",
					sortOrder: 1,
				},
			],
		};
		await renderWorkspace({ periods: [multi] });
		fireEvent.click(screen.getByRole("button", { name: "修改班次 08:00 全体师生" }));
		fireEvent.change(
			within(screen.getByRole("group", { name: "班次 1" })).getByLabelText("发车时间"),
			{ target: { value: "08:05" } },
		);
		fireEvent.click(screen.getByRole("button", { name: "预览保存" }));
		const preview = screen.getByRole("region", { name: "保存前变更预览" });
		expect(preview).toHaveTextContent("新增时间段，保留原安排");
		expect(preview).not.toHaveTextContent("新增班次：");
		expect(preview).not.toHaveTextContent("12:30");
		expect(preview).toHaveTextContent("08:00 · 全体师生 · 东门");
		expect(preview).toHaveTextContent("08:05 · 全体师生 · 东门");
		expect(preview.querySelector("details[open]")).not.toBeNull();
	});

	it("逐日比较保留重复数量，中间删除不误报其他班次且次日恢复", () => {
		const multi = {
			...source,
			items: ["08:00", "12:30", "16:00", "16:00"].map((departureTime, index) => ({
				...(source.items[0] as TransportOpsSchedulePeriod["items"][number]),
				departureTime,
				itemId: `item-${index}`,
				sortOrder: index,
			})),
		};
		const value = {
			...multi,
			validFrom: "2026-09-10",
			validTo: "2026-09-10",
			items: multi.items.filter((_, index) => index !== 1 && index !== 3),
		};
		const days = buildTransportImpactDays(
			"2026-09-10",
			"2026-09-11",
			[multi],
			[multi, previewPeriod(value, null)],
			route,
		);
		expect(days[0]?.removed).toEqual(["12:30 · 全体师生 · 东门", "16:00 · 全体师生 · 东门"]);
		expect(days[0]?.added).toEqual([]);
		expect(days[1]?.changed).toBe(false);
	});

	it("间隔班次修改包含人群、地点、容量和备注，新增与停运也按实际结果比较", () => {
		const interval: TransportOpsSchedulePeriod["items"][number] = {
			itemId: "interval",
			kind: "interval",
			firstDepartureTime: "08:00",
			lastDepartureTime: "10:00",
			intervalMinutes: 30,
			riderType: "all",
			boardingPoint: null,
			capacity: 30,
			note: null,
			sortOrder: 0,
		};
		const original = { ...source, items: [interval] };
		const value = {
			...original,
			validFrom: "2026-09-11",
			validTo: "2026-09-11",
			items: [
				{
					...interval,
					intervalMinutes: 15,
					riderType: "student" as const,
					boardingPoint: "西门",
					capacity: 40,
					note: "须预约",
				},
			],
		};
		const changed = buildTransportImpactDays(
			"2026-09-11",
			"2026-09-11",
			[original],
			[original, previewPeriod(value, null)],
			route,
		)[0];
		expect(changed?.removed).toEqual(["08:00–10:00 每30分钟 · 全体师生 · 东门 · 30人"]);
		expect(changed?.added).toEqual(["08:00–10:00 每15分钟 · 学生班次 · 西门 · 40人 · 须预约"]);
		const added = buildTransportImpactDays(
			"2026-09-11",
			"2026-09-11",
			[original],
			[original, previewPeriod({ ...value, items: [interval, ...value.items] }, null)],
			route,
		)[0];
		expect(added?.removed).toEqual([]);
		expect(added?.added).toEqual(changed?.added);
		const suspended = buildTransportImpactDays(
			"2026-09-11",
			"2026-09-11",
			[original],
			[original, previewPeriod({ ...value, status: "suspended", items: [] }, null)],
			route,
		)[0];
		expect(suspended?.added).toEqual(["停运"]);
		expect(suspended?.removed).toEqual([...(changed?.removed ?? []), "下车点：南门"]);
	});

	it("选定日无变化时展开首个变化分组，无生效变化时不虚报新增", () => {
		const future = {
			...source,
			validFrom: "2026-09-12",
			validTo: "2026-09-15",
			items: source.items.map((item) => ({ ...item, departureTime: "09:00" })),
		};
		const { unmount } = render(
			<TransportImpact
				source={null}
				value={future}
				periods={[source]}
				route={route}
				effectiveDate="2026-09-12"
			/>,
		);
		expect(
			screen.getByRole("region", { name: "逐日影响范围" }).querySelector("details[open] summary"),
		).toHaveTextContent("2026-09-14");
		unmount();
		render(
			<TransportImpact
				source={null}
				value={{ ...source, validFrom: "2026-09-11", validTo: "2026-09-11" }}
				periods={[source]}
				route={route}
				effectiveDate="2026-09-11"
			/>,
		);
		expect(screen.getByText("当前查看范围没有生效结果变化。")).toBeVisible();
	});
});
