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
import { OverviewPage, RequestTrendChart } from "../src/app/overview-page";
import type { OpsOverviewResponse } from "../src/shared/ops-contract";

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
		await screen.findByRole("heading", { name: "运行概览" });
		await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
		const total = screen.getByRole<HTMLAnchorElement>("link", { name: "12" });
		expect(new URL(total.href, "https://ops.example.test").searchParams.get("from")).toBe(
			range.from,
		);
		const successRate = screen.getByRole<HTMLAnchorElement>("link", { name: "91.7%" });
		const successUrl = new URL(successRate.href, "https://ops.example.test");
		expect(successUrl.pathname).toBe("/requests");
		expect(successUrl.searchParams.get("status")).toBe("FAILED");
		expect(successUrl.searchParams.get("from")).toBe(range.from);
		const failedRequests = screen.getByRole<HTMLAnchorElement>("link", { name: "查看失败请求" });
		const failedUrl = new URL(failedRequests.href, "https://ops.example.test");
		expect(failedUrl.pathname).toBe("/requests");
		expect(failedUrl.searchParams.get("status")).toBe("FAILED");
		expect(failedUrl.searchParams.get("from")).toBe(range.from);
		expect(screen.queryByRole("link", { name: "切换到 24 小时" })).toBeNull();
		for (const name of ["查看当前窗口的请求量与结果", "查看当前窗口的请求耗时"]) {
			expect(screen.getByRole("link", { name })).toHaveAttribute(
				"href",
				`/requests?${new URLSearchParams(range)}`,
			);
		}
		expect(screen.getByRole("link", { name: "查看当前窗口的失败请求" })).toHaveAttribute(
			"href",
			`/requests?${new URLSearchParams({ ...range, status: "FAILED" })}`,
		);
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
