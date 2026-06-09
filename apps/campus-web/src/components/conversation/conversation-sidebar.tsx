import { Link } from "@tanstack/react-router";
import {
	ChevronUp,
	HelpCircle,
	LogIn,
	LogOut,
	Plus,
	Search,
	Settings,
	Sparkles,
	UserPlus,
	UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { AccountSettingsDialog } from "@/app/routes/account-page";
import type { AccountSettingsSectionId } from "@/app/routes/account-settings-content";
import { getSessionPrincipal } from "@/features/conversation/api";
import type { ConversationSummary } from "@/features/conversation/model";
import { cn } from "@/lib/utils";
import { UnauthorizedError } from "@/platform/api/client";
import { signOutAccount } from "@/platform/auth/client";

type AccountEntryState =
	| {
			status: "authenticated";
			displayName: string;
			email: string | null;
	  }
	| { status: "loading" | "unauthenticated" | "unavailable" };

export function ConversationSidebar({
	activeConversationId,
	className,
	conversations,
}: {
	activeConversationId?: string;
	className?: string;
	conversations: ConversationSummary[];
}) {
	const [query, setQuery] = useState("");
	const [accountEntry, setAccountEntry] = useState<AccountEntryState>({ status: "loading" });
	const groupedConversations = useMemo(
		() => groupConversations(filterConversations(conversations, query)),
		[conversations, query],
	);

	useEffect(() => {
		let cancelled = false;
		getSessionPrincipal()
			.then((session) => {
				if (cancelled) {
					return;
				}
				setAccountEntry({
					displayName: session.principal.displayName,
					email: session.principal.email,
					status: "authenticated",
				});
			})
			.catch((reason: unknown) => {
				if (cancelled) {
					return;
				}
				setAccountEntry({
					status: reason instanceof UnauthorizedError ? "unauthenticated" : "unavailable",
				});
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<aside
			className={cn(
				"w-[var(--layout-chat-sidebar-width)] shrink-0 flex-col border-r border-[var(--chat-sidebar-border)] bg-[var(--chat-sidebar-bg)] px-3 py-3",
				className,
			)}
		>
			<div className="min-w-0 px-2 py-2">
				<p className="truncate text-sm font-semibold text-[var(--sys-text-strong)]">
					中央民族大学校园问答
				</p>
				<p className="mt-0.5 text-xs text-[var(--sys-text-subtle)]">MUC Campus Q&A</p>
			</div>
			<Link
				className="mt-3 inline-flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)]"
				to="/"
			>
				<Plus aria-hidden="true" className="size-4 text-[var(--sys-text-muted)]" />
				新对话
			</Link>
			<label className="mt-1 flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]">
				<Search aria-hidden="true" className="size-4 shrink-0" />
				<input
					className="min-w-0 flex-1 border-0 bg-transparent outline-none placeholder:text-[var(--sys-text-subtle)]"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="搜索历史会话"
					value={query}
				/>
			</label>
			<div className="mt-4 min-h-0 flex-1 overflow-y-auto">
				{groupedConversations.length > 0 ? (
					<div className="space-y-4">
						{groupedConversations.map((group) => (
							<section key={group.label}>
								<p className="px-2 text-xs font-medium text-[var(--sys-text-subtle)]">
									{group.label}
								</p>
								<div className="mt-2 space-y-1">
									{group.items.map((conversation) => (
										<Link
											className={cn(
												"flex min-h-9 items-center rounded-lg px-2.5 text-sm text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] hover:text-[var(--sys-text-strong)]",
												activeConversationId === conversation.id &&
													"bg-[var(--sys-bg-muted)] font-medium text-[var(--sys-text-strong)]",
											)}
											key={conversation.id}
											params={{ conversationId: conversation.id }}
											to="/c/$conversationId"
										>
											<span className="truncate">{conversation.title}</span>
										</Link>
									))}
								</div>
							</section>
						))}
					</div>
				) : null}
			</div>
			<AccountEntry state={accountEntry} />
		</aside>
	);
}

function AccountEntry({ state }: { state: AccountEntryState }) {
	const [open, setOpen] = useState(false);
	const [settingsSection, setSettingsSection] = useState<AccountSettingsSectionId | null>(null);
	const [signOutError, setSignOutError] = useState<string | null>(null);
	const [signingOut, setSigningOut] = useState(false);
	const label =
		state.status === "authenticated" ? state.displayName.trim() || "账号" : getAccountLabel(state);
	const detail = state.status === "authenticated" ? state.email : null;
	const initial = state.status === "authenticated" ? label.trim().slice(0, 1).toUpperCase() : null;
	const authenticated = state.status === "authenticated";

	useEffect(() => {
		if (!open) {
			return;
		}
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setOpen(false);
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [open]);

	async function handleSignOut() {
		if (!authenticated || signingOut) {
			return;
		}
		setSigningOut(true);
		setSignOutError(null);
		try {
			await signOutAccount();
			window.location.assign("/");
		} catch {
			setSignOutError("退出登录失败，请稍后再试。");
			setSigningOut(false);
		}
	}

	function openSettings(section: AccountSettingsSectionId) {
		setOpen(false);
		setSettingsSection(section);
	}

	return (
		<div className="relative mt-auto pt-3">
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label={detail ? `${label} ${detail}` : label}
				className="group flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-sm text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] hover:text-[var(--sys-text-strong)]"
				onClick={() => setOpen(true)}
				type="button"
			>
				<span
					aria-hidden="true"
					className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--sys-bg-muted)] text-xs font-semibold text-[var(--sys-text-muted)] group-hover:bg-white group-hover:text-[var(--sys-text-strong)]"
				>
					{initial ? initial : <UserRound aria-hidden="true" className="size-4" />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-[var(--sys-text-strong)]">{label}</span>
					{detail ? (
						<span className="block truncate text-xs text-[var(--sys-text-subtle)]">{detail}</span>
					) : null}
				</span>
				<ChevronUp
					aria-hidden="true"
					className="size-4 shrink-0 text-[var(--sys-text-subtle)] opacity-0 transition-opacity group-hover:opacity-100"
				/>
			</button>
			{open ? (
				<AccountMenu
					onSignOut={handleSignOut}
					onSettingsOpen={openSettings}
					signingOut={signingOut}
					signOutError={signOutError}
					state={state}
				/>
			) : null}
			{settingsSection ? (
				<AccountSettingsDialog
					initialSection={settingsSection}
					onClose={() => setSettingsSection(null)}
				/>
			) : null}
		</div>
	);
}

function AccountMenu({
	onSettingsOpen,
	onSignOut,
	signingOut,
	signOutError,
	state,
}: {
	onSettingsOpen: (section: AccountSettingsSectionId) => void;
	onSignOut: () => void;
	signingOut: boolean;
	signOutError: string | null;
	state: AccountEntryState;
}) {
	const authenticated = state.status === "authenticated";

	return (
		<div className="fixed inset-0 z-50">
			<div
				aria-label="账号"
				className="fixed bottom-[76px] left-3 w-[calc(var(--layout-chat-sidebar-width)-24px)] max-w-[calc(100vw-24px)] rounded-2xl border border-[var(--sys-border-subtle)] bg-white p-1.5 text-[var(--sys-text-default)] shadow-[var(--shadow-md)] lg:w-[280px]"
				role="menu"
			>
				{authenticated ? (
					<>
						<AccountMenuButton
							icon={<Settings aria-hidden="true" />}
							label="账号设置"
							onClick={() => onSettingsOpen("account")}
						/>
						<AccountMenuButton
							icon={<Sparkles aria-hidden="true" />}
							label="个性化"
							onClick={() => onSettingsOpen("memory")}
						/>
						<AccountMenuLink
							href="/feedback"
							icon={<HelpCircle aria-hidden="true" />}
							label="帮助与反馈"
						/>
						<div className="my-1 border-t border-[var(--sys-border-subtle)]" />
						<AccountMenuButton
							destructive
							disabled={signingOut}
							icon={<LogOut aria-hidden="true" />}
							label={signingOut ? "正在退出" : "退出登录"}
							onClick={onSignOut}
						/>
						{signOutError ? (
							<p className="px-3 py-2 text-xs text-[var(--sys-status-danger)]">{signOutError}</p>
						) : null}
					</>
				) : (
					<>
						<AccountMenuLink
							href="/account/login"
							icon={<LogIn aria-hidden="true" />}
							label="登录"
						/>
						<AccountMenuLink
							href="/account/register"
							icon={<UserPlus aria-hidden="true" />}
							label="创建账号"
						/>
					</>
				)}
			</div>
		</div>
	);
}

function AccountMenuLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
	return (
		<a
			className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)]"
			href={href}
			role="menuitem"
		>
			<span className="grid size-5 place-items-center text-[var(--sys-text-muted)] [&_svg]:size-4">
				{icon}
			</span>
			<span className="truncate">{label}</span>
		</a>
	);
}

function AccountMenuButton({
	destructive,
	disabled,
	icon,
	label,
	onClick,
}: {
	destructive?: boolean;
	disabled?: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			className={cn(
				"flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)] disabled:cursor-not-allowed disabled:opacity-60",
				destructive && "text-[var(--sys-status-danger)]",
			)}
			disabled={disabled}
			onClick={onClick}
			role="menuitem"
			type="button"
		>
			<span className="grid size-5 place-items-center text-current [&_svg]:size-4">{icon}</span>
			<span className="truncate">{label}</span>
		</button>
	);
}

function getAccountLabel(state: AccountEntryState) {
	if (state.status === "unauthenticated") {
		return "登录";
	}
	return "账号";
}

function filterConversations(conversations: ConversationSummary[], query: string) {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return conversations;
	}
	return conversations.filter((conversation) =>
		conversation.title.toLowerCase().includes(normalized),
	);
}

function groupConversations(conversations: ConversationSummary[]) {
	const groups = new Map<string, ConversationSummary[]>();
	for (const conversation of conversations) {
		const label = getConversationGroupLabel(conversation.updatedAt);
		groups.set(label, [...(groups.get(label) ?? []), conversation]);
	}
	return Array.from(groups, ([label, items]) => ({ items, label }));
}

function getConversationGroupLabel(updatedAt: string) {
	const timestamp = Date.parse(updatedAt);
	if (Number.isNaN(timestamp)) {
		return "更早";
	}
	const now = new Date();
	const updated = new Date(timestamp);
	if (now.toDateString() === updated.toDateString()) {
		return "今天";
	}
	const elapsedDays = (startOfDay(now).getTime() - startOfDay(updated).getTime()) / 86_400_000;
	if (elapsedDays > 0 && elapsedDays < 7) {
		return "本周";
	}
	return "更早";
}

function startOfDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
