import { Alert, Button, cn } from "@campus-agent/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import type {
	OpsRequestListResponse,
	OpsRequestListView,
	OpsRequestSummary,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { fetchOpsRequests } from "./ops-api/observability";
import {
	CopyIconButton,
	ErrorState,
	PageHeader,
	PageShell,
	StaleDataWarning,
	StatusBadge,
} from "./ops-display";
import { formatLifecyclePhase, formatOpsDomainValue } from "./ops-domain-labels";
import {
	cleanRequestSearch,
	formatRequestDuration,
	formatRequestViewLabel,
	type RequestSearchLike,
	requestFilterLabels,
	requestListPath,
} from "./ops-view-helpers";
import { RequestFilters } from "./request-filters";
import { DataTable } from "./ui/data-table";

export function RequestsPage({
	ignoredParams,
	search,
}: {
	ignoredParams?: string[];
	search: RequestSearchLike;
}) {
	const view = search.view ?? "recent";
	const querySearch = cleanRequestSearch(search);
	const requests = useQuery({
		...(search.cursor ? { placeholderData: keepPreviousData } : {}),
		queryFn: ({ signal }) => fetchOpsRequests(search, { signal }),
		queryKey: ["ops", "requests", querySearch],
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});

	if (requests.isPending) {
		return <PageShell title="运行诊断">正在读取运行诊断...</PageShell>;
	}
	if (requests.isError && !requests.data) {
		return (
			<section>
				<PageHeader description="按 request 查看执行状态、产品结果和失败事实。" title="运行诊断" />
				<RequestFilters search={search} />
				<div className="mt-4">
					<ErrorState
						error={requests.error}
						onRetry={() => requests.refetch()}
						title="运行诊断读取失败"
					/>
				</div>
			</section>
		);
	}
	if (!requests.data) {
		return <PageShell title="运行诊断">正在读取运行诊断...</PageShell>;
	}

	const activeFilterLabels = requestFilterLabels(search);
	const hasActiveFilters = activeFilterLabels.length > 0;
	const ignoredParamNames = ignoredParams ?? [];
	const isRefreshing = requests.isFetching;
	const selectedCount = search.status
		? requests.data.statusCounts[statusCountKey(search.status)]
		: requests.data.statusCounts.total;

	return (
		<section>
			<PageHeader
				actions={
					<Button
						aria-busy={isRefreshing}
						aria-label={isRefreshing ? "刷新中" : "刷新运行诊断"}
						className="self-start lg:self-auto"
						disabled={isRefreshing}
						onClick={() => void requests.refetch()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						<span>{isRefreshing ? "刷新中" : "刷新"}</span>
					</Button>
				}
				description="按 request 查看执行状态、产品结果和失败事实。"
				title="运行诊断"
			/>
			{requests.isRefetchError ? (
				<StaleDataWarning
					error={requests.error}
					lastSuccessfulAt={requests.dataUpdatedAt}
					onRetry={() => void requests.refetch()}
					title="运行诊断刷新失败"
				/>
			) : null}
			{ignoredParamNames.length > 0 ? (
				<Alert className="mb-4" tone="warning" role="note">
					已忽略无效筛选参数：<span className="font-mono">{ignoredParamNames.join("、")}</span>
				</Alert>
			) : null}
			<RequestFilters search={search} />
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<span className="font-medium text-foreground">
						运行范围：{formatRequestViewLabel(view)}
					</span>
					<span className="font-medium text-foreground">
						共 {selectedCount} 条，当前显示 {requests.data.data.length} 条
					</span>
					<span
						className="text-muted-foreground"
						title={formatTimestamp(requests.data.generatedAt)}
					>
						更新于 {formatTimestamp(requests.data.generatedAt)}
					</span>
				</div>
				{hasActiveFilters ? (
					<Link
						className="font-medium text-info hover:underline"
						search={cleanRequestSearch({ view: search.view })}
						to="/requests"
					>
						清除筛选
					</Link>
				) : null}
			</div>
			{hasActiveFilters ? (
				<p className="mb-3 ui-metadata text-muted-foreground">
					已应用：{activeFilterLabels.join("、")}
				</p>
			) : null}
			{requests.isPlaceholderData ? (
				<p className="mb-3 text-warning text-sm" role="status">
					正在读取新筛选结果，当前列表仍是上一组数据。
				</p>
			) : null}
			{requests.data.data.length === 0 ? (
				<RequestListEmptyState hasActiveFilters={hasActiveFilters} view={view} />
			) : (
				<>
					<RequestMobileList
						generatedAt={requests.data.generatedAt}
						requests={requests.data.data}
						search={search}
					/>
					<div className="hidden xl:block">
						<DataTable<OpsRequestSummary>
							caption="运行诊断"
							columns={createRequestColumns(requests.data.generatedAt, search)}
							data={requests.data.data}
							minWidth="1000px"
							rowKey={(row) => row.requestId}
						/>
					</div>
				</>
			)}
			{search.cursor || requests.data.page.nextCursor ? (
				<div className="mt-4">
					<RequestPagination nextCursor={requests.data.page.nextCursor} search={search} />
				</div>
			) : null}
		</section>
	);
}

function RequestPagination({
	nextCursor,
	search,
}: {
	nextCursor: string | null;
	search: RequestSearchLike;
}) {
	return (
		<nav aria-label="运行诊断分页" className="flex items-center gap-3">
			{search.cursor ? (
				<Link
					className="font-medium text-info hover:underline"
					search={cleanRequestSearch({ ...search, cursor: undefined })}
					to="/requests"
				>
					返回第一页
				</Link>
			) : null}
			{nextCursor ? (
				<Link
					className="font-medium text-info hover:underline"
					search={cleanRequestSearch({ ...search, cursor: nextCursor })}
					to="/requests"
				>
					下一页
				</Link>
			) : null}
		</nav>
	);
}

function statusCountKey(
	status: NonNullable<RequestSearchLike["status"]>,
): keyof OpsRequestListResponse["statusCounts"] {
	return status === "ACTION_REQUIRED"
		? "actionRequired"
		: status === "CANCELLED"
			? "cancelled"
			: (status.toLowerCase() as keyof OpsRequestListResponse["statusCounts"]);
}

function RequestListEmptyState({
	hasActiveFilters,
	view,
}: {
	hasActiveFilters: boolean;
	view: OpsRequestListView;
}) {
	return (
		<div className="border-border border-y bg-secondary p-4 text-sm">
			<p className="font-medium text-foreground">
				{hasActiveFilters
					? "没有匹配的运行诊断。"
					: view === "attention"
						? "当前没有需要关注的运行。"
						: "当前时间范围内没有运行诊断。"}
			</p>
			<p className="mt-1 text-muted-foreground">
				{hasActiveFilters ? "调整或清除筛选条件后重试。" : "这不表示运行故障。"}
			</p>
		</div>
	);
}

function RequestMobileList({
	generatedAt,
	requests,
	search,
}: {
	generatedAt: string;
	requests: OpsRequestSummary[];
	search: RequestSearchLike;
}) {
	return (
		<div className="divide-y divide-border xl:hidden" data-testid="request-mobile-list">
			{requests.map((request) => (
				<article
					className="grid gap-3 py-4 first:pt-0"
					data-testid="request-mobile-card"
					key={request.requestId}
				>
					<div className="flex items-start justify-between gap-3">
						<span className="ui-metadata text-muted-foreground">
							{formatTimestamp(request.startedAt)}
						</span>
						<div className="grid justify-items-end gap-1">
							<StatusBadge status={request.status} />
							{request.attentionReason ? (
								<div className="grid justify-items-end gap-0.5">
									<span className="ui-metadata text-muted-foreground">关注原因</span>
									<RequestAttentionReason request={request} />
								</div>
							) : null}
						</div>
					</div>
					<Link
						className="break-words font-semibold text-foreground underline-offset-4 hover:underline"
						params={{ requestId: request.requestId }}
						search={{ from: requestListPath(search) }}
						to="/requests/$requestId"
					>
						{questionPreview(request)}
					</Link>
					<RequestProductResult request={request} />
					<RequestExecutionStage request={request} />
					<div className="flex justify-end text-xs">
						<span className="font-medium text-foreground">
							{formatRequestDuration(request, generatedAt)}
						</span>
					</div>
					<div className="flex min-w-0 items-center gap-1">
						<span
							className="truncate font-mono ui-metadata text-muted-foreground"
							title={request.requestId}
						>
							{request.requestId}
						</span>
						<CopyIconButton
							contextLabel={request.requestId}
							label="requestId"
							value={request.requestId}
						/>
					</div>
				</article>
			))}
		</div>
	);
}

function createRequestColumns(generatedAt: string, search: RequestSearchLike) {
	return [
		{
			cell: (row: OpsRequestSummary) => (
				<div className="grid min-w-[260px] gap-1">
					<Link
						className="line-clamp-2 font-medium text-foreground underline-offset-4 hover:underline"
						params={{ requestId: row.requestId }}
						search={{ from: requestListPath(search) }}
						to="/requests/$requestId"
					>
						{questionPreview(row)}
					</Link>
					<div className="flex min-w-0 items-center gap-2 text-xs">
						<span className="text-muted-foreground">{formatTimestamp(row.startedAt)}</span>
						<span className="text-muted-foreground" aria-hidden="true">
							·
						</span>
						<span className="truncate font-mono text-muted-foreground" title={row.requestId}>
							{row.requestId}
						</span>
						<CopyIconButton contextLabel={row.requestId} label="requestId" value={row.requestId} />
					</div>
				</div>
			),
			header: "用户问题",
			rowHeader: true,
		},
		{
			cell: (row: OpsRequestSummary) => <RequestProductResult request={row} />,
			header: "产品结果",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<div className="grid min-w-[110px] gap-1">
					<StatusBadge status={row.status} />
				</div>
			),
			header: "产品状态",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<RequestExecutionStage className="min-w-[190px]" request={row} />
			),
			header: "执行诊断",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<div className="min-w-[140px]">
					<RequestAttentionReason request={row} />
				</div>
			),
			header: "关注原因",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<span className="block min-w-[120px] whitespace-nowrap tabular-nums">
					{formatRequestDuration(row, generatedAt)}
				</span>
			),
			header: "耗时",
		},
	];
}

function questionPreview(request: OpsRequestSummary) {
	return `${request.question.preview}${request.question.truncated ? "…" : ""}`;
}

function RequestExecutionStage({
	className,
	request,
}: {
	className?: string;
	request: OpsRequestSummary;
}) {
	const stage = request.executionStage;
	return (
		<div className={cn("grid gap-1 text-sm", className)}>
			<span className="ui-metadata text-muted-foreground">执行阶段</span>
			<span className="font-medium text-foreground">
				{stage
					? `${formatOpsDomainValue(stage.toolName ?? stage.kind)} · ${formatOpsDomainValue(stage.status)}`
					: formatLifecyclePhase(request.lifecyclePhase)}
			</span>
			{request.failureKind ? (
				<span className="text-danger text-xs">
					失败类型：{formatOpsDomainValue(request.failureKind)}
				</span>
			) : null}
		</div>
	);
}

function RequestProductResult({ request }: { request: OpsRequestSummary }) {
	return (
		<div className="grid min-w-[150px] gap-1 text-sm">
			<span className="ui-metadata text-muted-foreground">产品结果</span>
			<span className="font-medium text-foreground">{formatResultSummary(request)}</span>
		</div>
	);
}

function formatResultSummary(request: OpsRequestSummary) {
	if (request.result.state === "WRITTEN") {
		return request.result.kind === "error" ? "错误结果已写入会话" : "回答已写入会话";
	}
	return request.result.state === "MISSING" ? "会话结果缺失" : "尚未写入会话结果";
}

function RequestAttentionReason({ request }: { request: OpsRequestSummary }) {
	if (!request.attentionReason) {
		return null;
	}
	const labels = {
		EXECUTION_STAGE_FAILED: "执行阶段失败",
		REQUEST_FAILED: "产品请求失败",
		RESULT_MISSING: "会话结果缺失",
		WAITING_USER: "等待用户补充信息",
	} as const;
	return (
		<span
			className={cn(
				"text-xs",
				request.attentionReason === "WAITING_USER" ? "text-warning" : "text-danger",
			)}
		>
			{labels[request.attentionReason]}
		</span>
	);
}
