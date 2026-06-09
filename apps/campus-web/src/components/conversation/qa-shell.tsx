import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { ConversationSidebar } from "@/components/conversation/conversation-sidebar";
import type { ConversationSummary } from "@/features/conversation/model";
import { cn } from "@/lib/utils";

const supportNavItems = [
	{
		label: "文档",
		params: { _splat: "regulations/student_rules/index" },
		to: "/docs/$",
	},
	{ label: "校园地图", to: "/map" },
	{ label: "饭堂分布图", to: "/dining" },
	{ emphasis: true, label: "反馈", to: "/feedback" },
] as const;

export function QAShell({
	activeConversationId,
	children,
	conversations,
	footerText,
	topTitle,
}: {
	activeConversationId?: string;
	children: ReactNode;
	conversations: ConversationSummary[];
	footerText?: string;
	topTitle: string;
}) {
	const [historyOpen, setHistoryOpen] = useState(false);

	return (
		<div className="min-h-dvh bg-[var(--sys-bg-subtle)] text-[var(--sys-text-default)]">
			<div className="grid min-h-dvh lg:grid-cols-[var(--layout-chat-sidebar-width)_minmax(0,1fr)]">
				<ConversationSidebar
					activeConversationId={activeConversationId}
					className="hidden lg:flex"
					conversations={conversations}
					footerText={footerText}
				/>
				<div className="flex min-h-dvh min-w-0 flex-col">
					<header className="flex min-h-16 items-center justify-between border-b border-[var(--topbar-border)] bg-[var(--topbar-bg)] px-4 lg:px-8">
						<div className="flex min-w-0 items-center gap-3">
							<button
								aria-label="打开历史会话"
								className="grid size-11 place-items-center rounded-lg border border-border bg-white text-[var(--sys-text-muted)] lg:hidden"
								onClick={() => setHistoryOpen(true)}
								type="button"
							>
								<Menu aria-hidden="true" className="size-5" />
							</button>
							<h1 className="truncate text-base font-semibold tracking-normal text-[var(--sys-text-strong)]">
								{topTitle}
							</h1>
						</div>
						<SupportNavigation />
					</header>
					<main className="relative flex min-h-0 flex-1 flex-col">{children}</main>
				</div>
			</div>
			{historyOpen ? (
				<div className="fixed inset-0 z-50 bg-[var(--alpha-black-40)] lg:hidden">
					<div className="flex h-dvh w-[min(88vw,var(--layout-chat-sidebar-width))] flex-col bg-[var(--chat-sidebar-bg)] shadow-[var(--shadow-md)]">
						<div className="flex justify-end px-4 pt-4">
							<button
								aria-label="关闭历史会话"
								className="grid size-11 place-items-center rounded-lg border border-border bg-white text-[var(--sys-text-muted)]"
								onClick={() => setHistoryOpen(false)}
								type="button"
							>
								<X aria-hidden="true" className="size-5" />
							</button>
						</div>
						<ConversationSidebar
							activeConversationId={activeConversationId}
							className="flex min-h-0 flex-1 border-r-0 pt-2"
							conversations={conversations}
							footerText={footerText}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}

export function SupportNavigation({
	activePath,
	className,
}: {
	activePath?: string;
	className?: string;
}) {
	return (
		<nav aria-label="支撑页面导航" className={cn("hidden items-center gap-2 md:flex", className)}>
			{supportNavItems.map((item) => {
				const active =
					activePath &&
					(item.to === "/docs/$" ? activePath.startsWith("/docs") : activePath === item.to);
				return (
					<Link
						className={cn(
							"inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] hover:text-[var(--sys-text-strong)]",
							active && "bg-[var(--sys-brand-interactive-subtle)] text-primary",
							"emphasis" in item &&
								item.emphasis &&
								"text-[var(--sys-brand-identity)] hover:text-[var(--sys-brand-identity)]",
						)}
						key={item.label}
						params={"params" in item ? item.params : undefined}
						to={item.to}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}
