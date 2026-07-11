import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { PanelLeft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { cn } from "./cn";

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
	const mobileNavRef = useRef<HTMLDivElement>(null);
	const mobileNavButtonRef = useRef<HTMLButtonElement>(null);
	const previousPathnameRef = useRef<string | null>(null);
	const wasOpenRef = useRef(false);
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
		mainRef.current?.focus();
	}, [pathname]);
	useEffect(() => {
		if (!open) {
			if (wasOpenRef.current) {
				mobileNavButtonRef.current?.focus();
			}
			wasOpenRef.current = false;
			return;
		}
		wasOpenRef.current = true;
		mobileNavRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				return;
			}
			if (event.key !== "Tab") {
				return;
			}
			const focusable = Array.from(
				mobileNavRef.current?.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
				) ?? [],
			);
			if (focusable.length === 0) {
				event.preventDefault();
				mobileNavRef.current?.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open]);
	const nav = (
		<nav aria-label="运维导航" className="grid gap-1">
			{navItems.map((item) => {
				const Icon = item.icon;
				const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
				return (
					<Link
						className={cn(
							"flex min-h-11 items-center gap-3 rounded-md px-3 text-sm",
							active
								? "bg-slate-950 font-semibold text-white"
								: "text-slate-700 hover:bg-slate-100",
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
		<div className="min-h-dvh bg-slate-100 text-slate-950">
			<a
				className="sr-only z-40 rounded-md bg-white px-3 py-2 font-semibold text-slate-950 shadow-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
				href="#ops-main-content"
			>
				跳到主要内容
			</a>
			<header className="sticky top-0 z-30 border-slate-200 border-b bg-white">
				<div className="flex min-h-14 items-center gap-3 px-4">
					<Button
						aria-controls="ops-web-mobile-nav"
						aria-expanded={open}
						aria-label={open ? "关闭导航" : "打开导航"}
						className="size-11 p-0 lg:hidden"
						onClick={() => setOpen((value) => !value)}
						ref={mobileNavButtonRef}
						variant="ghost"
					>
						<PanelLeft className="size-5" />
					</Button>
					<ShieldCheck className="size-5 text-slate-700" />
					<div className="min-w-0 flex-1">
						<p className="truncate font-semibold">校园助理运维工作台</p>
						<p className="text-slate-500 text-xs">运行状态与请求排查</p>
					</div>
				</div>
			</header>
			<div className="flex">
				<aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 border-slate-200 border-r bg-white p-3 lg:block">
					{nav}
				</aside>
				{open ? (
					<>
						<div
							aria-hidden="true"
							className="fixed inset-0 top-14 z-10 bg-slate-950/20 lg:hidden"
							onClick={() => setOpen(false)}
						/>
						<div
							aria-label="移动导航"
							aria-modal="true"
							className="fixed inset-x-0 top-14 z-20 border-slate-200 border-b bg-white p-3 shadow-sm lg:hidden"
							id="ops-web-mobile-nav"
							ref={mobileNavRef}
							role="dialog"
							tabIndex={-1}
						>
							<div className="mb-3 flex items-center justify-between gap-3">
								<p className="font-semibold text-slate-950 text-sm">导航</p>
								<Button
									aria-label="关闭导航"
									className="size-11 p-0"
									onClick={() => setOpen(false)}
									variant="ghost"
								>
									<PanelLeft className="size-5" />
								</Button>
							</div>
							{nav}
						</div>
					</>
				) : null}
				<main
					className="min-w-0 flex-1 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900 lg:p-6"
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
