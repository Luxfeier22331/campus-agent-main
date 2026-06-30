import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { Suspense } from "react";

import { ProductBrandLink, ProductNavActions } from "@/components/navigation/product-navigation";
import { Button } from "@/components/ui/button";
import { CampusMotionProvider } from "@/components/ui/motion";

export function RootLayout() {
	const location = useLocation();
	const isQaRoute = location.pathname === "/" || location.pathname.startsWith("/c/");
	const isMapRoute = location.pathname === "/map";
	const isAccountRoute = location.pathname.startsWith("/account");
	const isLegalRoute = location.pathname.startsWith("/legal");
	const shouldHideSupportHeader = isQaRoute || isMapRoute || isAccountRoute || isLegalRoute;
	return (
		<CampusMotionProvider>
			<div className="min-h-dvh bg-background text-foreground">
				{shouldHideSupportHeader ? null : <SupportPageHeader activePath={location.pathname} />}
				<main>
					<Suspense fallback={<RoutePending />}>
						<Outlet />
					</Suspense>
				</main>
			</div>
		</CampusMotionProvider>
	);
}

function SupportPageHeader({ activePath }: { activePath: string }) {
	return (
		<header className="sticky top-0 z-30 border-b border-border bg-white">
			<div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-4 px-4 lg:px-6">
				<ProductBrandLink linkMode="router" />
				<ProductNavActions activePath={activePath} className="hidden gap-3 md:flex" />
			</div>
			<div className="mx-auto max-w-[1440px] px-4 lg:px-6">
				<ProductNavActions
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
			<Button asChild className="mt-8 w-fit">
				<Link to="/">返回首页</Link>
			</Button>
		</section>
	);
}
