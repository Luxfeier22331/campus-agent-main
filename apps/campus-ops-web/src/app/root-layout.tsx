import { Link, Outlet } from "@tanstack/react-router";
import {
	ClipboardList,
	LayoutDashboard,
	Map as MapIcon,
	MessageSquare,
	Utensils,
} from "lucide-react";
import { Suspense } from "react";

const NAV_ITEMS = [
	{ href: "/", icon: LayoutDashboard, label: "总览" },
	{ href: "/dining", icon: Utensils, label: "食堂" },
	{ href: "/dining/releases", icon: ClipboardList, label: "发布" },
	{ href: "/map", icon: MapIcon, label: "地图" },
	{ href: "/feedback", icon: MessageSquare, label: "反馈" },
] as const;

export function RootLayout() {
	return (
		<div className="min-h-dvh bg-zinc-100 text-zinc-950">
			<header className="border-zinc-200 border-b bg-white">
				<div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
					<div>
						<p className="font-semibold text-sm text-zinc-500">Campus Ops</p>
						<h1 className="font-semibold text-xl">校园数据运营控制台</h1>
					</div>
					<div className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600">
						Operator
					</div>
				</div>
			</header>
			<div className="mx-auto grid max-w-7xl grid-cols-[220px_1fr] gap-6 px-6 py-6">
				<nav className="space-y-1">
					{NAV_ITEMS.map((item) => {
						const Icon = item.icon;
						return (
							<Link
								activeProps={{ className: "bg-zinc-950 text-white" }}
								className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-zinc-700 hover:bg-white"
								key={item.href}
								to={item.href}
							>
								<Icon aria-hidden="true" className="size-4" />
								{item.label}
							</Link>
						);
					})}
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
