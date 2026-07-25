import {
	Button,
	cn,
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@campus-agent/ui";
import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { PanelLeft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

interface NavItem {
	href: string;
	icon: LucideIcon;
	label: string;
}

export function SidebarLayout({
	children,
	navItems,
}: {
	children: ReactNode;
	navItems: NavItem[];
}) {
	const [open, setOpen] = useState(false);
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
		window.scrollTo({ behavior: "auto", left: 0, top: 0 });
		window.requestAnimationFrame(() => mainRef.current?.focus());
	}, [pathname]);
	const nav = (
		<nav aria-label="运维导航" className="grid gap-1">
			{navItems.map((item) => {
				const Icon = item.icon;
				const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
				return (
					<Link
						aria-current={active ? "page" : undefined}
						className={cn(
							"flex min-h-11 items-center gap-3 rounded-md px-3 text-sm",
							active
								? "bg-primary font-semibold text-primary-foreground"
								: "text-foreground hover:bg-surface-muted",
						)}
						key={item.href}
						to={item.href}
						onClick={() => setOpen(false)}
					>
						<Icon aria-hidden="true" className="size-4" />
						<span>{item.label}</span>
					</Link>
				);
			})}
		</nav>
	);

	return (
		<div className="min-h-dvh bg-surface-muted text-foreground">
			<a
				className="sr-only z-40 rounded-md bg-background px-3 py-2 font-semibold text-foreground shadow-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
				href="#ops-main-content"
			>
				跳到主要内容
			</a>
			<header className="sticky top-0 z-30 border-border border-b bg-background">
				<div className="flex min-h-14 items-center gap-3 px-4">
					<Sheet onOpenChange={setOpen} open={open}>
						<SheetTrigger asChild>
							<Button aria-label="打开导航" className="lg:hidden" size="icon-lg" variant="ghost">
								<PanelLeft className="size-5" />
							</Button>
						</SheetTrigger>
						<SheetContent aria-label="移动导航" side="left">
							<SheetHeader className="mb-5 pr-10">
								<SheetTitle>校园助理运维工作台</SheetTitle>
							</SheetHeader>
							{nav}
						</SheetContent>
					</Sheet>
					<ShieldCheck className="size-5 text-foreground" />
					<div className="min-w-0 flex-1">
						<p className="truncate font-semibold">校园助理运维工作台</p>
						<p className="text-muted-foreground text-xs">运行状态与配置管理</p>
					</div>
				</div>
			</header>
			<div className="flex">
				<aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 border-border border-r bg-background p-3 lg:block">
					{nav}
				</aside>
				<main
					className="min-w-0 flex-1 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring lg:p-6"
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
