import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { Suspense } from "react";

import { CampusAuthUIProvider } from "@/components/auth/auth-ui-provider";
import { Button } from "@/components/ui/button";

const supportNavItems = [
	{ label: "文档", to: "/docs" },
	{ label: "校园地图", to: "/map" },
	{ label: "饭堂分布图", to: "/dining" },
	{ emphasis: true, label: "反馈", to: "/feedback" },
] as const;

export function RootLayout() {
	const location = useLocation();
	const isQaRoute = location.pathname === "/" || location.pathname.startsWith("/c/");
	const isMapRoute = location.pathname === "/map";
	return (
		<div className="min-h-dvh bg-background text-foreground">
			{isQaRoute || isMapRoute ? null : <SupportPageHeader activePath={location.pathname} />}
			<CampusAuthUIProvider>
				<main>
					<Suspense fallback={<RoutePending />}>
						<Outlet />
					</Suspense>
				</main>
			</CampusAuthUIProvider>
		</div>
	);
}

function SupportPageHeader({ activePath }: { activePath: string }) {
	const visibleItems = supportNavItems.filter(
		(item) => !(activePath === "/map" && item.to === "/feedback"),
	);
	return (
		<header className="sticky top-0 z-30 border-b border-border bg-white">
			<div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-4 px-4 lg:px-6">
				<Link className="flex min-w-0 items-center gap-3" to="/">
					<span className="min-w-0">
						<span className="block truncate text-sm font-semibold tracking-normal text-[var(--sys-text-strong)]">
							中央民族大学校园问答
						</span>
						<span className="block truncate text-xs text-[var(--sys-text-subtle)]">
							MUC Campus Q&A
						</span>
					</span>
				</Link>
				<nav aria-label="支撑页面导航" className="hidden items-center gap-3 md:flex">
					{visibleItems.map((item) => (
						<Button
							asChild
							className={[
								"min-h-8 rounded-md px-2.5 text-xs",
								isSupportNavActive(activePath, item.to) ? "bg-muted text-foreground" : "",
								"emphasis" in item && item.emphasis && isSupportNavActive(activePath, item.to)
									? "text-[var(--sys-brand-identity)] hover:text-[var(--sys-brand-identity)]"
									: "",
							].join(" ")}
							key={item.to}
							size="sm"
							variant="ghost"
						>
							<Link to={item.to}>{item.label}</Link>
						</Button>
					))}
				</nav>
			</div>
			<div className="mx-auto max-w-[1440px] px-4 lg:px-6">
				<nav
					aria-label="支撑页面导航"
					className="flex overflow-x-auto border-t border-[var(--sys-border-subtle)] py-1 md:hidden"
				>
					{visibleItems.map((item) => (
						<Button
							asChild
							className={[
								"min-h-8 rounded-md px-2.5 text-xs",
								isSupportNavActive(activePath, item.to) ? "bg-muted text-foreground" : "",
								"emphasis" in item && item.emphasis && isSupportNavActive(activePath, item.to)
									? "text-[var(--sys-brand-identity)] hover:text-[var(--sys-brand-identity)]"
									: "",
							].join(" ")}
							key={item.to}
							size="sm"
							variant="ghost"
						>
							<Link to={item.to}>{item.label}</Link>
						</Button>
					))}
				</nav>
			</div>
		</header>
	);
}

function isSupportNavActive(activePath: string, itemPath: string) {
	return itemPath === "/docs" ? activePath.startsWith("/docs") : activePath === itemPath;
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
			<p className="mt-3 text-[var(--sys-text-muted)]">这个页面暂时无法打开，请返回首页继续。</p>
			<Button asChild className="mt-8 w-fit">
				<Link to="/">返回首页</Link>
			</Button>
		</section>
	);
}
