import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	HUB_NAVIGATION_ENTRIES,
	type HubLauncherEntry,
	resolveHubEntryHref,
} from "../platform/launcher/manifest";

export function RootRouteComponent() {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const location = useLocation();
	const isFocusedIdentitySurface = isFocusedIdentityPath(location.pathname, location.searchStr);

	return (
		<div className="flex min-h-dvh flex-col bg-background text-foreground">
			{isFocusedIdentitySurface ? null : (
				<header className="border-b border-border bg-card">
					<div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-5 lg:px-8">
						<div className="flex items-center gap-5">
							<Button
								aria-expanded={isMenuOpen}
								aria-label={isMenuOpen ? "关闭导航菜单" : "打开导航菜单"}
								className="-ml-3 md:hidden"
								onClick={() => setIsMenuOpen((current) => !current)}
								size="icon"
								type="button"
								variant="ghost"
							>
								{isMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
							</Button>
							<Link
								className="inline-flex min-h-11 items-center text-xl font-bold tracking-normal text-foreground"
								to="/"
							>
								MUC Wiki Hub
							</Link>
						</div>
						<nav aria-label="主导航" className="hidden items-center gap-6 md:flex">
							{HUB_NAVIGATION_ENTRIES.map((entry) => (
								<HeaderEntryLink entry={entry} key={entry.slug} />
							))}
						</nav>
						<Link
							activeOptions={{ exact: true }}
							className="hidden min-h-11 min-w-11 items-center justify-center px-2 text-sm font-medium text-primary hover:text-primary/80 sm:inline-flex"
							to="/account"
						>
							账号
						</Link>
					</div>
					{isMenuOpen ? (
						<nav aria-label="移动端导航" className="border-t border-border bg-card md:hidden">
							<div className="mx-auto flex w-full max-w-6xl flex-col px-5 py-3">
								{HUB_NAVIGATION_ENTRIES.map((entry) => (
									<HeaderEntryLink
										className="min-h-11 justify-start px-1"
										entry={entry}
										key={entry.slug}
										onNavigate={() => setIsMenuOpen(false)}
									/>
								))}
								<Link
									activeOptions={{ exact: true }}
									className="flex min-h-11 items-center px-1 text-sm font-semibold text-primary"
									onClick={() => setIsMenuOpen(false)}
									to="/account"
								>
									账号
								</Link>
							</div>
						</nav>
					) : null}
				</header>
			)}
			<main className="flex-1">
				<Outlet />
			</main>
			{isFocusedIdentitySurface ? null : <HubFooter />}
		</div>
	);
}

function isFocusedIdentityPath(pathname: string, search: string): boolean {
	if (pathname === "/account/federation/consent" || pathname === "/account/federation/error") {
		return true;
	}
	if (pathname !== "/account/login" && pathname !== "/account/register") {
		return false;
	}
	return new URLSearchParams(search).get("client_id") === "muc-wiki";
}

function HeaderEntryLink({
	className,
	entry,
	onNavigate,
}: {
	className?: string;
	entry: HubLauncherEntry;
	onNavigate?: () => void;
}) {
	const content = (
		<span
			className={cn(
				"inline-flex min-h-11 items-center px-1 text-sm font-medium text-muted-foreground",
				className,
			)}
		>
			{entry.label}
		</span>
	);
	const href = resolveHubEntryHref(entry);

	if (entry.targetKind === "external") {
		return (
			<a href={href} onClick={onNavigate} rel="noreferrer" target="_blank">
				{content}
			</a>
		);
	}

	return (
		<a href={href} onClick={onNavigate}>
			{content}
		</a>
	);
}

export function NotFoundPage() {
	return (
		<ShellSection className="max-w-2xl text-center">
			<PageTitle>入口不存在</PageTitle>
			<PageDescription>当前入口不可用，请返回首页选择已开放的校园应用。</PageDescription>
			<Button asChild className="mt-6">
				<Link to="/">返回入口</Link>
			</Button>
		</ShellSection>
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
	return <h1 className="text-4xl font-bold tracking-normal text-foreground">{children}</h1>;
}

export function PageDescription({ children }: { children: ReactNode }) {
	return <p className="mt-3 text-base leading-7 text-muted-foreground">{children}</p>;
}

function HubFooter() {
	return (
		<footer className="border-t border-border bg-card">
			<div className="mx-auto flex min-h-20 w-full max-w-6xl items-center justify-center px-5 text-sm text-muted-foreground lg:px-8">
				MUC Wiki Hub. 极简工具化校园入口。
			</div>
		</footer>
	);
}
