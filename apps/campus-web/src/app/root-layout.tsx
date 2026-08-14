import { Button } from "@campus-agent/ui";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, Suspense, useEffect } from "react";
import { DeferredProductAccountEntry } from "@/components/auth/user/deferred-product-account-entry";
import { CampusTopNav, FocusedPageHeader } from "@/components/navigation/campus-top-nav";
import { resolveAccountAuthReturnTarget } from "@/platform/auth/return-target";
import { useCampusSession } from "@/platform/auth/session";
import { RouteMetadata } from "./route-metadata";

export function RootLayout() {
	const location = useLocation();
	const isQaRoute = location.pathname === "/" || location.pathname.startsWith("/c/");
	const isMapRoute = location.pathname === "/map";
	const isAccountRoute = location.pathname.startsWith("/account");
	const isLegalRoute = location.pathname.startsWith("/legal");
	const isFocusedRoute = isAccountRoute || isLegalRoute;
	const shouldShowStandardHeader = !(isQaRoute || isMapRoute || isFocusedRoute);
	const outlet = (
		<Suspense fallback={<RoutePending />}>
			<Outlet />
		</Suspense>
	);
	const guardedOutlet = (
		<SessionRouteGuard pathname={location.pathname}>{outlet}</SessionRouteGuard>
	);
	return (
		<>
			<RouteMetadata pathname={location.pathname} />
			<div className="min-h-dvh bg-background text-foreground" data-ui-profile="campus">
				{shouldShowStandardHeader ? (
					<CampusTopNav
						accountAction={<DeferredProductAccountEntry />}
						activePath={location.pathname}
						mobileAccountAction={(openAuthDialog) => (
							<DeferredProductAccountEntry onLogin={openAuthDialog} presentation="label" />
						)}
						variant="standard"
					/>
				) : null}
				{isFocusedRoute ? <FocusedPageHeader /> : null}
				{isQaRoute ? guardedOutlet : <main>{guardedOutlet}</main>}
			</div>
		</>
	);
}

function SessionRouteGuard({ children, pathname }: { children: ReactNode; pathname: string }) {
	const navigate = useNavigate();
	const session = useCampusSession();
	const isLegalRoute = pathname.startsWith("/legal/");
	const isAuthEntryRoute = pathname === "/account/login" || pathname === "/account/register";
	const isProtectedAccountRoute =
		pathname === "/account" ||
		pathname === "/account/change-password" ||
		pathname.startsWith("/account/settings/");
	const isProtectedNoticeRoute = pathname === "/notices" || pathname.startsWith("/notices/");
	const passwordChangeRequired = session.data?.user.passwordChangeRequired === true;
	const mustChangePassword =
		session.status === "authenticated" &&
		passwordChangeRequired &&
		!isLegalRoute &&
		pathname !== "/account/change-password";
	const isProtectedRoute = isProtectedAccountRoute || isProtectedNoticeRoute;
	const mustSignIn = session.status === "anonymous" && isProtectedRoute;
	const mustLeaveAuthEntry =
		session.status === "authenticated" && !passwordChangeRequired && isAuthEntryRoute;

	useEffect(() => {
		if (!mustChangePassword) {
			return;
		}
		void navigate({
			replace: true,
			search: { redirectTo: currentSafeRouteTarget() },
			to: "/account/change-password",
		});
	}, [mustChangePassword, navigate]);

	useEffect(() => {
		if (!mustSignIn) {
			return;
		}
		void navigate({
			replace: true,
			search: { redirectTo: currentSafeRouteTarget() },
			to: "/account/login",
		});
	}, [mustSignIn, navigate]);

	useEffect(() => {
		if (!mustLeaveAuthEntry) {
			return;
		}
		const target = resolveAccountAuthReturnTarget(window.location.search, {
			currentOrigin: window.location.origin,
		});
		void navigate({ replace: true, to: target });
	}, [mustLeaveAuthEntry, navigate]);

	if (session.status === "loading" && isProtectedRoute) {
		return <RoutePending />;
	}
	if (session.status === "unavailable" && isProtectedRoute) {
		return (
			<SessionUnavailable onRetry={() => void session.refresh()} retrying={session.isRefreshing} />
		);
	}
	if (mustChangePassword || mustSignIn || mustLeaveAuthEntry) {
		return <RoutePending />;
	}
	return children;
}

function SessionUnavailable({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
	return (
		<section className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-6 py-16">
			<h1 className="text-xl font-semibold text-[var(--sys-text-strong)]">暂时无法确认登录状态</h1>
			<p className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)]">
				账号服务暂时不可用。你的登录状态没有发生变化，请稍后重试。
			</p>
			<Button
				aria-busy={retrying || undefined}
				className="mt-6 w-fit"
				disabled={retrying}
				onClick={onRetry}
				variant="outline"
			>
				{retrying ? "正在重试" : "重试"}
			</Button>
		</section>
	);
}

function currentSafeRouteTarget(): string {
	return resolveAccountAuthReturnTarget(
		new URLSearchParams({
			redirectTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
		}),
		{ currentOrigin: window.location.origin },
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
				<div className="h-8 w-28 rounded-md bg-surface-muted" />
				<div className="h-4 w-full rounded-md bg-surface-muted" />
				<div className="h-4 w-4/5 rounded-md bg-surface-muted" />
			</div>
		</section>
	);
}

export function NotFoundPage() {
	return (
		<section className="mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center px-6 py-20">
			<p className="text-sm font-medium text-muted-foreground">404</p>
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
