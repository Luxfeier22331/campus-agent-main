import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ClipboardList, KeyRound, LogOut, Menu, RefreshCw, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getOperatorOverview, getOperatorRuntimeHealth } from "./data-provider/operator";
import { getRequestList } from "./data-provider/requests";
import { fetchJson } from "./http";
import { ProviderConfigPage } from "./operations/provider-config/page";
import { formatPanelTimestamp } from "./panel-copy";
import { getPanelErrorMessage } from "./panel-error";
import {
	normalizeOverviewRecord,
	type PanelOverviewRecord,
	type RawPanelOverviewResponse,
} from "./types";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Table, TableWrap, Td, Th } from "./ui/table";

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
					<Route element={<ProviderConfigPage />} path="/operations/provider-config" />
					<Route element={<Navigate replace to="/requests" />} path="*" />
				</Routes>
			</OperatorConsoleShell>
		</QueryClientProvider>
	);
}

function OperatorConsoleShell({ children }: { children: ReactNode }) {
	const [navOpen, setNavOpen] = useState(false);
	const overviewQuery = useQuery({
		queryFn: ({ signal }) => getPanelOverview({ signal }),
		queryKey: ["panel-overview"],
		staleTime: 60_000,
	});
	const operator = overviewQuery.data?.operatorContext;
	const operatorLabel = operator?.displayName || operator?.email || "运维人员";

	return (
		<div className="min-h-dvh bg-slate-100 text-slate-950">
			<header className="sticky top-0 z-30 border-slate-200 border-b bg-white">
				<div className="flex min-h-14 items-center gap-3 px-4">
					<Button
						aria-label={navOpen ? "关闭导航" : "打开导航"}
						className="lg:hidden"
						onClick={() => setNavOpen((current) => !current)}
						size="icon"
						variant="ghost"
					>
						{navOpen ? <X className="size-5" /> : <Menu className="size-5" />}
					</Button>
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
				<aside
					className={[
						"fixed inset-y-14 left-0 z-20 w-64 border-slate-200 border-r bg-white p-3 transition-transform lg:sticky lg:top-14 lg:block lg:h-[calc(100dvh-3.5rem)] lg:translate-x-0",
						navOpen ? "translate-x-0" : "-translate-x-full",
					].join(" ")}
				>
					<OperatorNav onNavigate={() => setNavOpen(false)} />
				</aside>
				<main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
			</div>
		</div>
	);
}

function OperatorNav({ onNavigate }: { onNavigate(): void }) {
	const location = useLocation();
	return (
		<nav aria-label="运维导航" className="grid gap-1">
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
						onClick={onNavigate}
						to={item.to}
					>
						<Icon aria-hidden="true" className="size-4" />
						<span>{item.label}</span>
					</Link>
				);
			})}
		</nav>
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
	const alerts = overview.data?.data.alerts ?? [];

	return (
		<section>
			<PageHeader description="查看在线问答请求、运行状态和明确阻塞项。" title="请求与运行" />
			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
				<div className="grid gap-4 md:grid-cols-3">
					<MetricCard
						detail="最近 24 小时"
						label="受理请求"
						value={String(overview.data?.data.overview.requestVolume.accepted ?? "-")}
					/>
					<MetricCard
						detail="最近 24 小时"
						label="完成请求"
						value={String(overview.data?.data.overview.requestVolume.completed ?? "-")}
					/>
					<MetricCard
						detail="最近 24 小时"
						label="错误请求"
						value={String(overview.data?.data.overview.requestVolume.errored ?? "-")}
					/>
				</div>
				<Card>
					<CardHeader>
						<CardTitle>服务状态</CardTitle>
						<CardDescription>只展示在线问答链路需要的运行状态。</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{runtime.error ? <QueryError error={runtime.error} /> : null}
						{runtime.data ? (
							<>
								<StatusRow label="执行服务" status={runtime.data.data.executionRuntime.status} />
								<StatusRow
									label="状态同步"
									status={runtime.data.data.executionRuntime.checks.runProjectionStore}
								/>
								<StatusRow
									label="任务队列"
									status={runtime.data.data.executionRuntime.checks.temporalRuntime}
								/>
								{Object.values(runtime.data.data.executionRuntime.blockers).length > 0 ? (
									<Alert tone="warning">
										{Object.values(runtime.data.data.executionRuntime.blockers).join("; ")}
									</Alert>
								) : null}
							</>
						) : null}
						{panel.data ? <OperatorSummary overview={panel.data} /> : null}
					</CardContent>
				</Card>
				<Card className="md:col-span-3">
					<CardHeader>
						<CardTitle>告警摘要</CardTitle>
					</CardHeader>
					<CardContent>
						{overview.error ? <QueryError error={overview.error} /> : null}
						{alerts.length > 0 ? (
							<div className="grid gap-2">
								{alerts.map((alert) => (
									<div className="rounded-md border border-slate-200 p-3" key={alert.alertId}>
										<p className="font-medium text-sm">{alert.code}</p>
										<p className="text-slate-500 text-xs">
											{alert.requestCount} 个请求 · {formatPanelTimestamp(alert.startedAt)}
										</p>
									</div>
								))}
							</div>
						) : (
							<p className="text-slate-500 text-sm">当前没有需要处理的告警。</p>
						)}
					</CardContent>
				</Card>
				<Card className="md:col-span-3 xl:col-span-2">
					<CardHeader>
						<CardTitle>最近请求</CardTitle>
						<CardDescription>读取 app-api 维护的请求投影；读取失败会直接显示错误。</CardDescription>
					</CardHeader>
					<CardContent>
						{requests.error ? <QueryError error={requests.error} /> : null}
						<TableWrap>
							<Table>
								<thead>
									<tr>
										<Th>问题</Th>
										<Th>状态</Th>
										<Th>接入面</Th>
										<Th>目标</Th>
										<Th>更新时间</Th>
									</tr>
								</thead>
								<tbody>
									{requests.data?.data.map((request) => (
										<tr key={request.requestId}>
											<Td className="max-w-[420px]">
												<p className="line-clamp-2 font-medium">{request.questionPreview}</p>
												<p className="text-slate-500 text-xs">{request.requestId}</p>
											</Td>
											<Td>
												<Badge tone={request.status === "completed" ? "success" : "warning"}>
													{request.status}
												</Badge>
											</Td>
											<Td>{request.surface}</Td>
											<Td>
												{request.selectedCapability || request.requestedCapability || "未指定"}
											</Td>
											<Td>{formatPanelTimestamp(request.projectedAt)}</Td>
										</tr>
									))}
									{requests.data?.data.length === 0 ? (
										<tr>
											<Td className="text-slate-500" colSpan={5}>
												当前没有请求记录。
											</Td>
										</tr>
									) : null}
								</tbody>
							</Table>
						</TableWrap>
					</CardContent>
				</Card>
			</div>
		</section>
	);
}

function MetricCard({ detail, label, value }: { detail: string; label: string; value: string }) {
	return (
		<Card>
			<CardContent className="pt-5">
				<p className="text-slate-500 text-sm">{label}</p>
				<p className="mt-2 font-semibold text-3xl tabular-nums">{value}</p>
				<p className="mt-1 text-slate-500 text-xs">{detail}</p>
			</CardContent>
		</Card>
	);
}

function StatusRow({ label, status }: { label: string; status: string }) {
	const tone = status === "ready" ? "success" : status === "not_reported" ? "muted" : "warning";
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-sm">{label}</span>
			<Badge tone={tone}>{formatStatus(status)}</Badge>
		</div>
	);
}

function OperatorSummary({ overview }: { overview: PanelOverviewRecord }) {
	const operator = overview.operatorContext;
	return (
		<div className="border-slate-200 border-t pt-3">
			<p className="font-medium text-sm">当前运维主体</p>
			<p className="text-slate-500 text-sm">
				{operator?.displayName || operator?.email || operator?.operatorId || "未知"}
			</p>
		</div>
	);
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
