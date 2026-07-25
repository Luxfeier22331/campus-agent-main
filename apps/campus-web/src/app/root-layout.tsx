import { Button } from "@campus-agent/ui";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { DeferredProductAccountEntry } from "@/components/auth/user/deferred-product-account-entry";
import { ProductBrandLink, ProductNavActions } from "@/components/navigation/product-navigation";
import { RouteMetadata } from "./route-metadata";

const ProductNavMobileMenu = lazy(() =>
	import("@/components/navigation/product-navigation-menu").then((module) => ({
		default: module.ProductNavMobileMenu,
	})),
);

export function RootLayout() {
	const location = useLocation();
	const isQaRoute = location.pathname === "/" || location.pathname.startsWith("/c/");
	const isMapRoute = location.pathname === "/map";
	const isAccountRoute = location.pathname.startsWith("/account");
	const isLegalRoute = location.pathname.startsWith("/legal");
	const shouldHideSupportHeader = isQaRoute || isMapRoute || isAccountRoute || isLegalRoute;
	const outlet = (
		<Suspense fallback={<RoutePending />}>
			<Outlet />
		</Suspense>
	);
	return (
		<>
			<RouteMetadata pathname={location.pathname} />
			<div className="min-h-dvh bg-background text-foreground">
				{shouldHideSupportHeader ? null : <SupportPageHeader activePath={location.pathname} />}
				{isQaRoute ? outlet : <main>{outlet}</main>}
			</div>
		</>
	);
}

function SupportPageHeader({ activePath }: { activePath: string }) {
	return (
		<header className="sticky top-0 z-30 border-b border-border bg-white">
			<div className="mx-auto grid min-h-16 max-w-[var(--layout-page-workspace-width)] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 md:grid-cols-[minmax(0,1fr)_auto_auto] lg:px-6">
				<ProductBrandLink className="min-h-16" linkMode="router" />
				<ProductNavActions
					activePath={activePath}
					className="hidden gap-3 md:col-start-2 md:flex"
				/>
				<div className="col-start-2 flex min-h-16 items-center gap-1 md:col-start-3">
					<DeferredProductAccountEntry />
					<Suspense fallback={<span aria-hidden="true" className="size-11 md:hidden" />}>
						<ProductNavMobileMenu activePath={activePath} triggerClassName="md:hidden" />
					</Suspense>
				</div>
			</div>
		</header>
	);
}

export function RoutePending() {
	return (
		<section
			aria-busy="true"
			aria-label="正在加载页面"
			className="mx-auto min-h-[60dvh] max-w-[var(--layout-page-workspace-width)] px-4 py-8 sm:px-5 lg:px-6"
			role="status"
		>
			<span className="sr-only">正在加载页面</span>
			<div aria-hidden="true" className="max-w-3xl animate-pulse space-y-4">
				<div className="h-8 w-28 rounded-md bg-primary/10" />
				<div className="h-4 w-full rounded-md bg-primary/10" />
				<div className="h-4 w-4/5 rounded-md bg-primary/10" />
			</div>
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
