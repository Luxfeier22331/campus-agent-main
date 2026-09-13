import { Alert, Button, Field, NativeSelect } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { OpsOverviewResponse, OpsOverviewWindow } from "../shared/ops-contract";
import { formatDuration, formatPercent, formatTimestamp } from "./format";
import { fetchOpsOverview } from "./ops-api/observability";
import {
	ErrorState,
	formatIssueSeverity,
	PageHeader,
	PageShell,
	StaleDataWarning,
	StatusBadge,
} from "./ops-display";
import { formatDataStateLabel } from "./ops-view-helpers";

const windows: Array<{ label: string; value: OpsOverviewWindow }> = [
	{ label: "15 分钟", value: "15m" },
	{ label: "1 小时", value: "1h" },
	{ label: "6 小时", value: "6h" },
	{ label: "24 小时", value: "24h" },
];

export function OverviewPage({ window }: { window: OpsOverviewWindow }) {
	const navigate = useNavigate();
	const overview = useQuery({
		queryFn: ({ signal }) => fetchOpsOverview(window, { signal }),
		queryKey: ["ops", "overview", window],
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});

	if (overview.isPending) {
		return <PageShell title="运行概览">正在读取运行状态...</PageShell>;
	}
	if (overview.isError && !overview.data) {
		return (
			<PageShell title="运行概览">
				<ErrorState
					error={overview.error}
					onRetry={() => overview.refetch()}
					title="运行概览读取失败"
				/>
			</PageShell>
		);
	}
	if (!overview.data) {
		return <PageShell title="运行概览">正在读取运行状态...</PageShell>;
	}

	const data = overview.data;
	return (
		<section>
			<PageHeader
				actions={
					<div className="flex flex-wrap items-end gap-3">
						<Field label="统计窗口">
							<NativeSelect
								aria-label="统计窗口"
								className="min-h-11"
								name="window"
								onChange={(event) => {
									void navigate({
										search: { window: event.target.value as OpsOverviewWindow },
										to: "/overview",
									});
								}}
								value={window}
							>
								{windows.map((item) => (
									<option key={item.value} value={item.value}>
										{item.label}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Button
							aria-busy={overview.isFetching}
							disabled={overview.isFetching}
							onClick={() => overview.refetch()}
							variant="outline"
						>
							<RefreshCw className="size-4" />
							{overview.isFetching ? "刷新中" : "刷新"}
						</Button>
					</div>
				}
				description="确认产品请求状态、结果和趋势是否正常。"
				title="运行概览"
			/>
			{overview.isRefetchError ? (
				<StaleDataWarning
					error={overview.error}
					lastSuccessfulAt={overview.dataUpdatedAt}
					onRetry={() => void overview.refetch()}
					title="运行概览刷新失败"
				/>
			) : null}
			{data.cache.status === "STALE" ? (
				<Alert className="mb-4" tone="warning">
					部分来源显示旧数据，最旧结果距本次刷新约 {formatDuration(data.cache.ageMs)}。
				</Alert>
			) : null}

			<dl className="grid border-border border-y md:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-border">
				<div className="grid content-start gap-2 border-border border-b px-1 py-4 md:border-r md:px-4 xl:border-b-0 xl:border-r-0 xl:pl-0">
					<dt className="font-medium ui-metadata">整体状态</dt>
					<dd>
						<StatusBadge status={data.health.status} />
					</dd>
					<dd className="text-muted-foreground text-sm">
						{data.issues.length > 0 ? `${data.issues.length} 个问题需要处理` : "当前没有阻塞问题"}
					</dd>
					{data.health.dataState === "FRESH" ? null : (
						<dd className="font-medium text-warning text-xs">
							数据状态：{formatDataStateLabel(data.health.dataState)}
						</dd>
					)}
				</div>
				<OverviewMetric label="请求总数" value={data.requests.total.toLocaleString("en-US")} />
				<OverviewMetric
					label="请求成功率"
					value={
						data.requests.successRate === null ? "无数据" : formatPercent(data.requests.successRate)
					}
				/>
				<OverviewMetric
					label="95% 请求耗时"
					value={
						data.requests.p95DurationMs === null
							? "无数据"
							: formatDuration(data.requests.p95DurationMs)
					}
				/>
			</dl>

			<div className="mt-[var(--ui-section-gap)] grid items-start gap-[var(--ui-section-gap)] xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] xl:gap-0">
				<section className="min-w-0 border-border border-b pb-8 xl:border-b-0 xl:border-r xl:pr-8">
					<h2 className="mb-4 ui-section-title">请求趋势</h2>
					<RequestTrendChart trends={data.trends} />
				</section>
				<section className="min-w-0 border-border border-b pb-8 xl:border-b-0 xl:pl-8">
					<h2 className="mb-4 ui-section-title">当前问题</h2>
					{data.issues.length === 0 ? (
						<p className="text-muted-foreground text-sm">当前没有需要处理的问题。</p>
					) : (
						<ul className="divide-y divide-border">
							{data.issues.map((issue) => (
								<li className="grid gap-2 py-4 first:pt-0 last:pb-0" key={issue.code}>
									<div className="flex items-start gap-2">
										<AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
										<div className="min-w-0">
											<p className="font-semibold text-foreground">{issue.title}</p>
											<p className="mt-1 text-muted-foreground text-sm">{issue.detail}</p>
										</div>
									</div>
									<div className="flex flex-wrap items-center gap-3 pl-6 text-xs">
										<span className="font-medium text-warning">
											{formatIssueSeverity(issue.severity)}
										</span>
										<details>
											<summary className="cursor-pointer font-medium text-muted-foreground">
												技术信息
											</summary>
											<code className="mt-2 block break-all text-muted-foreground">
												{issue.code}
											</code>
										</details>
									</div>
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</section>
	);
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid content-center gap-1 border-border border-b px-1 py-4 md:px-4 xl:border-b-0">
			<dt className="font-medium ui-metadata">{label}</dt>
			<dd className="font-semibold text-2xl text-foreground tabular-nums">{value}</dd>
		</div>
	);
}

export function RequestTrendChart({ trends }: { trends: OpsOverviewResponse["trends"] }) {
	if (trends.dataState === "UNAVAILABLE") {
		return (
			<div className="border border-warning/30 bg-warning-subtle p-4 text-warning" role="status">
				<p className="font-semibold">请求趋势暂不可用</p>
				<p className="mt-1 text-sm">
					{trends.reason ?? "请求总量和状态仍可查看，请稍后重新加载趋势。"}
				</p>
			</div>
		);
	}
	if (trends.data.length === 0) {
		return (
			<p className="border-border border-y py-8 text-center text-muted-foreground text-sm">
				{trends.dataState === "NO_DATA"
					? "当前窗口没有请求数据。"
					: (trends.reason ?? "当前没有可展示的趋势数据。")}
			</p>
		);
	}
	const dataWarning =
		trends.dataState === "STALE"
			? (trends.reason ?? "趋势刷新失败，当前显示上一次成功数据。")
			: trends.dataState === "PARTIAL"
				? (trends.reason ?? "当前趋势只包含部分统计数据。")
				: null;
	const dataWarningStatus = (
		<p
			aria-atomic="true"
			className={dataWarning ? "text-warning text-sm" : "sr-only"}
			role="status"
		>
			{dataWarning ?? ""}
		</p>
	);
	const [point] = trends.data;
	if (trends.data.length === 1 && point) {
		return (
			<div className="grid gap-4 border-border border-y py-4">
				{dataWarningStatus}
				<div>
					<p className="font-medium text-foreground">当前窗口只有一个统计点</p>
					<p className="mt-1 text-muted-foreground text-sm">
						{formatTimestamp(point.bucketStart)}，暂时无法形成变化趋势。
					</p>
				</div>
				<div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
					<TrendValue label="请求" value={point.total} />
					<TrendValue label="完成" value={point.completed} />
					<TrendValue label="失败" value={point.failed} />
					<TrendValue label="95% 耗时" value={formatDuration(point.p95DurationMs)} />
				</div>
			</div>
		);
	}
	const hasLatencyData = trends.data.some((point) => point.p95DurationMs !== null);
	return (
		<div className="grid gap-3">
			{dataWarningStatus}
			<div className="grid gap-6 lg:grid-cols-2">
				<div className="min-w-0 border-border border-y py-3">
					<p className="px-1 font-medium text-foreground text-sm">请求量与结果</p>
					<div aria-hidden="true" className="mt-2 h-48 min-w-0 sm:h-56">
						<ResponsiveContainer height="100%" width="100%">
							<LineChart
								accessibilityLayer={false}
								data={trends.data}
								margin={{ bottom: 8, left: 0, right: 8, top: 8 }}
							>
								<CartesianGrid
									stroke="var(--sys-border-subtle)"
									strokeDasharray="3 3"
									vertical={false}
								/>
								<XAxis
									dataKey="bucketStart"
									tickFormatter={(value) => formatChartTime(String(value))}
									tickLine={false}
								/>
								<YAxis allowDecimals={false} tickLine={false} width={36} />
								<Tooltip labelFormatter={(value) => formatTimestamp(String(value))} />
								<Legend />
								<Line
									dataKey="total"
									dot={false}
									name="请求"
									stroke="var(--ops-chart-primary)"
									strokeWidth={2}
									type="monotone"
								/>
								<Line
									dataKey="completed"
									dot={false}
									name="完成"
									stroke="var(--ops-chart-success)"
									strokeDasharray="7 4"
									strokeWidth={2}
									type="monotone"
								/>
								<Line
									dataKey="failed"
									dot={{ fill: "var(--ops-chart-danger)", r: 2, strokeWidth: 0 }}
									name="失败"
									stroke="var(--ops-chart-danger)"
									strokeDasharray="2 3"
									strokeWidth={2}
									type="monotone"
								/>
							</LineChart>
						</ResponsiveContainer>
					</div>
				</div>
				<div className="min-w-0 border-border border-y py-3">
					<p className="px-1 font-medium text-foreground text-sm">95% 耗时</p>
					{hasLatencyData ? (
						<div aria-hidden="true" className="mt-2 h-48 min-w-0 sm:h-56">
							<ResponsiveContainer height="100%" width="100%">
								<LineChart
									accessibilityLayer={false}
									data={trends.data}
									margin={{ bottom: 8, left: 0, right: 8, top: 8 }}
								>
									<CartesianGrid
										stroke="var(--sys-border-subtle)"
										strokeDasharray="3 3"
										vertical={false}
									/>
									<XAxis
										dataKey="bucketStart"
										tickFormatter={(value) => formatChartTime(String(value))}
										tickLine={false}
									/>
									<YAxis
										allowDecimals={false}
										tickFormatter={(value) => formatDuration(Number(value))}
										tickLine={false}
										width={72}
									/>
									<Tooltip
										formatter={(value) => [formatDuration(Number(value)), "95% 耗时"]}
										labelFormatter={(value) => formatTimestamp(String(value))}
									/>
									<Line
										dataKey="p95DurationMs"
										dot={{ r: 2 }}
										name="95% 耗时"
										stroke="var(--ops-chart-warning)"
										strokeWidth={2}
										type="monotone"
									/>
								</LineChart>
							</ResponsiveContainer>
						</div>
					) : (
						<p className="px-1 py-8 text-muted-foreground text-sm">当前没有耗时数据。</p>
					)}
				</div>
			</div>
			<TrendSummaryTable trends={trends.data} />
		</div>
	);
}

function TrendSummaryTable({ trends }: { trends: OpsOverviewResponse["trends"]["data"] }) {
	return (
		<div className="sr-only">
			<table>
				<caption>请求趋势数据</caption>
				<thead>
					<tr>
						<th scope="col">时间</th>
						<th scope="col">请求</th>
						<th scope="col">完成</th>
						<th scope="col">失败</th>
						<th scope="col">95% 耗时</th>
					</tr>
				</thead>
				<tbody>
					{trends.map((point) => (
						<tr key={point.bucketStart}>
							<th scope="row">{formatTimestamp(point.bucketStart)}</th>
							<td>{point.total}</td>
							<td>{point.completed}</td>
							<td>{point.failed}</td>
							<td>{formatDuration(point.p95DurationMs)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function TrendValue({ label, value }: { label: string; value: number | string }) {
	return (
		<div className="grid gap-1">
			<span className="ui-metadata">{label}</span>
			<span className="font-semibold text-foreground tabular-nums">{value}</span>
		</div>
	);
}

function formatChartTime(value: string) {
	const formatted = formatTimestamp(value);
	return formatted === value ? value : formatted.slice(11, 16);
}
