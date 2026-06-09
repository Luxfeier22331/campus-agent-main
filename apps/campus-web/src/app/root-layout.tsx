import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { type ReactNode, Suspense } from "react";

import { SupportNavigation } from "@/components/conversation/qa-shell";
import { cn } from "@/lib/utils";

export function RootLayout() {
	const location = useLocation();
	const isQaRoute = location.pathname === "/" || location.pathname.startsWith("/c/");
	return (
		<div className="min-h-dvh bg-background text-foreground">
			{isQaRoute ? null : <SupportPageHeader activePath={location.pathname} />}
			<main>
				<Suspense fallback={<RoutePending />}>
					<Outlet />
				</Suspense>
			</main>
		</div>
	);
}

function SupportPageHeader({ activePath }: { activePath: string }) {
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
				<SupportNavigation activePath={activePath} className="hidden md:flex" />
			</div>
			<div className="mx-auto max-w-[1440px] px-4 lg:px-6">
				<SupportNavigation
					activePath={activePath}
					className="flex overflow-x-auto border-t border-[var(--sys-border-subtle)] py-1 md:hidden"
				/>
			</div>
		</header>
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
			<p className="mt-3 text-[var(--sys-text-muted)]">这个页面暂时无法打开，请返回首页继续。</p>
			<Link
				className="mt-8 inline-flex min-h-11 w-fit items-center rounded-lg bg-primary px-4 text-sm font-medium text-white"
				to="/"
			>
				返回首页
			</Link>
		</section>
	);
}

export function ShellSection({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<section className={cn("mx-auto w-full px-5 py-14 lg:px-8 lg:py-20", className)}>
			{children}
		</section>
	);
}

export function PageTitle({ children }: { children: ReactNode }) {
	return (
		<h1 className="text-4xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
			{children}
		</h1>
	);
}

export function PageDescription({ children }: { children: ReactNode }) {
	return <p className="mt-3 text-base leading-7 text-[var(--sys-text-muted)]">{children}</p>;
}
