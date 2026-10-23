import {
	Button,
	cn,
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
	ThemeModeControl,
	ThemeModeMenu,
} from "@campus-agent/ui";
import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, PanelLeft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

interface NavItem {
	href: string;
	icon: LucideIcon;
	label: string;
}
interface NavGroup {
	label: string;
	items: NavItem[];
}

export function SidebarLayout({
	children,
	navGroups,
}: {
	children: ReactNode;
	navGroups: NavGroup[];
}) {
	const navItems = navGroups.flatMap((group) => group.items);
	const [open, setOpen] = useState(false);
	const focusMainAfterCloseRef = useRef(false);
	const mainRef = useRef<HTMLElement>(null);
	const previousPathnameRef = useRef<string | null>(null);
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	useEffect(() => {
		if (previousPathnameRef.current === null) {
			previousPathnameRef.current = pathname;
			return;
		}
		if (previousPathnameRef.current === pathname) {
			return;
		}
		previousPathnameRef.current = pathname;
		setOpen(false);
	}, [pathname]);
	const activeHref =
		pathname === "/requests" || pathname.startsWith("/requests/")
			? "/overview"
			: navItems
					.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
					.sort((left, right) => right.href.length - left.href.length)[0]?.href;
	const activeGroup = navGroups.find((group) =>
		group.items.some((item) => item.href === activeHref),
	);
	const activeItem = navItems.find((item) => item.href === activeHref);
	const nav = (
		<nav aria-label="运维导航" className="grid gap-5 lg:gap-4">
			{navGroups.map((group) => (
				<section key={group.label} className="grid gap-0.5">
					<h2 className="mb-1 px-3 font-medium text-muted-foreground text-[11px] tracking-wide">
						{group.label}
					</h2>
					{group.items.map((item) => {
						const Icon = item.icon;
						const active = activeHref === item.href;
						return (
							<Link
								aria-current={active ? "page" : undefined}
								className={cn(
									"flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm lg:min-h-8 lg:py-1.5 transition-[color,background-color,box-shadow] duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
									active
										? "bg-selected font-semibold text-selected-foreground hover:bg-selected-hover active:bg-selected-pressed"
										: "text-foreground hover:bg-surface-hover active:bg-surface-pressed",
								)}
								key={item.href}
								to={item.href}
								onClick={() => {
									if (open) {
										focusMainAfterCloseRef.current = true;
									}
									setOpen(false);
								}}
							>
								<Icon aria-hidden="true" className="size-4 shrink-0" />
								<span>{item.label}</span>
							</Link>
						);
					})}
				</section>
			))}
		</nav>
	);

	return (
		<div className="ops-workspace min-h-dvh bg-background text-foreground" data-ui-profile="ops">
			<a
				className="sr-only z-[var(--layer-overlay)] rounded-md bg-background px-3 py-2 font-semibold text-foreground shadow-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
				href="#ops-main-content"
			>
				跳到主要内容
			</a>
			<header className="sticky top-0 z-[var(--layer-sticky)] border-border border-b bg-background">
				<div className="flex h-14 items-center gap-3 px-3 lg:px-5">
					<Sheet onOpenChange={setOpen} open={open}>
						<SheetTrigger asChild>
							<Button aria-label="打开导航" className="lg:hidden" size="icon-lg" variant="ghost">
								<PanelLeft className="size-5" />
							</Button>
						</SheetTrigger>
						<SheetContent
							aria-label="移动导航"
							onCloseAutoFocus={(event) => {
								if (!focusMainAfterCloseRef.current) {
									return;
								}
								focusMainAfterCloseRef.current = false;
								if (mainRef.current?.isConnected) {
									event.preventDefault();
									mainRef.current.focus({ preventScroll: true });
								}
							}}
							side="left"
						>
							<SheetHeader className="mb-5 pr-10">
								<SheetTitle>校园助理运维工作台</SheetTitle>
							</SheetHeader>
							<div className="min-h-0 flex-1 overflow-y-auto pr-1">{nav}</div>
							<div className="mt-6 border-border border-t pt-4">
								<p className="mb-2 text-sm font-medium" id="ops-mobile-theme-label">
									外观
								</p>
								<ThemeModeControl aria-labelledby="ops-mobile-theme-label" label={null} />
							</div>
						</SheetContent>
					</Sheet>
					<ShieldCheck className="size-5 text-foreground" />
					<div className="min-w-0 flex-1 lg:w-[calc(var(--ops-sidebar-width)-3.5rem)] lg:flex-none">
						<p className="truncate font-semibold">校园助理运维工作台</p>
						<p className="text-muted-foreground text-[10px] tracking-wider">OPS WORKSPACE</p>
					</div>
					<div className="hidden min-w-0 flex-1 items-center gap-2 border-border border-l pl-5 text-xs text-muted-foreground lg:flex">
						<span>{activeGroup?.label}</span>
						<ChevronRight aria-hidden="true" className="size-3" />
						<span className="truncate text-foreground">
							{pathname === "/requests"
								? "运行记录"
								: pathname.startsWith("/requests/")
									? "执行详情"
									: activeItem?.label}
						</span>
					</div>
					<ThemeModeMenu className="hidden shrink-0 lg:inline-flex" />
				</div>
			</header>
			<div className="flex">
				<aside className="sticky top-14 z-[var(--layer-sticky)] hidden h-[calc(100dvh-3.5rem)] w-[var(--ops-sidebar-width)] shrink-0 overflow-y-auto border-border border-r bg-surface-muted px-3 py-5 lg:block">
					{nav}
				</aside>
				<main
					className="ops-main min-w-0 flex-1 p-4 sm:p-6 xl:px-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
					id="ops-main-content"
					ref={mainRef}
					tabIndex={-1}
				>
					{children}
				</main>
			</div>
		</div>
	);
}
