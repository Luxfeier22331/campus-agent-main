import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OpsRequestSummary } from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { fetchOpsRequests } from "./ops-api-client";
import {
	CopyableValue,
	CopyIconButton,
	ErrorState,
	PageHeader,
	PageShell,
	StaleDataWarning,
	StatusBadge,
} from "./ops-display";
import {
	cleanRequestSearch,
	formatRequestCompletedAt,
	formatRequestDuration,
	normalizePreviousRequestListPath,
	type RequestSearchLike,
	requestFilterLabels,
	requestListPath,
} from "./ops-view-helpers";
import { RequestFilters } from "./request-filters";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { DataTable } from "./ui/data-table";

export function RequestsPage({
	ignoredParams,
	search,
}: {
	ignoredParams?: string[];
	search: RequestSearchLike;
}) {
	const navigate = useNavigate();
	const requests = useQuery({
		placeholderData: keepPreviousData,
		queryFn: ({ signal }) => fetchOpsRequests(search, { signal }),
		queryKey: ["ops", "requests", search],
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});
	const ignoredParamsKey = (ignoredParams ?? []).join(",");
	const [visibleIgnoredParamsKey, setVisibleIgnoredParamsKey] = useState(ignoredParamsKey);
	const justCleanedIgnoredSearchRef = useRef(false);
	useEffect(() => {
		if (!search.ignored || typeof window === "undefined") {
			if (justCleanedIgnoredSearchRef.current) {
				justCleanedIgnoredSearchRef.current = false;
				return;
			}
			setVisibleIgnoredParamsKey((previous) => (previous ? "" : previous));
			return;
		}
		setVisibleIgnoredParamsKey(ignoredParamsKey);
		justCleanedIgnoredSearchRef.current = true;
		const cleanPath = requestListPath({ ...search, ignored: undefined });
		if (`${window.location.pathname}${window.location.search}` !== cleanPath) {
			void navigate({
				replace: true,
				search: cleanRequestSearch({ ...search, ignored: undefined }),
				to: "/requests",
			});
		}
	}, [ignoredParamsKey, navigate, search]);

	if (requests.isPending) {
		return <PageShell title="请求排查">正在读取请求状态...</PageShell>;
	}

	if (requests.isError && !requests.data) {
		return (
			<section>
				<PageHeader
					description="按状态、关键词或关联 ID 查找请求，并进入详情定位问题。"
					title="请求排查"
				/>
				<RequestFilters search={search} />
				<Card className="mt-4">
					<CardContent className="grid gap-3 p-4">
						<ErrorState
							error={requests.error}
							onRetry={() => requests.refetch()}
							title="请求状态读取失败"
						/>
						<div>
							<Button asChild variant="outline">
								<Link search={{}} to="/requests">
									清除筛选
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</section>
		);
	}
	if (!requests.data) {
		return <PageShell title="请求排查">正在读取请求状态...</PageShell>;
	}

	const summaryCards = [
		{ label: "全部", value: requests.data.summary.total },
		{ label: "完成", value: requests.data.summary.completed },
		{ label: "待处理", value: requests.data.summary.pending },
		{ label: "运行中", value: requests.data.summary.running },
		{ label: "失败", value: requests.data.summary.failed },
		{ label: "取消", value: requests.data.summary.cancelled },
	];
	const activeFilterLabels = requestFilterLabels(search);
	const hasActiveFilters = activeFilterLabels.length > 0;
	const ignoredParamNames = visibleIgnoredParamsKey ? visibleIgnoredParamsKey.split(",") : [];
	const requestListContext = [
		search.cursor ? "下一页结果" : "第一页",
		`每页 ${search.limit ?? 50}`,
		`当前显示 ${requests.data.data.length}`,
		`最后刷新 ${formatTimestamp(new Date(requests.dataUpdatedAt).toISOString())}`,
	].join(" / ");
	const isRefreshing = requests.isFetching;
	const currentListPath = requestListPath(search);
	const previousPath = normalizePreviousRequestListPath(search.previous);

	return (
		<section>
			<PageHeader
				actions={
					<Button
						aria-busy={isRefreshing}
						disabled={isRefreshing}
						onClick={() => {
							requests.refetch();
						}}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						{isRefreshing ? "刷新中" : "刷新"}
					</Button>
				}
				description="按状态、关键词或关联 ID 查找请求，并进入详情定位问题。"
				title="请求排查"
			/>
			{requests.isRefetchError ? (
				<StaleDataWarning
					error={requests.error}
					lastSuccessfulAt={requests.dataUpdatedAt}
					onRetry={() => void requests.refetch()}
					title="请求列表刷新失败"
				/>
			) : null}
			<div
				className="grid grid-cols-3 gap-2 lg:grid-cols-6 lg:gap-3"
				data-testid="request-summary-grid"
			>
				{summaryCards.map((metric) => (
					<Card key={metric.label}>
						<CardContent className="p-3 sm:p-4">
							<p className="text-slate-500 text-xs sm:text-sm">{metric.label}</p>
							<p className="mt-1 font-semibold text-2xl tabular-nums sm:mt-2 sm:text-3xl">
								{metric.value}
							</p>
						</CardContent>
					</Card>
				))}
			</div>
			{ignoredParamNames.length > 0 ? (
				<div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-sm">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-medium">已忽略无效筛选参数</span>
						{ignoredParamNames.map((name) => (
							<Badge key={name} tone="warning">
								{name}
							</Badge>
						))}
					</div>
					<p className="mt-1 text-amber-800 text-xs">
						页面按当前可识别的筛选条件读取请求；请重新应用筛选生成可分享链接。
					</p>
				</div>
			) : null}
			<div className="mt-4">
				<RequestFilters search={search} />
			</div>
			<Card className="mt-4">
				<CardHeader>
					<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
						<div className="grid gap-1">
							<CardTitle>最近请求</CardTitle>
							<p className="text-slate-500 text-sm">{requestListContext}</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{search.cursor ? (
								<>
									<span className="text-slate-500 text-sm">已进入下一页</span>
									<Button asChild variant="outline">
										<a href={previousPath}>返回上一页</a>
									</Button>
									<Button asChild variant="outline">
										<Link
											search={cleanRequestSearch({
												...search,
												cursor: undefined,
												previous: undefined,
											})}
											to="/requests"
										>
											返回第一页
										</Link>
									</Button>
								</>
							) : null}
							{requests.data.page.nextCursor ? (
								<Button asChild variant="outline">
									<Link
										search={cleanRequestSearch({
											...search,
											cursor: requests.data.page.nextCursor ?? undefined,
											previous: currentListPath,
										})}
										to="/requests"
									>
										下一页
									</Link>
								</Button>
							) : null}
						</div>
					</div>
					{requests.isFetching ? (
						<p className="mt-2 text-slate-500 text-sm" role="status">
							正在刷新列表...
						</p>
					) : null}
					{requests.isPlaceholderData ? (
						<p className="mt-2 text-amber-700 text-sm" role="status">
							正在读取新筛选结果，当前列表仍是上一组数据。
						</p>
					) : null}
					{hasActiveFilters ? (
						<div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
							<span className="text-slate-500">已应用筛选</span>
							{activeFilterLabels.map((item) => (
								<Badge key={item} tone="muted">
									{item}
								</Badge>
							))}
							<Link
								className="inline-flex min-h-11 items-center rounded-md border border-slate-200 bg-white px-3 font-semibold text-slate-700 text-xs hover:bg-slate-100"
								search={{}}
								to="/requests"
							>
								清除全部
							</Link>
						</div>
					) : null}
				</CardHeader>
				<CardContent>
					{requests.data.data.length === 0 ? (
						<RequestListEmptyState
							hasActiveFilters={hasActiveFilters}
							isRefreshing={isRefreshing}
							onRefresh={() => {
								requests.refetch();
							}}
						/>
					) : (
						<>
							<RequestMobileList requests={requests.data.data} search={search} />
							<div className="hidden md:block">
								<DataTable<OpsRequestSummary>
									caption="最近请求列表"
									columns={createRequestColumns(search)}
									data={requests.data.data}
									minWidth="860px"
									rowKey={(row) => row.requestId}
								/>
							</div>
						</>
					)}
				</CardContent>
			</Card>
		</section>
	);
}

function RequestListEmptyState({
	hasActiveFilters,
	isRefreshing,
	onRefresh,
}: {
	hasActiveFilters: boolean;
	isRefreshing: boolean;
	onRefresh: () => void;
}) {
	return (
		<div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
			<p className="font-medium text-slate-950">
				{hasActiveFilters ? "没有匹配的请求。" : "暂无近期请求。"}
			</p>
			<p className="text-slate-600">
				{hasActiveFilters
					? "调整筛选条件，或回到完整请求列表。"
					: "当前没有可展示的请求；如果预期应有请求，请检查请求状态是否持续写入。"}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button disabled={isRefreshing} onClick={onRefresh} variant="outline">
					<RefreshCw className="size-4" />
					{isRefreshing ? "刷新中" : "刷新"}
				</Button>
				<Button asChild variant="outline">
					<Link to="/overview">查看运行概览</Link>
				</Button>
			</div>
		</div>
	);
}

function RequestMobileList({
	requests,
	search,
}: {
	requests: OpsRequestSummary[];
	search: RequestSearchLike;
}) {
	return (
		<div className="divide-y divide-slate-100 md:hidden" data-testid="request-mobile-list">
			{requests.map((request) => (
				<div
					className="grid gap-2.5 py-4 first:pt-0 last:pb-0 text-sm"
					data-testid="request-mobile-card"
					key={request.requestId}
				>
					<div className="flex min-w-0 items-start justify-between gap-3">
						<div className="grid min-w-0 gap-1">
							<StatusBadge status={request.status} />
							<Link
								className="inline-flex min-h-11 items-center break-words font-semibold text-slate-950 underline-offset-4 hover:underline"
								params={{ requestId: request.requestId }}
								search={{ from: requestListPath(search) }}
								to="/requests/$requestId"
							>
								{request.requestId}
							</Link>
						</div>
						<CopyIconButton
							contextLabel={request.requestId}
							label="requestId"
							value={request.requestId}
						/>
					</div>
					<p className="line-clamp-3 text-slate-700">{request.questionPreview}</p>
					<div className="grid min-w-0 gap-1 rounded-md bg-slate-50 px-3 py-2 text-slate-600 text-xs">
						<span>
							工具:{" "}
							<span className="font-medium text-slate-950">
								{request.selectedTool ?? request.requestedTool ?? "未使用工具"}
							</span>
						</span>
						{request.errorCode ? (
							<span className="text-red-700">错误: {request.errorCode}</span>
						) : null}
					</div>
					<div className="flex flex-wrap items-center justify-between gap-2 border-slate-100 border-t pt-2 text-slate-600 text-xs">
						<span className="font-medium text-slate-950 text-sm">
							{formatRequestDuration(request)}
						</span>
						<span>更新 {formatTimestamp(request.projectedAt)}</span>
					</div>
				</div>
			))}
		</div>
	);
}

function createRequestColumns(search: RequestSearchLike) {
	return [
		{ cell: (row: OpsRequestSummary) => <StatusBadge status={row.status} />, header: "状态" },
		{
			cell: (row: OpsRequestSummary) => (
				<div className="grid min-w-[220px] gap-2">
					<div className="flex min-w-0 items-start justify-between gap-2">
						<Link
							className="break-all font-medium text-slate-950 underline-offset-4 hover:underline"
							params={{ requestId: row.requestId }}
							search={{ from: requestListPath(search) }}
							title={row.requestId}
							to="/requests/$requestId"
						>
							{row.requestId}
						</Link>
						<CopyIconButton contextLabel={row.requestId} label="requestId" value={row.requestId} />
					</div>
					<span className="line-clamp-2 text-slate-700" title={row.questionPreview}>
						{row.questionPreview}
					</span>
					<span className="text-slate-500 text-xs">{row.principalType}</span>
				</div>
			),
			header: "请求",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<div
					className="grid min-w-[320px] grid-cols-2 gap-2"
					data-testid="request-list-correlations"
				>
					<CopyableValue
						compact
						contextLabel={row.requestId}
						label="conversationId"
						value={row.conversationId}
					/>
					<CopyableValue compact contextLabel={row.requestId} label="traceId" value={row.traceId} />
					<CopyableValue compact contextLabel={row.requestId} label="runId" value={row.runId} />
					<CopyableValue
						compact
						contextLabel={row.requestId}
						label="workflowId"
						value={row.workflowId}
					/>
				</div>
			),
			header: "关联",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<div className="grid min-w-[180px] gap-1">
					<span className="font-medium text-slate-950">
						请求: {row.requestedTool ?? "未请求工具"}
					</span>
					<span className="text-slate-600 text-xs">实际: {row.selectedTool ?? "未选择工具"}</span>
					<span className="text-slate-500 text-xs">{row.errorCode ?? "无错误"}</span>
					<span className="text-slate-500 text-xs">{row.diagnostics.join(", ") || "暂无诊断"}</span>
				</div>
			),
			header: "工具/诊断",
		},
		{
			cell: (row: OpsRequestSummary) => (
				<div className="grid min-w-[180px] gap-1 text-slate-600 text-xs">
					<span className="font-medium text-slate-950 text-sm">{formatRequestDuration(row)}</span>
					<span>开始 {formatTimestamp(row.startedAt)}</span>
					<span>完成 {formatRequestCompletedAt(row)}</span>
					<span>更新 {formatTimestamp(row.projectedAt)}</span>
				</div>
			),
			header: "时间",
		},
	];
}
