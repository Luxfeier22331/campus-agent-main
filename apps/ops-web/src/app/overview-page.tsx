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
	MetricTile,
	PageHeader,
	PageShell,
	StaleDataWarning,
	StatusBadge,
} from "./ops-display";
import { formatDataStateLabel } from "./ops-view-helpers";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
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
						<label className="grid gap-1 text-sm">
							<span className="font-medium text-slate-600">统计窗口</span>
							<select
								aria-label="统计窗口"
								className="min-h-11 rounded-md border border-slate-200 bg-white px-3 text-sm"
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
							</select>
						</label>
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
				description="查看服务可用性、请求结果、Temporal 队列和观测数据是否持续写入。"
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
					className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-sm"
					role="alert"
				>
					当前显示缓存数据，数据生成于 {formatTimestamp(data.generatedAt)}。
				</div>
			) : null}

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				<Card className="md:col-span-2 xl:col-span-1">
					<CardHeader>
						<CardTitle>整体状态</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-3 text-sm">
						<StatusBadge status={data.health.status} />
						<p className="text-slate-600">
							{data.health.reasons.length > 0 ? data.health.reasons.join("；") : "未发现阻塞问题。"}
						</p>
						<span className="text-slate-500 text-xs">
							数据状态：{formatDataStateLabel(data.health.dataState)}
						</span>
					</CardContent>
				</Card>
				<MetricTile
					label="请求总数"
					value={data.requests.total.toLocaleString("en-US")}
					valueClassName="text-2xl"
				/>
				<MetricTile
					label="请求成功率"
					value={
						data.requests.successRate === null ? "无数据" : formatPercent(data.requests.successRate)
					}
					valueClassName="text-2xl"
				/>
				<MetricTile
					label="95% 请求耗时"
					value={
						data.requests.p95DurationMs === null
							? "无数据"
							: formatDuration(data.requests.p95DurationMs)
					}
					valueClassName="text-2xl"
				/>
			</div>

			<div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
				<Card>
					<CardHeader>
						<CardTitle>请求趋势</CardTitle>
					</CardHeader>
					<CardContent>
						<RequestTrendChart trends={data.trends} />
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>当前问题</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-3">
						{data.issues.length === 0 ? (
							<p className="text-slate-500 text-sm">当前没有需要处理的问题。</p>
						) : (
							data.issues.map((issue) => (
								<div
									className="grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-3"
									key={issue.code}
								>
									<div className="flex items-start gap-2">
										<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
										<div className="min-w-0">
											<p className="font-semibold text-amber-950">{issue.title}</p>
											<p className="mt-1 text-amber-800 text-sm">{issue.detail}</p>
										</div>
									</div>
									<div className="flex flex-wrap gap-2">
										<Badge tone={issue.severity === "CRITICAL" ? "danger" : "warning"}>
											{formatIssueSeverity(issue.severity)}
										</Badge>
										<details className="text-xs">
											<summary className="cursor-pointer font-medium text-amber-900">
												技术信息
											</summary>
											<code className="mt-2 block break-all text-amber-800">{issue.code}</code>
										</details>
									</div>
								</div>
							))
						)}
					</CardContent>
				</Card>
			</div>

			<div className="mt-4 grid gap-4 2xl:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>服务状态</CardTitle>
					</CardHeader>
					<CardContent>
						<ServiceStatusMobileList services={data.services} />
						<div className="hidden md:block">
							<DataTable
								caption="服务状态"
								columns={[
									{ cell: (row) => row.displayName, header: "服务" },
									{ cell: (row) => <StatusBadge status={row.status} />, header: "状态" },
									{ cell: (row) => formatDataStateLabel(row.dataState), header: "数据" },
									{ cell: (row) => row.reason ?? "无异常", header: "说明" },
								]}
								data={data.services}
								minWidth="560px"
								rowKey={(row) => row.name}
							/>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Temporal 队列</CardTitle>
					</CardHeader>
					<CardContent>
						{data.temporal.queues.length === 0 ? (
							<p className="text-slate-500 text-sm">没有可展示的任务队列。</p>
						) : (
							<>
								<TemporalQueueMobileList queues={data.temporal.queues} />
								<div className="hidden md:block">
									<DataTable
										caption="Temporal 队列状态"
										columns={[
											{
												cell: (row) => (
													<div className="grid min-w-[220px] gap-1">
														<span className="break-all">{row.taskQueue}</span>
														{row.reason ? (
															<span className="text-slate-500 text-xs">{row.reason}</span>
														) : null}
													</div>
												),
												header: "队列",
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
					</CardContent>
				</Card>
			</div>

			<div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
				<Card>
					<CardHeader>
						<CardTitle>观测数据</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-3 sm:grid-cols-3">
						{data.telemetry.signals.map((signal) => (
							<KeyValue
								key={signal.kind}
								label={telemetryLabel(signal.kind)}
								value={
									<div className="grid gap-2">
										<StatusBadge status={signal.status} />
										<span className="tabular-nums">
											{signal.recordCount === null
												? "无数据"
												: `${signal.recordCount.toLocaleString("en-US")} 条`}
										</span>
									</div>
								}
							/>
						))}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>相关系统</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-2 text-sm">
						{data.externalLinks.map((link) =>
							link.href && link.isAvailable ? (
								<a
									className="inline-flex min-h-11 items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-slate-700 hover:bg-slate-50"
									href={link.href}
									key={link.source}
									rel="noreferrer"
									target="_blank"
								>
									<span>{link.label}</span>
									<ExternalLink className="size-4" />
								</a>
							) : (
								<div
									className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-slate-500"
									key={link.source}
								>
									<span>{link.label}</span>
									<Badge tone="muted">未配置</Badge>
								</div>
							),
						)}
					</CardContent>
				</Card>
			</div>
		</section>
	);
}

function ServiceStatusMobileList({ services }: { services: OpsOverviewResponse["services"] }) {
	return (
		<div className="divide-y divide-slate-100 md:hidden" data-testid="service-status-mobile-list">
			{services.map((service) => (
				<div className="grid gap-2 py-3 first:pt-0 last:pb-0" key={service.name}>
					<div className="flex items-start justify-between gap-3">
						<span className="font-semibold text-slate-950">{service.displayName}</span>
						<StatusBadge status={service.status} />
					</div>
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600 text-xs">
						<span>数据：{formatDataStateLabel(service.dataState)}</span>
						<span>{service.reason ?? "无异常"}</span>
					</div>
				</div>
			))}
		</div>
	);
}

function TemporalQueueMobileList({
	queues,
}: {
	queues: OpsOverviewResponse["temporal"]["queues"];
}) {
	return (
		<div className="divide-y divide-slate-100 md:hidden" data-testid="temporal-queue-mobile-list">
			{queues.map((queue) => (
				<div
					className="grid gap-3 py-3 first:pt-0 last:pb-0"
					key={`${queue.taskQueue}:${queue.name}`}
				>
					<div className="flex min-w-0 items-start justify-between gap-3">
						<span className="min-w-0 break-all font-semibold text-slate-950">
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
					{queue.reason ? <p className="text-slate-600 text-xs">{queue.reason}</p> : null}
				</div>
			))}
		</div>
	);
}

function QueueMetric({ label, value }: { label: string; value: number | string }) {
	return (
		<div className="grid gap-1 rounded-md bg-slate-50 p-2">
			<span className="text-slate-500">{label}</span>
			<span className="font-semibold text-slate-950 tabular-nums">{value}</span>
		</div>
	);
}

function RequestTrendChart({ trends }: { trends: OpsOverviewResponse["trends"] }) {
	if (trends.length === 0) {
		return <p className="py-20 text-center text-slate-500 text-sm">当前窗口没有请求数据。</p>;
	}
	return (
		<div aria-label="请求趋势" className="h-56 min-w-0 sm:h-72" role="img">
			<ResponsiveContainer height="100%" width="100%">
				<LineChart data={trends} margin={{ bottom: 8, left: 0, right: 8, top: 8 }}>
					<CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
					<XAxis
						dataKey="bucketStart"
						tickFormatter={(value) => formatChartTime(String(value))}
						tickLine={false}
					/>
					<YAxis allowDecimals={false} tickLine={false} width={36} />
					<Tooltip labelFormatter={(value) => formatTimestamp(String(value))} />
					<Legend />
					<Line
						dataKey="completed"
						dot={false}
						name="完成"
						stroke="#0f766e"
						strokeWidth={2}
						type="monotone"
					/>
					<Line
						dataKey="failed"
						dot={false}
						name="失败"
						stroke="#dc2626"
						strokeWidth={2}
						type="monotone"
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

function formatChartTime(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? value : date.toISOString().slice(11, 16);
}

function telemetryLabel(kind: "LOGS" | "METRICS" | "TRACES") {
	return { LOGS: "日志", METRICS: "指标", TRACES: "调用链" }[kind];
}
