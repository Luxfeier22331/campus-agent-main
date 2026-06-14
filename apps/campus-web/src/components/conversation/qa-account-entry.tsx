import {
	ChevronUp,
	HelpCircle,
	LogIn,
	LogOut,
	Settings,
	Sparkles,
	UserPlus,
	UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { AccountSettingsDialog } from "@/app/routes/account-page";
import type { AccountSettingsSectionId } from "@/app/routes/account-settings-content";
import { cn } from "@/lib/utils";
import { signOutAccount } from "@/platform/auth/client";

const accountEntryButtonClass =
	"group flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium leading-5 text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)] hover:text-[var(--sys-text-strong)]";
const accountMenuItemClass =
	"flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium leading-5 text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)]";
const accountMenuIconClass =
	"grid size-5 shrink-0 place-items-center text-[var(--sys-text-muted)] [&_svg]:size-4";

export type AccountEntryState =
	| {
			status: "authenticated";
			displayName: string;
			email: string | null;
	  }
	| { status: "loading" | "unauthenticated" | "unavailable" };

export function QAAccountEntry({
	onLoginRequest,
	state,
}: {
	onLoginRequest?: () => void;
	state: AccountEntryState;
}) {
	const [open, setOpen] = useState(false);
	const [settingsSection, setSettingsSection] = useState<AccountSettingsSectionId | null>(null);
	const [signOutError, setSignOutError] = useState<string | null>(null);
	const [signingOut, setSigningOut] = useState(false);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
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
		function handlePointerDown(event: PointerEvent) {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}
			if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
				return;
			}
			setOpen(false);
		}
		window.addEventListener("keydown", handleKeyDown);
		document.addEventListener("pointerdown", handlePointerDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("pointerdown", handlePointerDown);
		};
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
			<hr aria-label="账号区域" className="mb-2 border-t border-[var(--chat-sidebar-border)]" />
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label={detail ? `${label} ${detail}` : label}
				className={accountEntryButtonClass}
				onClick={() => setOpen(true)}
				ref={buttonRef}
				type="button"
			>
				<span
					aria-hidden="true"
					className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--sys-bg-muted)] text-xs font-semibold text-[var(--sys-text-muted)] group-hover:bg-white group-hover:text-[var(--sys-text-strong)] [&_svg]:size-4"
				>
					{initial ? initial : <UserRound aria-hidden="true" />}
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
					menuRef={menuRef}
					onLoginRequest={() => {
						setOpen(false);
						onLoginRequest?.();
					}}
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
	menuRef,
	onLoginRequest,
	onSettingsOpen,
	onSignOut,
	signingOut,
	signOutError,
	state,
}: {
	menuRef: React.RefObject<HTMLDivElement | null>;
	onLoginRequest: () => void;
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
				ref={menuRef}
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
						<AccountMenuButton
							icon={<LogIn aria-hidden="true" />}
							label="登录"
							onClick={onLoginRequest}
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
		<a className={accountMenuItemClass} href={href} role="menuitem">
			<span className={accountMenuIconClass}>{icon}</span>
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
				accountMenuItemClass,
				"disabled:cursor-not-allowed disabled:opacity-60",
				destructive && "text-[var(--sys-status-danger)]",
			)}
			disabled={disabled}
			onClick={onClick}
			role="menuitem"
			type="button"
		>
			<span className={cn(accountMenuIconClass, destructive && "text-current")}>{icon}</span>
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
