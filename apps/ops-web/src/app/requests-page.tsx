import { Button, cn } from "@campus-agent/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import type {
	OpsRequestListResponse,
	OpsRequestListView,
	OpsRequestSummary,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { fetchOpsRequests } from "./ops-api-client";
import {
	CopyIconButton,
	ErrorState,
	PageHeader,
	PageShell,
	StaleDataWarning,
	StatusBadge,
} from "./ops-display";
import { formatOpsDomainValue } from "./ops-domain-labels";
import {
	cleanRequestSearch,
	formatRequestDuration,
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
		placeholderData: search.cursor ? keepPreviousData : undefined,
		queryFn: ({ signal }) => fetchOpsRequests(search, { signal }),
		queryKey: ["ops", "requests", querySearch],
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});

	if (requests.isPending) {
		return <PageShell title="运行记录">正在读取运行记录...</PageShell>;
	}
	if (requests.isError && !requests.data) {
		return (
			<section>
				<PageHeader description="还原用户请求的产品处理过程和会话结果。" title="运行记录" />
				<RequestViewSwitch search={search} view={view} />
				<RequestFilters search={search} />
				<div className="mt-4">
					<ErrorState
						error={requests.error}
						onRetry={() => requests.refetch()}
						title="运行记录读取失败"
					/>
				</div>
			</section>
		);
	}
	if (!requests.data) {
		return <PageShell title="运行记录">正在读取运行记录...</PageShell>;
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
						aria-label={isRefreshing ? "刷新中" : "刷新运行记录"}
						className="self-start lg:self-auto"
						disabled={isRefreshing}
						onClick={() => void requests.refetch()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						<span>{isRefreshing ? "刷新中" : "刷新"}</span>
					</Button>
				}
				description="还原用户请求的产品处理过程和会话结果。"
				title="运行记录"
			/>
			{requests.isRefetchError ? (
				<StaleDataWarning
					error={requests.error}
					lastSuccessfulAt={requests.dataUpdatedAt}
					onRetry={() => void requests.refetch()}
					title="运行记录刷新失败"
				/>
			) : null}
			{ignoredParamNames.length > 0 ? (
				<div className="mb-3 border-warning/20 border-y bg-warning-subtle px-1 py-2 text-warning text-sm">
					已忽略无效筛选参数：<span className="font-mono">{ignoredParamNames.join("、")}</span>
				</div>
			) : null}
			<RequestViewSwitch search={search} view={view} />
			<RequestFilters search={search} />
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
				<RequestPagination
					hasActiveFilters={hasActiveFilters}
					nextCursor={requests.data.page.nextCursor}
					search={search}
				/>
			</div>
			{hasActiveFilters ? (
				<p className="mb-3 text-muted-foreground text-xs">
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
						view={view}
					/>
					<div className="hidden md:block">
						<DataTable<OpsRequestSummary>
							caption="运行记录"
							columns={createRequestColumns(requests.data.generatedAt, search, view)}
							data={requests.data.data}
							minWidth="1040px"
							rowKey={(row) => row.requestId}
						/>
					</div>
				</>
			)}
		</section>
	);
}

function RequestViewSwitch({
	search,
	view,
}: {
	search: RequestSearchLike;
	view: OpsRequestListView;
}) {
	return (
		<nav aria-label="运行记录视图" className="mb-4 flex border-border border-b">
			{(
				[
					["recent", "最近运行"],
					["attention", "需要关注"],
				] as const
			).map(([value, label]) => (
				<Link
					activeOptions={{ exact: true, includeSearch: true }}
					aria-current={view === value ? "page" : undefined}
					className={cn(
						"inline-flex min-h-11 items-center border-b-2 px-4 font-medium text-sm",
						view === value
							? "border-primary text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
					key={value}
					search={cleanRequestSearch({
						...search,
						cursor: undefined,
						status: undefined,
						view: value,
					})}
					to="/requests"
				>
					{label}
				</Link>
			))}
		</nav>
	);
}

function RequestPagination({
	hasActiveFilters,
	nextCursor,
	search,
}: {
	hasActiveFilters: boolean;
	nextCursor: string | null;
	search: RequestSearchLike;
}) {
	return (
		<div className="flex items-center gap-3">
			{hasActiveFilters ? (
				<Link
					className="font-medium text-info hover:underline"
					search={cleanRequestSearch({ view: search.view })}
					to="/requests"
				>
					清除筛选
				</Link>
			) : null}
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
		</div>
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
					? "没有匹配的运行记录。"
					: view === "attention"
						? "当前没有需要关注的运行。"
						: "当前时间范围内没有运行记录。"}
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
	view,
}: {
	generatedAt: string;
	requests: OpsRequestSummary[];
	search: RequestSearchLike;
	view: OpsRequestListView;
}) {
	return (
		<div className="divide-y divide-border md:hidden" data-testid="request-mobile-list">
			{requests.map((request) => (
				<article
					className="grid gap-3 py-4 first:pt-0"
					data-testid="request-mobile-card"
					key={request.requestId}
				>
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground text-xs">
							{formatTimestamp(request.startedAt)}
						</span>
						<StatusBadge status={request.status} />
					</div>
					<Link
						className="break-words font-semibold text-foreground underline-offset-4 hover:underline"
						params={{ requestId: request.requestId }}
						search={{ from: requestListPath(search) }}
						to="/requests/$requestId"
					>
						{questionPreview(request)}
					</Link>
					<ProductJourney request={request} />
					{view === "attention" ? <RequestAttentionReason request={request} /> : null}
					<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
						<AgentTokenUsage mobile request={request} />
						<span className="font-medium text-foreground">
							{formatRequestDuration(request, generatedAt)}
						</span>
					</div>
					<div className="flex min-w-0 items-center gap-1">
						<span
							className="truncate font-mono text-muted-foreground text-xs"
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

function createRequestColumns(
	generatedAt: string,
	search: RequestSearchLike,
	view: OpsRequestListView,
) {
	return [
		{
			cell: (row: OpsRequestSummary) => (
				<span className="min-w-[150px] text-muted-foreground">
					{formatTimestamp(row.startedAt)}
				</span>
			),
			header: "发起时间",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<div className="grid min-w-[250px] gap-1">
					<Link
						className="line-clamp-2 font-medium text-foreground underline-offset-4 hover:underline"
						params={{ requestId: row.requestId }}
						search={{ from: requestListPath(search) }}
						to="/requests/$requestId"
					>
						{questionPreview(row)}
					</Link>
					<div className="flex min-w-0 items-center gap-1">
						<span
							className="truncate font-mono text-muted-foreground text-xs"
							title={row.requestId}
						>
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
			cell: (row: OpsRequestSummary) => <ProductJourney className="min-w-[280px]" request={row} />,
			header: "产品处理",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<div className="grid min-w-[130px] justify-items-start gap-2">
					<StatusBadge status={row.status} />
					{view === "attention" ? <RequestAttentionReason request={row} /> : null}
				</div>
			),
			header: "状态",
		},
		{
			cell: (row: OpsRequestSummary) => <AgentTokenUsage request={row} />,
			header: "Token",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<span className="min-w-[120px] tabular-nums">
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

function productJourneyNodes(request: OpsRequestSummary) {
	const result =
		request.journey.result.state === "WRITTEN"
			? "回答已写入会话"
			: request.journey.result.state === "MISSING"
				? "会话结果缺失"
				: "处理中";
	return [
		{
			key: `entry:${request.journey.entry}`,
			label: formatOpsDomainValue(request.journey.entry),
		},
		{ key: "agent:online-qa", label: "在线问答 Agent" },
		{ key: `result:${request.journey.result.state}`, label: result },
	];
}

function ProductJourney({
	className,
	request,
}: {
	className?: string;
	request: OpsRequestSummary;
}) {
	const nodes = productJourneyNodes(request);
	return (
		<div className={cn("flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm", className)}>
			<span className="sr-only">产品处理：{nodes.map((node) => node.label).join("，")}</span>
			{nodes.map((node, index) => (
				<span className="contents" key={node.key}>
					{index > 0 ? (
						<span aria-hidden className="text-muted-foreground">
							→
						</span>
					) : null}
					<span
						aria-hidden
						className={cn(
							index === 0 || index === nodes.length - 1
								? "text-muted-foreground"
								: "font-medium text-foreground",
						)}
					>
						{node.label}
					</span>
				</span>
			))}
		</div>
	);
}

function formatAgentTokenUsage(request: OpsRequestSummary) {
	if (request.usage.totalTokens !== null) {
		return new Intl.NumberFormat("zh-CN").format(request.usage.totalTokens);
	}
	return request.usage.state === "NOT_STARTED"
		? "尚未开始"
		: request.usage.state === "IN_PROGRESS"
			? "暂未记录"
			: "不可用";
}

function AgentTokenUsage({
	mobile = false,
	request,
}: {
	mobile?: boolean;
	request: OpsRequestSummary;
}) {
	return (
		<span
			className={cn(
				"grid min-w-[90px] justify-items-start gap-0.5 tabular-nums",
				mobile && "text-muted-foreground",
			)}
		>
			<span>
				{mobile ? "Token：" : ""}
				{formatAgentTokenUsage(request)}
			</span>
			{request.usage.state === "PARTIAL" ? (
				<span className="text-warning text-xs">仅记录部分用量</span>
			) : null}
		</span>
	);
}

function RequestAttentionReason({ request }: { request: OpsRequestSummary }) {
	if (!request.attentionReason) {
		return null;
	}
	const labels = {
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
