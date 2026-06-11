import { Link, useNavigate } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { AccountLoginDialog } from "@/app/routes/account-action-page";
import { ConversationSearchDialog } from "@/components/conversation/conversation-search-dialog";
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
	loginRequested,
	onConversationArchived,
	onConversationDeleted,
	onConversationUpdated,
	topTitle,
}: {
	activeConversationId?: string;
	children: ReactNode | ((props: { openLoginDialog: () => void }) => ReactNode);
	conversations: ConversationSummary[];
	loginRequested?: boolean;
	onConversationArchived?: (conversationId: string) => void;
	onConversationDeleted?: (conversationId: string) => void;
	onConversationUpdated?: (conversation: ConversationSummary) => void;
	topTitle: string;
}) {
	const navigate = useNavigate();
	const [historyOpen, setHistoryOpen] = useState(false);
	const [loginOpen, setLoginOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const openLoginDialog = () => setLoginOpen(true);

	useEffect(() => {
		if (loginRequested) {
			setLoginOpen(true);
		}
	}, [loginRequested]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const commandKey = event.metaKey || event.ctrlKey;
			if (!commandKey) {
				return;
			}
			if (event.key.toLowerCase() === "k") {
				event.preventDefault();
				setSearchOpen(true);
				return;
			}
			if (event.shiftKey && event.key.toLowerCase() === "o") {
				event.preventDefault();
				void navigate({ to: "/" });
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [navigate]);

	return (
		<div className="min-h-dvh bg-[var(--sys-bg-canvas)] text-[var(--sys-text-default)]">
			<div className="grid min-h-dvh lg:grid-cols-[var(--layout-chat-sidebar-width)_minmax(0,1fr)]">
				<ConversationSidebar
					activeConversationId={activeConversationId}
					className="hidden lg:flex"
					conversations={conversations}
					onConversationArchived={onConversationArchived}
					onConversationDeleted={onConversationDeleted}
					onConversationUpdated={onConversationUpdated}
					onLoginRequest={openLoginDialog}
					onSearchOpen={() => setSearchOpen(true)}
				/>
				<div className="flex min-h-dvh min-w-0 flex-col">
					<header className="bg-[var(--sys-bg-canvas)] px-4 lg:px-6">
						<div className="flex min-h-14 items-center justify-between gap-4">
							<div className="flex min-w-0 items-center gap-3">
								<button
									aria-label="打开历史会话"
									className="grid size-10 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] lg:hidden"
									onClick={() => setHistoryOpen(true)}
									type="button"
								>
									<Menu aria-hidden="true" className="size-5" />
								</button>
								<h1 className="truncate text-sm font-medium tracking-normal text-[var(--sys-text-muted)]">
									{topTitle}
								</h1>
							</div>
							<SupportNavigation className="hidden md:flex" />
						</div>
						<SupportNavigation className="flex overflow-x-auto border-t border-[var(--sys-border-subtle)] py-1 md:hidden" />
					</header>
					<main className="relative flex min-h-0 flex-1 flex-col">
						{typeof children === "function" ? children({ openLoginDialog }) : children}
					</main>
				</div>
			</div>
			{historyOpen ? (
				<div className="fixed inset-0 z-50 bg-[var(--alpha-black-40)] lg:hidden">
					<div className="flex h-dvh w-[min(88vw,var(--layout-chat-sidebar-width))] flex-col bg-[var(--chat-sidebar-bg)] shadow-[var(--shadow-md)]">
						<div className="flex justify-end px-4 pt-4">
							<button
								aria-label="关闭历史会话"
								className="grid size-10 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
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
							onConversationArchived={onConversationArchived}
							onConversationDeleted={onConversationDeleted}
							onConversationUpdated={onConversationUpdated}
							onLoginRequest={openLoginDialog}
							onSearchOpen={() => setSearchOpen(true)}
						/>
					</div>
				</div>
			) : null}
			{searchOpen ? (
				<ConversationSearchDialog
					conversations={conversations}
					onClose={() => setSearchOpen(false)}
				/>
			) : null}
			{loginOpen ? <AccountLoginDialog onClose={() => setLoginOpen(false)} /> : null}
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
	const visibleItems = supportNavItems.filter(
		(item) => !(activePath === "/map" && item.to === "/feedback"),
	);
	return (
		<nav
			aria-label="支撑页面导航"
			className={cn("items-center gap-5", className ?? "hidden md:flex")}
		>
			{visibleItems.map((item) => {
				const active =
					activePath &&
					(item.to === "/docs/$" ? activePath.startsWith("/docs") : activePath === item.to);
				return (
					<Link
						className={cn(
							"inline-flex min-h-9 items-center border-b border-transparent text-sm font-medium text-[var(--sys-text-muted)] hover:text-[var(--sys-text-strong)]",
							active && "border-[var(--sys-text-strong)] text-[var(--sys-text-strong)]",
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
