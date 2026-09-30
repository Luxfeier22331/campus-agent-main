const range = { from: "2026-09-13T16:00:00.000Z", to: "2026-09-16T04:00:00.000Z" };

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app";
import { formatChartTime, OverviewPage, RequestTrendChart } from "../src/app/overview-page";
import type { OpsOverviewResponse } from "../src/shared/ops-contract";
import { opsRequestListFixture } from "../src/shared/ops-fixtures";

vi.mock("recharts", () => ({
	CartesianGrid: () => null,
	Legend: () => null,
	Line: ({
		connectNulls,
		dataKey,
		dot,
		strokeDasharray,
	}: {
		connectNulls?: boolean;
		dataKey: string;
		dot?: unknown;
		strokeDasharray?: string;
	}) => (
		<span
			data-connect-nulls={String(connectNulls === true)}
			data-dot-hidden={String(dot === false)}
			data-has-dot-marker={String(typeof dot === "object" && dot !== null)}
			data-stroke-dasharray={strokeDasharray}
			data-testid={`line-${dataKey}`}
		/>
	),
	LineChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Tooltip: () => null,
	XAxis: () => null,
	YAxis: () => null,
}));

describe("RequestTrendChart", () => {
	it("preserves missing p95 buckets instead of connecting across them", () => {
		render(
			<RequestTrendChart
				range={range}
				trends={trends({
					dataState: "PARTIAL",
					reason: "部分时间段没有耗时样本。",
				})}
			/>,
		);

		const latencyLine = screen.getByTestId("line-p95DurationMs");
		expect(latencyLine).toHaveAttribute("data-connect-nulls", "false");
		expect(latencyLine).toHaveAttribute("data-dot-hidden", "false");
	});

	it("distinguishes request outcomes without relying on color alone", () => {
		render(
			<RequestTrendChart range={range} trends={trends({ dataState: "FRESH", reason: null })} />,
		);

		expect(screen.getByTestId("line-total")).not.toHaveAttribute("data-stroke-dasharray");
		expect(screen.getByTestId("line-completed")).toHaveAttribute("data-stroke-dasharray", "7 4");
		expect(screen.getByTestId("line-failed")).toHaveAttribute("data-stroke-dasharray", "2 3");
		expect(screen.getByTestId("line-failed")).toHaveAttribute("data-has-dot-marker", "true");
	});

	it("keeps a live region mounted when trend freshness changes", () => {
		const initial = trends({ dataState: "FRESH", reason: null });
		const { rerender } = render(<RequestTrendChart range={range} trends={initial} />);
		const status = screen.getByRole("status");

		expect(status).toBeEmptyDOMElement();
		expect(status).toHaveClass("sr-only");

		rerender(
			<RequestTrendChart
				range={range}
				trends={{
					...initial,
					dataState: "STALE",
					reason: "趋势刷新失败，当前显示上一次成功数据。",
				}}
			/>,
		);

		expect(screen.getByRole("status")).toBe(status);
		expect(status).toHaveTextContent("趋势刷新失败，当前显示上一次成功数据。");
		expect(status).not.toHaveClass("sr-only");
	});
});

describe("OverviewPage drill-down", () => {
	it("links metrics and issues to requests with the current window", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					...overviewFixture({ issueCount: 2 }),
					trends: trends({ dataState: "FRESH", reason: null }),
				}),
			),
		);
		const root = createRootRoute({ component: Outlet });
		const overview = createRoute({
			getParentRoute: () => root,
			path: "/overview",
			component: () => <OverviewPage search={{ window: "this-week" }} />,
		});
		const router = createRouter({
			routeTree: root.addChildren([overview]),
			history: createMemoryHistory({ initialEntries: ["/overview"] }),
		});
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		);
		await screen.findByRole("heading", { name: "问答概览" });
		await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
		const total = screen.getByRole<HTMLAnchorElement>("link", { name: "12" });
		expect(new URL(total.href, "https://ops.example.test").searchParams.get("from")).toBe(
			range.from,
		);
		const successRate = screen.getByRole<HTMLAnchorElement>("link", { name: "91.7%" });
		const successUrl = new URL(successRate.href, "https://ops.example.test");
		expect(successUrl.pathname).toBe("/requests");
		expect(successUrl.searchParams.get("status")).toBeNull();
		expect(successUrl.searchParams.get("from")).toBe(range.from);
		const failedRequests = screen.getByRole<HTMLAnchorElement>("link", {
			name: "查看全部关注请求",
		});
		const failedUrl = new URL(failedRequests.href, "https://ops.example.test");
		expect(failedUrl.pathname).toBe("/requests");
		expect(failedUrl.searchParams.get("view")).toBe("attention");
		expect(failedUrl.searchParams.has("status")).toBe(false);
		expect(failedUrl.searchParams.get("from")).toBe(range.from);
		expect(screen.queryByRole("link", { name: "切换到 24 小时" })).toBeNull();
		for (const name of ["查看当前窗口的请求量与结果", "查看当前窗口的请求耗时"]) {
			expect(screen.getByRole("link", { name })).toHaveAttribute(
				"href",
				`/requests?${new URLSearchParams(range)}`,
			);
		}
	});
});

function overviewFixture({ issueCount }: { issueCount: number }): OpsOverviewResponse {
	return {
		cache: { ageMs: 0, status: "FRESH" },
		generatedAt: "2026-09-16T04:00:00.000Z",
		health: { status: "DEGRADED", dataState: "FRESH" },
		issues: Array.from({ length: issueCount }, (_, index) => ({
			code: `ISSUE_${index}`,
			detail: "详情",
			severity: "WARNING",
			source: "REQUESTS",
			title: `问题 ${index}`,
		})),
		requests: {
			actionRequired: 0,
			cancelled: 0,
			completed: 11,
			dataState: "FRESH",
			failed: 1,
			p95DurationMs: 4_000,
			pending: 0,
			reason: null,
			running: 0,
			status: "DEGRADED",
			successRate: 11 / 12,
			total: 12,
			updatedAt: null,
		},
		trends: { data: [], dataState: "NO_DATA", reason: null },
		window: "this-week",
		filters: range,
	};
}

function trends(
	overrides: Pick<OpsOverviewResponse["trends"], "dataState" | "reason">,
): OpsOverviewResponse["trends"] {
	return {
		...overrides,
		data: [
			{
				bucketStart: "2026-07-09T06:15:00.000Z",
				completed: 8,
				failed: 0,
				p95DurationMs: 1_200,
				total: 8,
			},
			{
				bucketStart: "2026-07-09T06:30:00.000Z",
				completed: 9,
				failed: 1,
				p95DurationMs: null,
				total: 10,
			},
			{
				bucketStart: "2026-07-09T06:45:00.000Z",
				completed: 7,
				failed: 0,
				p95DurationMs: 1_450,
				total: 7,
			},
		],
	};
}

describe("trend time labels in Beijing time", () => {
	it("uses hours inside one day, respecting the exclusive end", () => {
		expect(
			formatChartTime("2026-09-30T00:00:00Z", {
				from: "2026-09-29T16:00:00Z",
				to: "2026-09-30T16:00:00Z",
			}),
		).toBe("08:00");
	});
	it("distinguishes daily buckets across months", () => {
		const range = { from: "2026-08-30T16:00:00Z", to: "2026-09-02T16:00:00Z" };
		expect(formatChartTime("2026-08-30T16:00:00Z", range)).toBe("08-31");
		expect(formatChartTime("2026-08-31T16:00:00Z", range)).toBe("09-01");
	});
	it("includes the year when the range crosses years", () => {
		const range = { from: "2025-12-30T16:00:00Z", to: "2026-01-02T16:00:00Z" };
		expect(formatChartTime("2025-12-30T16:00:00Z", range)).toBe("2025-12-31");
		expect(formatChartTime("2025-12-31T16:00:00Z", range)).toBe("2026-01-01");
	});
});

describe("OverviewPage request states", () => {
	it("does not turn an empty window into a healthy claim or clickable missing metrics", async () => {
		const empty = overviewFixture({ issueCount: 0 });
		empty.requests = {
			...empty.requests,
			completed: 0,
			failed: 0,
			total: 0,
			successRate: null,
			p95DurationMs: null,
			dataState: "NO_DATA",
			status: "UNKNOWN",
		};
		empty.health = { status: "UNKNOWN", dataState: "NO_DATA" };
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				Response.json(
					url.includes("/overview")
						? empty
						: {
								...opsRequestListFixture,
								data: [],
								statusCounts: { ...opsRequestListFixture.statusCounts, total: 0 },
							},
				),
			),
		);
		render(<OpsWebApp initialPath="/overview" />);
		await screen.findByText("本时段没有请求");
		expect(screen.queryByText("当前没有阻塞问题")).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "无数据" })).not.toBeInTheDocument();
	});
	it("uses the attention query total and does not turn unavailable data into failed requests", async () => {
		const data = overviewFixture({ issueCount: 0 });
		data.health = { status: "UNKNOWN", dataState: "UNAVAILABLE" };
		const fetchMock = vi.fn(async (url: string) =>
			Response.json(
				url.includes("/overview")
					? data
					: {
							...opsRequestListFixture,
							statusCounts: { ...opsRequestListFixture.statusCounts, total: 87 },
						},
			),
		);
		vi.stubGlobal("fetch", fetchMock);
		render(<OpsWebApp initialPath="/overview" />);
		await screen.findByText("请求情况暂不可用");
		await screen.findByRole("heading", { name: "需要关注 · 87" });
		const link = screen.getByRole("link", { name: "查看全部关注请求" });
		expect(link.getAttribute("href")).toContain("view=attention");
		expect(link.getAttribute("href")).not.toContain("status=FAILED");
	});
});
