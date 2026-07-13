import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { KeyRound, LogOut, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { fetchJson } from "./http";
import { ProviderConfigPage } from "./operations/provider-config/page";
import { normalizeOverviewRecord, type RawPanelOverviewResponse } from "./types";
import { Button } from "./ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "./ui/sidebar";

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
	{ icon: KeyRound, label: "模型服务配置", to: "/operations/provider-config" },
] as const;

export function OperatorConsoleAdminApp() {
	return (
		<QueryClientProvider client={queryClient}>
			<OperatorConsoleShell>
				<Routes>
					<Route element={<Navigate replace to="/operations/provider-config" />} path="/" />
					<Route element={<ProviderConfigPage />} path="/operations/provider-config" />
					<Route element={<Navigate replace to="/operations/provider-config" />} path="*" />
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
