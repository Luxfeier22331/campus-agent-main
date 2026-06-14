import { Link, useNavigate } from "@tanstack/react-router";
import { Menu, MessageSquarePlus, Search, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { AccountLoginDialog } from "@/app/routes/account-action-page";
import { type AccountEntryState, QAAccountEntry } from "@/components/conversation/qa-account-entry";
import { getSessionPrincipal } from "@/features/conversation/api";
import { cn } from "@/lib/utils";
import { UnauthorizedError } from "@/platform/api/client";

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

const railActionClass =
	"inline-flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium leading-5 hover:bg-[var(--sys-bg-muted)]";
const railActionIconClass = "size-4 shrink-0 text-[var(--sys-text-muted)]";
const railActionShortcutClass =
	"ml-auto text-xs font-normal leading-4 text-[var(--sys-text-subtle)]";

export function QAShell({
	children,
	loginRequested,
	topTitle,
}: {
	children: ReactNode | ((props: { openLoginDialog: () => void }) => ReactNode);
	loginRequested?: boolean;
	topTitle: string;
}) {
	const navigate = useNavigate();
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const [loginOpen, setLoginOpen] = useState(false);
	const [accountEntry, setAccountEntry] = useState<AccountEntryState>({ status: "loading" });
	const openLoginDialog = () => setLoginOpen(true);

	const refreshAccountEntry = useCallback(async () => {
		setAccountEntry({ status: "loading" });
		try {
			const session = await getSessionPrincipal();
			setAccountEntry({
				displayName: session.principal.displayName,
				email: session.principal.email,
				status: session.session ? "authenticated" : "unauthenticated",
			});
		} catch (reason: unknown) {
			setAccountEntry({
				status: reason instanceof UnauthorizedError ? "unauthenticated" : "unavailable",
			});
		}
	}, []);

	useEffect(() => {
		void refreshAccountEntry();
	}, [refreshAccountEntry]);

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
				document.dispatchEvent(new CustomEvent("campus-chatkit-open-history-search"));
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
				<ChatKitProductRail
					accountEntry={accountEntry}
					className="hidden lg:flex"
					onLoginRequest={openLoginDialog}
				/>
				<div className="flex min-h-dvh min-w-0 flex-col">
					<header className="border-b border-[var(--sys-border-subtle)] bg-[var(--sys-surface-default)] px-4 lg:px-5">
						<div className="flex min-h-[60px] items-center justify-between gap-4">
							<div className="flex min-w-0 items-center gap-3">
								<button
									aria-label="打开校园问答菜单"
									className="grid size-10 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] lg:hidden"
									onClick={() => setMobileMenuOpen(true)}
									type="button"
								>
									<Menu aria-hidden="true" className="size-5" />
								</button>
								<h1 className="truncate text-sm font-medium tracking-normal text-[var(--sys-text-strong)]">
									{topTitle}
								</h1>
							</div>
							<SupportNavigation className="hidden md:flex" />
						</div>
					</header>
					<main className="relative flex min-h-0 flex-1 flex-col">
						{typeof children === "function" ? children({ openLoginDialog }) : children}
					</main>
				</div>
			</div>
			{mobileMenuOpen ? (
				<div className="fixed inset-0 z-50 bg-[var(--alpha-black-40)] lg:hidden">
					<div className="flex h-dvh w-[min(88vw,var(--layout-chat-sidebar-width))] flex-col bg-[var(--chat-sidebar-bg)] shadow-[var(--shadow-md)]">
						<div className="flex justify-end px-4 pt-4">
							<button
								aria-label="关闭校园问答菜单"
								className="grid size-10 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
								onClick={() => setMobileMenuOpen(false)}
								type="button"
							>
								<X aria-hidden="true" className="size-5" />
							</button>
						</div>
						<ChatKitProductRail
							accountEntry={accountEntry}
							className="flex min-h-0 flex-1 border-r-0 pt-2"
							showSupportNavigation
							onLoginRequest={openLoginDialog}
						/>
					</div>
				</div>
			) : null}
			{loginOpen ? (
				<AccountLoginDialog
					onAuthenticated={async () => {
						await refreshAccountEntry();
						setLoginOpen(false);
					}}
					onClose={() => setLoginOpen(false)}
				/>
			) : null}
		</div>
	);
}

function ChatKitProductRail({
	accountEntry,
	className,
	onLoginRequest,
	showSupportNavigation,
}: {
	accountEntry: AccountEntryState;
	className?: string;
	onLoginRequest?: () => void;
	showSupportNavigation?: boolean;
}) {
	return (
		<aside
			className={cn(
				"w-[var(--layout-chat-sidebar-width)] shrink-0 flex-col border-r border-[var(--chat-sidebar-border)] bg-[var(--chat-sidebar-bg)] px-2.5 py-2.5",
				className,
			)}
		>
			<div className="min-w-0 px-2 py-1.5">
				<p className="truncate text-[13px] font-semibold text-[var(--sys-text-strong)]">
					中央民族大学校园问答
				</p>
				<p className="mt-0.5 text-xs text-[var(--sys-text-subtle)]">MUC Campus Q&A</p>
			</div>
			<div className="mt-2 space-y-1">
				<Link className={cn(railActionClass, "text-[var(--sys-text-strong)]")} to="/">
					<MessageSquarePlus aria-hidden="true" className={railActionIconClass} />
					新对话
					<span aria-hidden="true" className={railActionShortcutClass}>
						⌘⇧O
					</span>
				</Link>
				<button
					className={cn(
						railActionClass,
						"text-[var(--sys-text-muted)] hover:text-[var(--sys-text-strong)]",
					)}
					onClick={() =>
						document.dispatchEvent(new CustomEvent("campus-chatkit-open-history-search"))
					}
					type="button"
				>
					<Search aria-hidden="true" className={railActionIconClass} />
					搜索聊天
					<span aria-hidden="true" className={railActionShortcutClass}>
						⌘K
					</span>
				</button>
			</div>
			{showSupportNavigation ? (
				<SupportNavigation className="mt-5 flex flex-col items-stretch gap-1 border-t border-[var(--chat-sidebar-border)] pt-4" />
			) : null}
			<QAAccountEntry onLoginRequest={onLoginRequest} state={accountEntry} />
		</aside>
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
			className={cn("items-center gap-3", className ?? "hidden md:flex")}
		>
			{visibleItems.map((item) => {
				const active =
					activePath &&
					(item.to === "/docs/$" ? activePath.startsWith("/docs") : activePath === item.to);
				return (
					<Link
						className={cn(
							"inline-flex min-h-8 items-center border-b border-transparent text-xs font-medium text-[var(--sys-text-subtle)] hover:text-[var(--sys-text-strong)]",
							active && "border-[var(--sys-text-strong)] text-[var(--sys-text-strong)]",
							"emphasis" in item &&
								item.emphasis &&
								active &&
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
