import { Link, Outlet } from "@tanstack/react-router";
import {
	Bell,
	BookOpen,
	ClipboardList,
	LayoutDashboard,
	Map as MapIcon,
	MessageSquare,
	Route,
	Settings2,
	Utensils,
} from "lucide-react";
import { Suspense } from "react";

import { cn } from "@/lib/utils";

const NAV_GROUPS = [
	{
		items: [{ href: "/", icon: LayoutDashboard, label: "后台总览" }],
		label: "总览",
	},
	{
		items: [
			{ href: "/dining", icon: Utensils, label: "食堂数据" },
			{ href: "/dining/assets", icon: MapIcon, label: "食堂资产" },
			{ href: "/dining/candidates", icon: ClipboardList, label: "发布候选" },
			{ href: "/dining/releases", icon: ClipboardList, label: "发布历史" },
		],
		label: "食堂",
	},
	{
		items: [
			{ href: "/map", icon: Route, label: "地图与地点" },
			{ href: "/feedback", icon: MessageSquare, label: "反馈处理" },
		],
		label: "校园数据",
	},
	{
		items: [
			{ href: "/knowledge", icon: BookOpen, label: "知识源" },
			{ href: "/notices", icon: Bell, label: "通知源" },
			{ href: "/services", icon: Settings2, label: "校园服务" },
		],
		label: "内容源",
	},
] as const;

export function RootLayout() {
	return (
		<div className="min-h-dvh bg-zinc-100 text-zinc-950">
			<header className="border-zinc-200 border-b bg-white">
				<div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
					<div>
						<p className="font-semibold text-sm text-zinc-500">校园后台</p>
						<h1 className="font-semibold text-xl">校园数据修改面</h1>
					</div>
					<div className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600">
						运营员
					</div>
				</div>
			</header>
			<div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[220px_1fr]">
				<nav
					aria-label="后台路由"
					className="flex flex-wrap gap-3 overflow-visible pb-1 xl:grid xl:content-start xl:gap-4 xl:pb-0"
				>
					{NAV_GROUPS.map((group) => (
						<div
							className="flex min-w-max items-center gap-1.5 xl:grid xl:items-stretch xl:gap-1"
							key={group.label}
						>
							<p className="px-1 font-bold text-[0.6875rem] text-slate-500 xl:px-3">
								{group.label}
							</p>
							{group.items.map((item) => {
								const Icon = item.icon;
								return (
									<Link
										activeProps={{ className: "bg-zinc-950 text-white hover:bg-zinc-950" }}
										className={cn(
											"inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-[7px] px-2.5 text-[0.8125rem] text-slate-700 no-underline",
											"hover:bg-white focus-visible:outline-2 focus-visible:outline-zinc-950 focus-visible:outline-offset-2",
											"xl:min-h-10 xl:px-3",
										)}
										key={item.href}
										to={item.href}
									>
										<Icon aria-hidden="true" className="size-4" />
										{item.label}
									</Link>
								);
							})}
						</div>
					))}
				</nav>
				<main>
					<Suspense fallback={<RoutePending />}>
						<Outlet />
					</Suspense>
				</main>
			</div>
		</div>
	);
}

function RoutePending() {
	return (
		<section className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
			正在加载
		</section>
	);
}

export function NotFoundPage() {
	return (
		<section className="rounded-xl border border-zinc-200 bg-white p-6">
			<h2 className="font-semibold text-lg">页面不存在</h2>
		</section>
	);
}
