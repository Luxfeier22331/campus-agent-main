import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { RequestTrendChart } from "../src/app/overview-page";
import type { OpsOverviewResponse } from "../src/shared/ops-contract";

vi.mock("recharts", () => ({
	CartesianGrid: () => null,
	Legend: () => null,
	Line: ({
		connectNulls,
		dataKey,
		dot,
	}: {
		connectNulls?: boolean;
		dataKey: string;
		dot?: unknown;
	}) => (
		<span
			data-connect-nulls={String(connectNulls === true)}
			data-dot-hidden={String(dot === false)}
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

	it("keeps a live region mounted when trend freshness changes", () => {
		const initial = trends({ dataState: "FRESH", reason: null });
		const { rerender } = render(<RequestTrendChart trends={initial} />);
		const status = screen.getByRole("status");

		expect(status).toBeEmptyDOMElement();
		expect(status).toHaveClass("sr-only");

		rerender(
			<RequestTrendChart
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
