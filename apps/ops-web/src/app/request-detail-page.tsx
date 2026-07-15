import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { useRef } from "react";
import type { OpsObservabilityResponse, OpsRequestDetailResponse } from "../shared/ops-contract";
import { formatDuration, formatTimestamp } from "./format";
import { fetchOpsObservability, fetchOpsRequestDetail } from "./ops-api-client";
import {
	BudgetBadge,
	CopyableKeyValue,
	ErrorState,
	KeyValue,
	MetricTile,
	PageHeader,
	PageShell,
	StaleDataWarning,
	StatusBadge,
} from "./ops-display";
import {
	formatDataStateLabel,
	formatRequestCompletedAt,
	formatRequestDuration,
	formatStageTimingLabel,
	formatStatusLabel,
	normalizeRequestListReturnPath,
	orderedStageTimingEntries,
} from "./ops-view-helpers";
import { StepMobileList } from "./request-detail-panels";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { cn } from "./ui/cn";
import { DataTable } from "./ui/data-table";

export type RequestDetailTab = "execution" | "observability" | "overview";

const tabs: Array<{ label: string; value: RequestDetailTab }> = [
	{ label: "概览", value: "overview" },
	{ label: "执行", value: "execution" },
	{ label: "日志与调用链", value: "observability" },
];

export function RequestDetailPage({
	from,
	requestId,
	tab,
}: {
	from?: string;
	requestId: string;
	tab: RequestDetailTab;
}) {
	const detail = useQuery({
		queryFn: ({ signal }) => fetchOpsRequestDetail(requestId, { signal }),
		queryKey: ["ops", "requests", requestId],
		refetchInterval: (query) => {
			const status = query.state.data?.request.status;
			return status === "RUNNING" || status === "PENDING" ? 30_000 : false;
		},
		refetchIntervalInBackground: false,
	});
	const returnPath = normalizeRequestListReturnPath(from);

	if (detail.isPending) {
		return <PageShell title="请求详情">正在读取请求详情...</PageShell>;
	}
	if (detail.isError && !detail.data) {
		return (
			<section>
				<PageHeader
					actions={<BackToRequests href={returnPath} />}
					description="查看一次用户请求的结果、执行步骤和观测记录。"
					title="请求详情"
				/>
				<Card>
					<CardContent className="p-6">
						<ErrorState
							error={detail.error}
							onRetry={() => detail.refetch()}
							title="请求详情读取失败"
						/>
					</CardContent>
				</Card>
			</section>
		);
	}
	if (!detail.data) {
		return <PageShell title="请求详情">正在读取请求详情...</PageShell>;
	}

	return (
		<section>
			<PageHeader
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-slate-600 text-sm">
							最后刷新：{formatTimestamp(new Date(detail.dataUpdatedAt).toISOString())}
						</span>
						<Button
							aria-busy={detail.isFetching}
							disabled={detail.isFetching}
							onClick={() => detail.refetch()}
							variant="outline"
						>
							<RefreshCw className="size-4" />
							{detail.isFetching ? "刷新中" : "刷新"}
						</Button>
						<BackToRequests href={returnPath} />
					</div>
				}
				description="查看一次用户请求的结果、执行步骤和观测记录。"
				title="请求详情"
			/>
			{detail.isRefetchError ? (
				<StaleDataWarning
					error={detail.error}
					lastSuccessfulAt={detail.dataUpdatedAt}
					onRetry={() => void detail.refetch()}
					title="请求详情刷新失败"
				/>
			) : null}
			<nav
				aria-label="请求详情分区"
				className="mb-4 flex max-w-full gap-1 overflow-x-auto border-slate-200 border-b"
			>
				{tabs.map((item) => (
					<Link
						aria-current={tab === item.value ? "page" : undefined}
						className={cn(
							"min-h-11 shrink-0 border-b-2 px-4 py-3 font-semibold text-sm",
							tab === item.value
								? "border-slate-950 text-slate-950"
								: "border-transparent text-slate-600 hover:text-slate-950",
						)}
						key={item.value}
						params={{ requestId }}
						search={{ from, tab: item.value }}
						to="/requests/$requestId"
					>
						{item.label}
					</Link>
				))}
			</nav>
			{tab === "overview" ? <RequestOverview detail={detail.data} /> : null}
			{tab === "execution" ? <RequestExecution detail={detail.data} /> : null}
			{tab === "observability" ? <RequestObservability detail={detail.data} /> : null}
		</section>
	);
}

function BackToRequests({ href }: { href: string }) {
	return (
		<Button asChild variant="outline">
			<a href={href}>
				<ArrowLeft className="size-4" />
				返回请求列表
			</a>
		</Button>
	);
}

function RequestOverview({ detail }: { detail: OpsRequestDetailResponse }) {
	const failedStep = detail.stepTrajectory.find((step) => step.status === "FAILED");
	return (
		<div className="grid gap-4">
			<div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="request-triage-grid">
				<MetricTile label="请求状态" value={<StatusBadge status={detail.request.status} />} />
				<MetricTile label="总耗时" value={formatRequestDuration(detail.request)} />
				<MetricTile
					className="col-span-2 md:col-span-1"
					label="使用工具"
					value={detail.toolSummary.selectedTool ?? "未使用工具"}
				/>
				<MetricTile
					className="col-span-2 md:col-span-1"
					label="错误"
					value={detail.request.errorCode ?? failedStep?.outcome ?? "无错误"}
				/>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>关联信息</CardTitle>
				</CardHeader>
				<CardContent
					className="grid grid-cols-2 gap-x-3 text-sm xl:grid-cols-3"
					data-testid="request-correlation-grid"
				>
					<CopyableKeyValue label="requestId" value={detail.correlationIds.requestId} />
					<CopyableKeyValue label="traceId" value={detail.correlationIds.traceId} />
					<CopyableKeyValue label="conversationId" value={detail.correlationIds.conversationId} />
					<CopyableKeyValue label="runId" value={detail.correlationIds.runId} />
					<CopyableKeyValue label="workflowId" value={detail.correlationIds.workflowId} />
					{detail.correlationIds.missingCorrelationFields.length > 0 ? (
						<div className="col-span-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
							<p className="font-medium text-xs">缺少关联字段</p>
							<div className="mt-2 flex flex-wrap gap-2">
								{detail.correlationIds.missingCorrelationFields.map((field) => (
									<Badge key={field} tone="warning">
										{field}
									</Badge>
								))}
							</div>
						</div>
					) : null}
				</CardContent>
			</Card>
			<div className="grid gap-4 xl:grid-cols-3">
				<Card data-testid="request-status-card">
					<CardHeader>
						<CardTitle>请求结果</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-2 text-sm">
						<KeyValue label="状态" value={<StatusBadge status={detail.request.status} />} />
						<KeyValue label="开始时间" value={formatTimestamp(detail.request.startedAt)} />
						<KeyValue label="完成时间" value={formatRequestCompletedAt(detail.request)} />
						<KeyValue label="状态更新时间" value={formatTimestamp(detail.request.projectedAt)} />
					</CardContent>
				</Card>
				<Card data-testid="tool-outcome-card">
					<CardHeader>
						<CardTitle>工具与结果</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-2 text-sm">
						<KeyValue label="请求工具" value={detail.toolSummary.requestedTool ?? "未请求工具"} />
						<KeyValue label="实际工具" value={detail.toolSummary.selectedTool ?? "未选择工具"} />
						<KeyValue
							label="结果类型"
							value={formatStatusLabel(detail.outcomeSummary.semanticOutcome ?? "UNKNOWN")}
						/>
						<KeyValue
							label="检索范围"
							value={detail.outcomeSummary.resolvedTargets.join("、") || "未检索"}
						/>
						<KeyValue label="拒绝类型" value={detail.outcomeSummary.refusalClass ?? "无"} />
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>模型与安全</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-2 text-sm">
						<KeyValue label="服务商" value={detail.modelSummary.provider ?? "未知"} />
						<KeyValue label="模型" value={detail.modelSummary.model ?? "未知"} />
						<KeyValue label="提示词" value={detail.modelSummary.promptId ?? "未知"} />
						<KeyValue label="提示词版本" value={detail.modelSummary.promptVersion ?? "未知"} />
						<KeyValue
							label="访问控制"
							value={formatStatusLabel(detail.policySummary.aclDecision ?? "UNKNOWN")}
						/>
						<KeyValue
							label="安全校验"
							value={
								detail.policySummary.failClosed === null
									? "未记录"
									: detail.policySummary.failClosed
										? "未通过，已停止"
										: "通过"
							}
						/>
						<KeyValue label="访问控制异常" value={detail.policySummary.aclAnomalyCode ?? "无"} />
					</CardContent>
				</Card>
			</div>
			<Card data-testid="supporting-sources-card">
				<CardHeader>
					<CardTitle>依据来源</CardTitle>
				</CardHeader>
				<CardContent>
					{detail.sources.length === 0 ? (
						<p className="text-slate-500 text-sm">本次请求没有记录依据来源。</p>
					) : (
						<ul className="grid gap-2">
							{detail.sources.map((source) => (
								<li
									className="rounded-md border border-slate-200 p-3"
									key={`${source.canonicalUrl}:${source.versionId ?? "current"}`}
								>
									<p className="font-medium text-slate-950">{source.sourceTitle}</p>
									<p className="mt-1 break-all text-slate-500 text-xs">{source.canonicalUrl}</p>
									<div className="mt-2 flex flex-wrap gap-2">
										{source.sourceKind ? <Badge tone="muted">{source.sourceKind}</Badge> : null}
										{source.versionId ? <Badge tone="muted">版本 {source.versionId}</Badge> : null}
									</div>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function RequestExecution({ detail }: { detail: OpsRequestDetailResponse }) {
	const timings = orderedStageTimingEntries(detail.stageTiming, detail.stageTimingBudget);
	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader>
					<CardTitle>工作流摘要</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
					<KeyValue label="执行方式" value={detail.workflowSummary.mode ?? "未记录"} />
					<KeyValue label="处理分支" value={detail.workflowSummary.branch ?? "未记录"} />
					<KeyValue
						label="首次决策方"
						value={detail.workflowSummary.firstDecisionActor ?? "未记录"}
					/>
					<KeyValue label="规划结果" value={detail.workflowSummary.planningOutcome ?? "未记录"} />
					<KeyValue label="结束原因" value={detail.workflowSummary.terminalReason ?? "未记录"} />
					<KeyValue
						label="已选工具"
						value={detail.workflowSummary.selectedTools.join("、") || "未选择工具"}
					/>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>分段耗时</CardTitle>
				</CardHeader>
				<CardContent>
					{timings.length === 0 ? (
						<p className="text-slate-500 text-sm">没有分段耗时数据。</p>
					) : (
						<>
							<div className="grid gap-2 md:hidden" data-testid="stage-timing-mobile-list">
								{timings.map((timing) => (
									<div
										className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm"
										key={timing.key}
									>
										<div className="grid min-w-0 gap-1">
											<span className="font-medium text-slate-950" title={timing.key}>
												{formatStageTimingLabel(timing.key)}
											</span>
											<span className="text-slate-600 tabular-nums">
												{formatDuration(timing.value)}
											</span>
										</div>
										<BudgetBadge state={timing.budget} />
									</div>
								))}
							</div>
							<div className="hidden md:block">
								<DataTable
									caption="分段耗时"
									columns={[
										{
											cell: (row) => <span title={row.key}>{formatStageTimingLabel(row.key)}</span>,
											header: "阶段",
										},
										{ cell: (row) => formatDuration(row.value), header: "耗时" },
										{ cell: (row) => <BudgetBadge state={row.budget} />, header: "预算" },
									]}
									data={timings}
									minWidth="520px"
									rowKey={(row) => row.key}
								/>
							</div>
						</>
					)}
				</CardContent>
			</Card>
			<Card data-testid="step-trajectory-card">
				<CardHeader>
					<CardTitle>执行步骤</CardTitle>
				</CardHeader>
				<CardContent>
					{detail.stepTrajectory.length === 0 ? (
						<p className="text-slate-500 text-sm">没有执行步骤摘要。</p>
					) : (
						<>
							<StepMobileList steps={detail.stepTrajectory} />
							<div className="hidden md:block">
								<DataTable
									caption="执行步骤列表"
									columns={[
										{ cell: (row) => <StatusBadge status={row.status} />, header: "状态" },
										{ cell: (row) => row.stepId, header: "步骤 ID" },
										{ cell: (row) => row.spanKind, header: "类型" },
										{ cell: (row) => row.toolName ?? "无", header: "工具" },
										{ cell: (row) => row.outcome ?? "未记录", header: "结果" },
										{ cell: (row) => row.resultStatus ?? "未记录", header: "结果状态" },
										{ cell: (row) => row.retryCount, header: "重试" },
										{ cell: (row) => row.parentStepId ?? "无", header: "上一步" },
									]}
									data={detail.stepTrajectory}
									minWidth="860px"
									rowKey={(row) => row.stepId}
								/>
							</div>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function RequestObservability({ detail }: { detail: OpsRequestDetailResponse }) {
	const logs = useQuery({
		queryFn: ({ signal }) => fetchOpsObservability(detail.request.requestId, "logs", { signal }),
		queryKey: ["ops", "observability", detail.request.requestId, "logs"],
	});
	const trace = useQuery({
		queryFn: ({ signal }) => fetchOpsObservability(detail.request.requestId, "trace", { signal }),
		queryKey: ["ops", "observability", detail.request.requestId, "trace"],
	});
	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader>
					<CardTitle>相关系统</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-2">
					<div className="grid gap-1 rounded-md border border-slate-200 px-3 py-2 text-sm">
						<div className="flex items-center justify-between gap-2">
							<span className="font-medium">调用链状态</span>
							<Badge tone={detail.traceSummary.available ? "success" : "warning"}>
								{detail.traceSummary.available ? "可用" : "不可用"}
							</Badge>
						</div>
						<span className="text-slate-500 text-xs">
							记录时间：
							{detail.traceSummary.updatedAt
								? formatTimestamp(detail.traceSummary.updatedAt)
								: "未记录"}
						</span>
						<span className="text-slate-500 text-xs">
							写入延迟：
							{detail.traceSummary.projectionLagMs === null
								? "未记录"
								: formatDuration(detail.traceSummary.projectionLagMs)}
						</span>
					</div>
					{detail.externalLinks.length === 0 ? (
						<p className="text-slate-500 text-sm">没有可用的外部入口。</p>
					) : (
						detail.externalLinks.map((link) =>
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
							) : null,
						)
					)}
				</CardContent>
			</Card>
			<div className="grid gap-4 xl:grid-cols-2">
				<ObservabilityPanel kind="logs" query={logs} title="日志" />
				<ObservabilityPanel kind="trace" query={trace} title="调用链" />
			</div>
		</div>
	);
}

function ObservabilityPanel({
	kind,
	query,
	title,
}: {
	kind: "logs" | "trace";
	query: ReturnType<typeof useQuery<OpsObservabilityResponse>>;
	title: string;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent className="grid gap-3">
				{query.isPending ? (
					<p className="text-slate-500 text-sm" role="status">
						正在读取{title}...
					</p>
				) : null}
				{query.isError ? (
					<ErrorState
						error={query.error}
						onRetry={() => query.refetch()}
						title={`${title}读取失败`}
					/>
				) : null}
				{query.data ? (
					<>
						<div className="flex flex-wrap gap-2 text-xs">
							<Badge tone={query.data.dataState === "FRESH" ? "success" : "warning"}>
								{formatDataStateLabel(query.data.dataState)}
							</Badge>
							<Badge tone="muted">{query.data.records.length} 条</Badge>
							<Badge tone="muted">查询 {formatDuration(query.data.queryDurationMs)}</Badge>
							{query.data.truncated ? <Badge tone="warning">结果已截断</Badge> : null}
						</div>
						<VirtualRecordList kind={kind} records={query.data.records} />
					</>
				) : null}
			</CardContent>
		</Card>
	);
}

function VirtualRecordList({
	kind,
	records,
}: {
	kind: "logs" | "trace";
	records: OpsObservabilityResponse["records"];
}) {
	const parentRef = useRef<HTMLDivElement>(null);
	const viewportHeight = Math.min(420, Math.max(160, records.length * 144));
	const virtualizer = useVirtualizer({
		count: records.length,
		estimateSize: () => 144,
		getScrollElement: () => parentRef.current,
		initialRect: { height: viewportHeight, width: 720 },
		overscan: 6,
	});
	if (records.length === 0) {
		return (
			<p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-slate-500 text-sm">
				当前请求没有{kind === "logs" ? "日志" : "调用链"}记录。
			</p>
		);
	}
	return (
		<div
			className="overflow-auto rounded-md border border-slate-200 bg-slate-950"
			data-testid={`observability-record-viewport-${kind}`}
			ref={parentRef}
			style={{ height: `${viewportHeight}px` }}
		>
			<ul
				aria-label={`${kind === "logs" ? "日志" : "调用链"}原始记录`}
				className="relative w-full"
				style={{ height: `${virtualizer.getTotalSize()}px` }}
			>
				{virtualizer.getVirtualItems().length === 0 ? (
					<li className="absolute left-0 top-0 w-full px-3 py-2">
						<pre className="max-w-full overflow-x-auto whitespace-pre rounded-md border border-slate-700 bg-slate-900 p-3 font-mono text-slate-100 text-xs">
							{JSON.stringify(records[0], null, 2)}
						</pre>
					</li>
				) : (
					virtualizer.getVirtualItems().map((item) => (
						<li
							className="absolute left-0 top-0 w-full px-3 py-2"
							data-index={item.index}
							key={item.key}
							ref={virtualizer.measureElement}
							style={{ transform: `translateY(${item.start}px)` }}
						>
							<pre className="max-w-full overflow-x-auto whitespace-pre rounded-md border border-slate-700 bg-slate-900 p-3 font-mono text-slate-100 text-xs">
								{JSON.stringify(records[item.index], null, 2)}
							</pre>
						</li>
					))
				)}
			</ul>
		</div>
	);
}
