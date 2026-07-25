import { Button, Field, NativeSelect } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
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
import { fetchOpsOverview } from "./ops-api-client";
import {
	ErrorState,
	formatIssueSeverity,
	KeyValue,
	PageHeader,
	PageShell,
	StaleDataWarning,
	StatusBadge,
} from "./ops-display";
import { formatDataStateLabel, formatStatusLabel } from "./ops-view-helpers";
import { DataTable } from "./ui/data-table";

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
				description="确认产品请求、执行队列和观测链路是否正常。"
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
				<div
					className="mb-4 rounded-md border border-warning/20 bg-warning-subtle px-3 py-2 text-warning text-sm"
					role="alert"
				>
					部分来源显示旧数据，最旧结果距本次刷新约 {formatDuration(data.cache.ageMs)}。
				</div>
			) : null}

			<dl className="grid border-border border-y md:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-border">
				<div className="grid content-start gap-2 border-border border-b px-1 py-4 md:border-r md:px-4 xl:border-b-0 xl:border-r-0 xl:pl-0">
					<dt className="font-medium text-muted-foreground text-xs">整体状态</dt>
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

			<div className="mt-8 grid items-start gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] xl:gap-0">
				<section className="min-w-0 border-border border-b pb-8 xl:border-b-0 xl:border-r xl:pr-8">
					<h2 className="mb-4 font-semibold text-lg">请求趋势</h2>
					<RequestTrendChart trends={data.trends} />
				</section>
				<section className="min-w-0 border-border border-b pb-8 xl:border-b-0 xl:pl-8">
					<h2 className="mb-4 font-semibold text-lg">当前问题</h2>
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

			<div className="mt-8 grid gap-8 2xl:grid-cols-2">
				<section className="min-w-0">
					<h2 className="mb-4 font-semibold text-lg">服务状态</h2>
					{data.services.length === 0 ? (
						<p className="text-muted-foreground text-sm">暂无服务状态。</p>
					) : null}
					<ServiceStatusMobileList services={data.services} />
					<div className="hidden md:block">
						<DataTable
							caption="服务状态"
							columns={[
								{ cell: (row) => row.displayName, header: "服务", rowHeader: true },
								{
									cell: (row) => (
										<div className="flex flex-wrap items-center gap-2">
											<StatusBadge status={row.status} />
											<AbnormalDataState state={row.dataState} />
										</div>
									),
									header: "状态",
								},
								{ cell: (row) => formatTimestamp(row.updatedAt), header: "检查时间" },
							]}
							data={data.services}
							minWidth="560px"
							rowKey={(row) => row.name}
						/>
					</div>
				</section>
				<section className="min-w-0">
					<h2 className="mb-4 font-semibold text-lg">Temporal 队列</h2>
					{data.temporal.queues.length === 0 ? (
						<p className="text-muted-foreground text-sm">没有可展示的任务队列。</p>
					) : (
						<>
							<TemporalQueueMobileList queues={data.temporal.queues} />
							<div className="hidden md:block">
								<DataTable
									caption="Temporal 队列状态"
									columns={[
										{
											cell: (row) => <span className="break-all">{row.taskQueue}</span>,
											header: "队列",
											rowHeader: true,
										},
										{ cell: (row) => <StatusBadge status={row.status} />, header: "状态" },
										{ cell: (row) => row.pollerCount, header: "工作进程" },
										{ cell: (row) => row.backlogCount, header: "积压" },
										{
											cell: (row) =>
												row.oldestTaskAgeMs === null
													? "无数据"
													: formatDuration(row.oldestTaskAgeMs),
											header: "最久等待",
										},
									]}
									data={data.temporal.queues}
									minWidth="620px"
									rowKey={(row) => `${row.taskQueue}:${row.name}`}
								/>
							</div>
						</>
					)}
				</section>
			</div>

			<div className="mt-8 grid items-start gap-8 border-border border-t pt-8 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
				<section className="min-w-0">
					<h2 className="mb-4 font-semibold text-lg">观测数据</h2>
					{data.telemetry.dataState === "FRESH" ? null : (
						<p className="mb-3 font-medium text-warning text-sm">
							数据状态：{formatDataStateLabel(data.telemetry.dataState)}
						</p>
					)}
					{data.telemetry.reason ? (
						<p className="mb-3 text-muted-foreground text-sm">{data.telemetry.reason}</p>
					) : null}
					{data.telemetry.signals.length === 0 ? (
						<p className="text-muted-foreground text-sm">没有可展示的观测数据。</p>
					) : (
						<div className="grid gap-3 sm:grid-cols-3">
							{data.telemetry.signals.map((signal) => (
								<KeyValue
									key={signal.kind}
									label={telemetryLabel(signal.kind)}
									value={<TelemetrySignalValue signal={signal} />}
								/>
							))}
						</div>
					)}
				</section>
				<section className="min-w-0">
					<h2 className="mb-4 font-semibold text-lg">相关系统</h2>
					<div className="grid gap-2 text-sm">
						{data.externalLinks.length === 0 ? (
							<p className="text-muted-foreground">暂无已配置入口。</p>
						) : null}
						{data.externalLinks.map((link) =>
							link.href && link.isAvailable ? (
								<a
									className="inline-flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-foreground hover:bg-secondary"
									href={link.href}
									key={link.source}
									rel="noreferrer"
									target="_blank"
								>
									<span>{link.label}</span>
									<ExternalLink className="size-4" />
								</a>
							) : null,
						)}
					</div>
				</section>
			</div>
		</section>
	);
}

function ServiceStatusMobileList({ services }: { services: OpsOverviewResponse["services"] }) {
	return (
		<div className="divide-y divide-border md:hidden" data-testid="service-status-mobile-list">
			{services.map((service) => (
				<div className="grid gap-2 py-3 first:pt-0 last:pb-0" key={service.name}>
					<div className="flex items-start justify-between gap-3">
						<span className="font-semibold text-foreground">{service.displayName}</span>
						<StatusBadge status={service.status} />
					</div>
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
						<AbnormalDataState state={service.dataState} />
						<span>{formatTimestamp(service.updatedAt)}</span>
					</div>
				</div>
			))}
		</div>
	);
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid content-center gap-1 border-border border-b px-1 py-4 md:px-4 xl:border-b-0">
			<dt className="font-medium text-muted-foreground text-xs">{label}</dt>
			<dd className="font-semibold text-2xl text-foreground tabular-nums">{value}</dd>
		</div>
	);
}

function AbnormalDataState({ state }: { state: OpsOverviewResponse["health"]["dataState"] }) {
	return state === "FRESH" ? null : (
		<span className="font-medium text-warning">数据：{formatDataStateLabel(state)}</span>
	);
}

function TelemetrySignalValue({
	signal,
}: {
	signal: OpsOverviewResponse["telemetry"]["signals"][number];
}) {
	return (
		<div className="grid gap-1">
			<span className="font-semibold tabular-nums">
				{signal.recordCount === null
					? "无数据"
					: `${signal.recordCount.toLocaleString("en-US")} 条`}
			</span>
			{signal.status === "HEALTHY" ? null : (
				<span
					className={signal.status === "OUTAGE" ? "text-danger text-xs" : "text-warning text-xs"}
				>
					{formatStatusLabel(signal.status)}
				</span>
			)}
		</div>
	);
}

function TemporalQueueMobileList({
	queues,
}: {
	queues: OpsOverviewResponse["temporal"]["queues"];
}) {
	return (
		<div className="divide-y divide-border md:hidden" data-testid="temporal-queue-mobile-list">
			{queues.map((queue) => (
				<div
					className="grid gap-3 py-3 first:pt-0 last:pb-0"
					key={`${queue.taskQueue}:${queue.name}`}
				>
					<div className="flex min-w-0 items-start justify-between gap-3">
						<span className="min-w-0 break-all font-semibold text-foreground text-sm">
							{queue.taskQueue}
						</span>
						<StatusBadge status={queue.status} />
					</div>
					<div className="grid grid-cols-3 gap-2 text-xs">
						<QueueMetric label="工作进程" value={queue.pollerCount} />
						<QueueMetric label="积压" value={queue.backlogCount} />
						<QueueMetric
							label="最久等待"
							value={
								queue.oldestTaskAgeMs === null ? "无数据" : formatDuration(queue.oldestTaskAgeMs)
							}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

function QueueMetric({ label, value }: { label: string; value: number | string }) {
	return (
		<div className="grid gap-1 rounded-md bg-secondary p-2">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-semibold text-foreground tabular-nums">{value}</span>
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
	if (trends.data.length === 1) {
		const point = trends.data[0];
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
									strokeWidth={2}
									type="monotone"
								/>
								<Line
									dataKey="failed"
									dot={false}
									name="失败"
									stroke="var(--ops-chart-danger)"
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
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="font-semibold text-foreground tabular-nums">{value}</span>
		</div>
	);
}

function formatChartTime(value: string) {
	const formatted = formatTimestamp(value);
	return formatted === value ? value : formatted.slice(11, 16);
}

function telemetryLabel(kind: "LOGS" | "METRICS" | "TRACES") {
	return { LOGS: "日志", METRICS: "指标", TRACES: "调用链" }[kind];
}
