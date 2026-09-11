import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { effectiveDetails, TransportImpact } from "../src/app/transport-impact";
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

function renderWorkspace() {
	const client = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
	});
	client.setQueryData(["transport", "ops", "routes"], { routes: [route] });
	client.setQueryData(["transport", "ops", "schedule-periods"], { schedulePeriods: [source] });
	vi.mocked(fetchTransportRoutes).mockResolvedValue({ routes: [route] });
	vi.mocked(fetchTransportSchedulePeriods).mockResolvedValue({ schedulePeriods: [source] });
	return render(
		<QueryClientProvider client={client}>
			<TransportPage />
		</QueryClientProvider>,
	);
}

describe("班车时间段编辑器", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-11T10:00:00+08:00"));
		HTMLElement.prototype.scrollIntoView = vi.fn();
	});
	afterEach(() => vi.useRealTimers());
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
	it("翻月不改变所选日期，编辑取消后仍保留浏览月份", () => {
		renderWorkspace();
		fireEvent.click(screen.getByRole("button", { name: "下个月" }));
		expect(screen.getByRole("heading", { name: "2026年10月" })).toBeVisible();
		expect(screen.getByRole("region", { name: "当天有效班次" })).toHaveTextContent("2026-09-11");
		fireEvent.click(screen.getByRole("button", { name: "编辑生效时间段" }));
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		expect(screen.getByRole("heading", { name: "2026年10月" })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "上个月" }));
		expect(screen.getByRole("heading", { name: "2026年9月" })).toBeVisible();
	});
	it("当天新增带入同一天起止日期和星期日", () => {
		renderWorkspace();
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
		renderWorkspace();
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
		const { unmount } = renderWorkspace();
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
		renderWorkspace();
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
	it("相同变化只显示一次且默认折叠，不重复未修改班次", () => {
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
		expect(impact.querySelectorAll("details[open]")).toHaveLength(0);
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
});
