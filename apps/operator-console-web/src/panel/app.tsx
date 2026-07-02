import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, KeyRound, LogOut, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { getOperatorOverview, getOperatorRuntimeHealth } from "./data-provider/operator";
import { getRequestDetail, getRequestList } from "./data-provider/requests";
import { fetchJson } from "./http";
import { ProviderConfigPage } from "./operations/provider-config/page";
import { formatPanelTimestamp } from "./panel-copy";
import { getPanelErrorMessage } from "./panel-error";
import { normalizeOverviewRecord, type RawPanelOverviewResponse } from "./types";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "./ui/empty";
import { Separator } from "./ui/separator";
import {
	Sidebar,
	SidebarContent,
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "./ui/sidebar";
import { Skeleton } from "./ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableHeader,
	TableRow,
} from "./ui/table";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: false,
			staleTime: 30_000,
		},
	},
});

const navItems = [
	{ icon: ClipboardList, label: "请求与运行", to: "/requests" },
	{ icon: KeyRound, label: "模型服务配置", to: "/operations/provider-config" },
] as const;

export function OperatorConsoleAdminApp() {
	return (
		<QueryClientProvider client={queryClient}>
			<OperatorConsoleShell>
				<Routes>
					<Route element={<Navigate replace to="/requests" />} path="/" />
					<Route element={<RequestsPage />} path="/requests" />
					<Route element={<RequestDetailPage />} path="/requests/:requestId" />
					<Route element={<ProviderConfigPage />} path="/operations/provider-config" />
					<Route element={<Navigate replace to="/requests" />} path="*" />
				</Routes>
			</OperatorConsoleShell>
		</QueryClientProvider>
	);
}

function OperatorConsoleShell({ children }: { children: ReactNode }) {
	const overviewQuery = useQuery({
		queryFn: ({ signal }) => getPanelOverview({ signal }),
		queryKey: ["panel-overview"],
		staleTime: 60_000,
	});
	const operator = overviewQuery.data?.operatorContext;
	const operatorLabel = operator?.displayName || operator?.email || "运维人员";

	return (
		<SidebarProvider>
			<div className="min-h-dvh bg-slate-100 text-slate-950">
				<header className="sticky top-0 z-30 border-slate-200 border-b bg-white">
					<div className="flex min-h-14 items-center gap-3 px-4">
						<SidebarTrigger />
						<div className="min-w-0 flex-1">
							<p className="truncate font-semibold">校园助理运维工作台</p>
						</div>
						<Button
							aria-label="刷新页面"
							onClick={() => queryClient.invalidateQueries()}
							size="icon"
							variant="ghost"
						>
							<RefreshCw className="size-5" />
						</Button>
						<div className="hidden text-right text-sm sm:block">
							<p className="font-medium">{operatorLabel}</p>
							<p className="text-slate-500 text-xs">
								{overviewQuery.data?.protectionEnvelope || "受保护访问"}
							</p>
						</div>
						<Button asChild aria-label="退出" size="icon" variant="ghost">
							<a href="/logout">
								<LogOut className="size-5" />
							</a>
						</Button>
					</div>
				</header>
				<div className="flex">
					<Sidebar title="运维导航">
						<OperatorNav />
					</Sidebar>
					<SidebarInset>{children}</SidebarInset>
				</div>
			</div>
		</SidebarProvider>
	);
}

function OperatorNav() {
	const location = useLocation();
	return (
		<SidebarContent aria-label="运维导航">
			{navItems.map((item) => {
				const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
				const Icon = item.icon;
				return (
					<Link
						className={[
							"flex min-h-11 items-center gap-3 rounded-md px-3 text-sm",
							active
								? "bg-slate-950 font-semibold text-white"
								: "text-slate-700 hover:bg-slate-100",
						].join(" ")}
						key={item.to}
						to={item.to}
					>
						<Icon aria-hidden="true" className="size-4" />
						<span>{item.label}</span>
					</Link>
				);
			})}
		</SidebarContent>
	);
}

async function getPanelOverview(input: { signal?: AbortSignal } = {}) {
	return normalizeOverviewRecord(await fetchJson<RawPanelOverviewResponse>("/api/overview", input));
}

function PageHeader({ description, title }: { description?: string; title: string }) {
	return (
		<div className="mb-5 space-y-1">
			<h1 className="font-semibold text-2xl">{title}</h1>
			{description ? <p className="text-slate-500 text-sm">{description}</p> : null}
		</div>
	);
}

function QueryError({ error }: { error: unknown }) {
	return <Alert tone="danger">{getPanelErrorMessage(error, "页面数据读取失败。")}</Alert>;
}

function RequestsPage() {
	const overview = useQuery({
		queryFn: ({ signal }) => getOperatorOverview({ signal, window: "24h" }),
		queryKey: ["operator-overview"],
	});
	const runtime = useQuery({
		queryFn: ({ signal }) => getOperatorRuntimeHealth({ signal }),
		queryKey: ["runtime-health"],
	});
	const panel = useQuery({
		queryFn: ({ signal }) => getPanelOverview({ signal }),
		queryKey: ["panel-overview"],
	});
	const requests = useQuery({
		queryFn: ({ signal }) => getRequestList({ pagination: { page: 1, perPage: 20 }, signal }),
		queryKey: ["requests"],
	});
	const volume = overview.data?.data.overview.requestVolume;

	return (
		<section>
			<PageHeader description="查看在线问答请求、运行状态和明确阻塞项。" title="请求与运行" />
			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
				<div className="grid gap-4 md:grid-cols-3">
					{[
						{ label: "受理请求", value: volume?.accepted },
						{ label: "完成请求", value: volume?.completed },
						{ label: "错误请求", value: volume?.errored },
					].map((metric) => (
						<Card key={metric.label}>
							<CardContent className="pt-5">
								<p className="text-slate-500 text-sm">{metric.label}</p>
								{metric.value === undefined ? (
									<Skeleton className="mt-3 h-8 w-16" />
								) : (
									<p className="mt-2 font-semibold text-3xl tabular-nums">{metric.value}</p>
								)}
								<p className="mt-1 text-slate-500 text-xs">最近 24 小时</p>
							</CardContent>
						</Card>
					))}
				</div>
				<Card>
					<CardHeader>
						<CardTitle>服务状态</CardTitle>
						<CardDescription>只展示在线问答链路需要的运行状态。</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{runtime.error ? <QueryError error={runtime.error} /> : null}
						{runtime.isLoading ? (
							<div className="space-y-3">
								<Skeleton className="h-5 w-full" />
								<Skeleton className="h-5 w-full" />
								<Skeleton className="h-5 w-full" />
							</div>
						) : null}
						{runtime.data ? (
							<>
								{[
									{ label: "执行服务", status: runtime.data.data.executionRuntime.status },
									{
										label: "状态同步",
										status: runtime.data.data.executionRuntime.checks.runProjectionStore,
									},
									{
										label: "任务队列",
										status: runtime.data.data.executionRuntime.checks.temporalRuntime,
									},
								].map((item) => (
									<div className="flex items-center justify-between gap-3" key={item.label}>
										<span className="text-sm">{item.label}</span>
										<Badge tone={getStatusTone(item.status)}>{formatStatus(item.status)}</Badge>
									</div>
								))}
								{Object.values(runtime.data.data.executionRuntime.blockers).length > 0 ? (
									<Alert tone="warning">
										{Object.values(runtime.data.data.executionRuntime.blockers).join("; ")}
									</Alert>
								) : null}
							</>
						) : null}
						{panel.data ? (
							<>
								<Separator />
								<div>
									<p className="font-medium text-sm">当前运维主体</p>
									<p className="text-slate-500 text-sm">
										{panel.data.operatorContext?.displayName ||
											panel.data.operatorContext?.email ||
											panel.data.operatorContext?.operatorId ||
											"未知"}
									</p>
								</div>
							</>
						) : null}
					</CardContent>
				</Card>
				<Card className="md:col-span-3 xl:col-span-2">
					<CardHeader>
						<CardTitle>最近请求</CardTitle>
						<CardDescription>查看最近请求状态；读取失败会直接显示错误。</CardDescription>
					</CardHeader>
					<CardContent>
						{requests.error ? <QueryError error={requests.error} /> : null}
						{requests.isLoading ? (
							<div className="mb-3 space-y-2">
								<Skeleton className="h-9 w-full" />
								<Skeleton className="h-9 w-full" />
								<Skeleton className="h-9 w-full" />
							</div>
						) : null}
						<TableContainer>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>问题</TableHead>
										<TableHead>状态</TableHead>
										<TableHead>接入面</TableHead>
										<TableHead>目标</TableHead>
										<TableHead>更新时间</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{requests.data?.data.map((request) => (
										<TableRow key={request.requestId}>
											<TableCell className="max-w-[420px]">
												<Link
													className="block hover:text-slate-700"
													to={`/requests/${request.requestId}`}
												>
													<p className="line-clamp-2 font-medium">{request.questionPreview}</p>
													<p className="text-slate-500 text-xs">{request.requestId}</p>
												</Link>
											</TableCell>
											<TableCell>
												<Badge tone={request.status === "completed" ? "success" : "warning"}>
													{request.status}
												</Badge>
											</TableCell>
											<TableCell>{request.surface}</TableCell>
											<TableCell>
												{request.selectedTool || request.requestedTool || "未指定"}
											</TableCell>
											<TableCell>{formatPanelTimestamp(request.projectedAt)}</TableCell>
										</TableRow>
									))}
									{requests.data?.data.length === 0 ? (
										<TableRow>
											<TableCell className="text-slate-500" colSpan={5}>
												<Empty className="min-h-24 border-0 bg-transparent">
													<EmptyTitle>没有请求记录</EmptyTitle>
													<EmptyDescription>当前没有请求记录。</EmptyDescription>
												</Empty>
											</TableCell>
										</TableRow>
									) : null}
								</TableBody>
							</Table>
						</TableContainer>
					</CardContent>
				</Card>
			</div>
		</section>
	);
}

function RequestDetailPage() {
	const { requestId = "" } = useParams();
	const detail = useQuery({
		enabled: requestId.length > 0,
		queryFn: ({ signal }) => getRequestDetail({ requestId, signal }),
		queryKey: ["request-detail", requestId],
	});
	const request = detail.data;

	return (
		<section>
			<div className="mb-4">
				<Button asChild size="sm" variant="ghost">
					<Link to="/requests">
						<ArrowLeft className="size-4" />
						返回请求列表
					</Link>
				</Button>
			</div>
			<PageHeader description={requestId} title="请求详情" />
			{detail.error ? <QueryError error={detail.error} /> : null}
			{detail.isLoading ? (
				<div className="grid gap-4">
					<Skeleton className="h-28 w-full" />
					<Skeleton className="h-48 w-full" />
				</div>
			) : null}
			{request ? (
				<div className="grid gap-4">
					<Card>
						<CardHeader>
							<CardTitle>请求摘要</CardTitle>
							<CardDescription>{request.questionPreview}</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							<Fact
								label="状态"
								value={<Badge tone={statusTone(request.status)}>{request.status}</Badge>}
							/>
							<Fact label="接入面" value={request.surface} />
							<Fact
								label="目标"
								value={request.selectedTool || request.requestedTool || "未指定"}
							/>
							<Fact label="Trace ID" value={request.traceId} />
							<Fact label="Run ID" value={request.runId || "未绑定"} />
							<Fact label="会话" value={request.conversationId} />
							<Fact label="耗时" value={formatDuration(request.durationMs)} />
							<Fact label="错误码" value={request.errorCode || "无"} />
							<Fact label="开始时间" value={formatPanelTimestamp(request.startedAt)} />
							<Fact
								label="完成时间"
								value={request.completedAt ? formatPanelTimestamp(request.completedAt) : "未完成"}
							/>
							<Fact label="更新时间" value={formatPanelTimestamp(request.projectedAt)} />
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>排障信息</CardTitle>
							<CardDescription>只展示定位请求状态所需的最小信息。</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							<Fact label="负责人类型" value={request.principalType} />
							<Fact label="负责人" value={request.principalLabel || request.principalId} />
							<Fact label="可见范围" value={request.visibilityScope || "未指定"} />
							<Fact label="适用范围" value={request.applicabilityScope || "未指定"} />
							<Fact
								label="来源文档"
								value={request.sourceDocIds.length > 0 ? request.sourceDocIds.join(", ") : "无"}
							/>
							<Fact label="回答预览" value={request.answerPreview || "无"} />
						</CardContent>
					</Card>
				</div>
			) : detail.isLoading ? null : (
				<Empty className="min-h-40">
					<EmptyTitle>未找到请求</EmptyTitle>
					<EmptyDescription>当前请求不存在或不可见。</EmptyDescription>
				</Empty>
			)}
		</section>
	);
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="min-w-0">
			<p className="text-slate-500 text-xs">{label}</p>
			<div className="mt-1 break-words font-medium text-sm">{value}</div>
		</div>
	);
}

function getStatusTone(status: string) {
	return status === "ready" ? "success" : status === "not_reported" ? "muted" : "warning";
}

function statusTone(status: string) {
	return status === "completed" || status === "ready"
		? "success"
		: status === "failed" || status === "error"
			? "danger"
			: "warning";
}

function formatDuration(value: number | null | undefined) {
	return typeof value === "number" ? `${value} ms` : "未上报";
}

function formatStatus(status: string) {
	switch (status) {
		case "ready":
			return "正常";
		case "blocked":
			return "阻塞";
		case "degraded":
			return "降级";
		case "not_ready":
			return "未就绪";
		case "not_reported":
			return "未上报";
		default:
			return status;
	}
}
