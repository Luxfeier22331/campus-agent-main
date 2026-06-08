import { Link, Outlet } from "@tanstack/react-router";
import { BookOpen, MapIcon, MessageSquareText, Send, Utensils } from "lucide-react";
import { Suspense } from "react";

import { cn } from "@/lib/utils";
import { getCampusRuntimeConfig } from "@/platform/runtime/config";

const navItems = [
	{ href: "/", icon: MessageSquareText, label: "助手" },
	{
		href: "/docs/$",
		icon: BookOpen,
		label: "文档",
		params: { _splat: "regulations/student_rules/index" },
	},
	{ href: "/map", icon: MapIcon, label: "地图" },
	{ href: "/dining", icon: Utensils, label: "食堂" },
	{ href: "/feedback", icon: Send, label: "反馈" },
] as const;

export function RootLayout() {
	const runtimeConfig = getCampusRuntimeConfig();
	return (
		<div className="min-h-dvh bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
				<div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 lg:px-6">
					<Link className="flex items-center gap-3" to="/">
						<span className="grid size-8 place-items-center rounded-lg bg-[var(--sys-brand-identity)] text-sm font-semibold text-white">
							M
						</span>
						<span className="text-sm font-semibold tracking-normal">MUC Campus</span>
					</Link>
					<nav className="hidden items-center gap-1 md:flex" aria-label="主导航">
						{navItems.map((item) => (
							<Link
								activeProps={{
									className: "bg-[var(--sys-brand-interactive-subtle)] text-primary",
								}}
								className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
								key={item.href}
								params={"params" in item ? item.params : undefined}
								to={item.href}
							>
								<item.icon aria-hidden="true" className="size-4" />
								{item.label}
							</Link>
						))}
					</nav>
					<a
						className="hidden min-h-10 items-center rounded-lg border border-border px-3 text-sm text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-subtle)] md:inline-flex"
						href={runtimeConfig.accountUrl}
					>
						账号
					</a>
				</div>
			</header>
			<main>
				<Suspense fallback={<RoutePending />}>
					<Outlet />
				</Suspense>
			</main>
			<nav
				aria-label="移动端主导航"
				className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-white px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 md:hidden"
			>
				{navItems.map((item) => (
					<Link
						activeProps={{
							className: "text-primary",
						}}
						className={cn(
							"flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg text-[11px] text-[var(--sys-text-muted)]",
						)}
						key={item.href}
						params={"params" in item ? item.params : undefined}
						to={item.href}
					>
						<item.icon aria-hidden="true" className="size-4" />
						{item.label}
					</Link>
				))}
			</nav>
		</div>
	);
}

function RoutePending() {
	return (
		<section className="mx-auto flex min-h-[60dvh] max-w-[1440px] items-center px-5 py-6 lg:px-6">
			<p className="text-sm text-[var(--sys-text-muted)]">正在加载</p>
		</section>
	);
}

export function NotFoundPage() {
	return (
		<section className="mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center px-6 py-20">
			<p className="text-sm font-medium text-primary">404</p>
			<h1 className="mt-3 text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
				页面不存在
			</h1>
			<p className="mt-3 text-[var(--sys-text-muted)]">这个入口没有被 campus-web 注册。</p>
			<Link
				className="mt-8 inline-flex min-h-11 w-fit items-center rounded-lg bg-primary px-4 text-sm font-medium text-white"
				to="/"
			>
				返回首页
			</Link>
		</section>
	);
}
