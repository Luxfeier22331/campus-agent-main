import { Alert, Button, cn, Disclosure, DisclosureSummary, StateMessage } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import type {
	OpsRequestListResponse,
	OpsRequestListView,
	OpsRequestSummary,
} from "../shared/ops-contract";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { failureReasonLabel } from "./citation-failure-panel";
import { formatTimestamp } from "./format";
import { fetchOpsRequests } from "./ops-api/observability";
import {
	CopyIconButton,
	ErrorState,
	PageHeader,
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
import { TimeRangeSummary } from "./ui/time-window-select";

export function RequestsPage({
	ignoredParams,
	search,
}: {
	ignoredParams?: string[];
	search: RequestSearchLike;
}) {
	const view = search.view ?? "recent";
	const filterKey = JSON.stringify(
		cleanRequestSearch({ ...search, cursor: undefined, history: undefined }),
	);
	const requests = useQuery<OpsRequestListResponse>({
		enabled: !search.timeError,
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === filterKey ? previous : undefined,
		queryFn: ({ signal }) => fetchOpsRequests(search, { signal }),
		queryKey: ["ops", "requests", filterKey, search.cursor],
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});

	const activeFilterLabels = requestFilterLabels(search);
	const hasActiveFilters = activeFilterLabels.length > 0;
	const ignoredParamNames = ignoredParams ?? [];
	const isRefreshing = requests.isFetching;
	const selectedCount = search.status
		? requests.data?.statusCounts[statusCountKey(search.status)]
		: requests.data?.statusCounts.total;

	return (
		<section>
			<Button asChild variant="ghost" className="mb-3">
				<Link to="/overview" search={{ window: search.window, from: search.from, to: search.to }}>
					返回问答概览
				</Link>
			</Button>
			<PageHeader
				actions={
					<Button
						aria-busy={isRefreshing}
						aria-label={isRefreshing ? "刷新中" : "刷新运行记录"}
						className="self-start lg:self-auto"
						disabled={isRefreshing}
						onClick={() => void requests.refetch()}
						variant="ghost"
					>
						<RefreshCw className="size-4" />
						<span>{isRefreshing ? "刷新中" : "刷新"}</span>
					</Button>
				}
				description="查看本时段请求的结果、耗时和需要关注的原因。"
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
				<Alert className="mb-4" tone="warning" role="note">
					部分筛选条件无法识别，已忽略：
					<span className="font-mono">{ignoredParamNames.join("、")}</span>
				</Alert>
			) : null}
			<RequestFilters search={search} />
			{requests.isPending && !search.timeError ? (
				<StateMessage layout="inline" role="status" description={<> 正在读取运行记录... </>} />
			) : null}
			{requests.isError && !requests.data ? (
				<ErrorState
					error={requests.error}
					onRetry={() => requests.refetch()}
					title="运行记录读取失败"
				/>
			) : null}
			{requests.data && !search.timeError ? (
				<>
					{search.requestId ? (
						<p className="my-2 text-xs text-muted-foreground">
							精确 requestId 查询不受时间范围限制。
						</p>
					) : (
						<TimeRangeSummary filters={requests.data.filters} />
					)}

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
						<StateMessage
							layout="inline"
							role="status"
							className="mb-3"
							description={<>正在读取新筛选结果，当前列表仍是上一组数据。</>}
						/>
					) : null}
					{requests.data.data.length === 0 ? (
						<RequestListEmptyState hasActiveFilters={hasActiveFilters} view={view} />
					) : (
						<RequestMobileList
							generatedAt={requests.data.generatedAt}
							requests={requests.data.data}
							search={search}
						/>
					)}
					{search.cursor || requests.data.page.nextCursor ? (
						<div className="mt-4">
							<RequestPagination nextCursor={requests.data.page.nextCursor} search={search} />
						</div>
					) : null}
				</>
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
	const history = decodeCursorHistory(search.history);
	return (
		<nav aria-label="运行记录分页" className="flex items-center gap-3">
			{search.cursor ? (
				<Link
					className="font-medium text-info hover:underline"
					search={cleanRequestSearch({
						...search,
						cursor: history.at(-1) || undefined,
						history: encodeCursorHistory(history.slice(0, -1)),
					})}
					to="/requests"
				>
					上一页
				</Link>
			) : null}
			{nextCursor ? (
				<Link
					className="font-medium text-info hover:underline"
					search={cleanRequestSearch({
						...search,
						cursor: nextCursor,
						history: encodeCursorHistory([...history, search.cursor ?? ""]),
					})}
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
}: {
	generatedAt: string;
	requests: OpsRequestSummary[];
	search: RequestSearchLike;
}) {
	return (
		<div className="divide-y divide-border border-y" data-testid="request-mobile-list">
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
					<Disclosure className="text-sm">
						<DisclosureSummary>执行信息与标识</DisclosureSummary>
						<RequestExecutionStage request={request} />
						<div className="mt-2 flex min-w-0 items-center gap-2">
							<code className="break-all">{request.requestId}</code>
							<CopyIconButton
								contextLabel={request.requestId}
								label="requestId"
								value={request.requestId}
							/>
						</div>
					</Disclosure>
					<div className="flex justify-end text-xs">
						<span className="font-medium text-foreground">
							{formatRequestDuration(request, generatedAt)}
						</span>
					</div>
				</article>
			))}
		</div>
	);
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
			{request.matchedFailure ? (
				<span className="text-danger text-xs">
					命中{request.matchedFailure.scope === "terminal" ? "终态" : "阶段"}失败：
					{request.matchedFailure.code}
					{request.matchedFailure.sourceCode
						? ` · 原始失败 ${request.matchedFailure.sourceCode}`
						: ""}
					{request.matchedFailure.reason
						? ` · ${failureReasonLabel(request.matchedFailure.reason)}`
						: ""}
					{request.matchedFailure.stepId ? ` · ${request.matchedFailure.stepId}` : ""}
					{request.matchedFailure.diagnosticState === "invalid" ? " · 部分诊断无法解析" : ""}
				</span>
			) : null}
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

export function RequestAttentionReason({ request }: { request: OpsRequestSummary }) {
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
