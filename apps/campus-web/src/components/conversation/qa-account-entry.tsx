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
import { type ReactNode, useState } from "react";

import { AccountSettingsDialog } from "@/app/routes/account-page";
import type { AccountSettingsSectionId } from "@/app/routes/account-settings-content";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
	className,
	onLoginRequest,
	placement = "sidebar",
	state,
}: {
	className?: string;
	onLoginRequest?: () => void;
	placement?: "sidebar" | "topbar";
	state: AccountEntryState;
}) {
	const [open, setOpen] = useState(false);
	const [settingsSection, setSettingsSection] = useState<AccountSettingsSectionId | null>(null);
	const [signOutError, setSignOutError] = useState<string | null>(null);
	const [signingOut, setSigningOut] = useState(false);
	const label =
		state.status === "authenticated" ? state.displayName.trim() || "账号" : getAccountLabel(state);
	const detail = state.status === "authenticated" ? state.email : null;
	const initial = state.status === "authenticated" ? label.trim().slice(0, 1).toUpperCase() : null;
	const authenticated = state.status === "authenticated";

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
		setSettingsSection(section);
	}

	return (
		<div className={cn("relative", placement === "sidebar" && "mt-auto pt-3", className)}>
			{placement === "sidebar" ? (
				<hr aria-label="账号区域" className="mb-2 border-t border-[var(--chat-sidebar-border)]" />
			) : null}
			<DropdownMenu onOpenChange={setOpen} open={open}>
				<DropdownMenuTrigger asChild>
					<button
						aria-label={detail ? `${label} ${detail}` : label}
						className={cn(
							accountEntryButtonClass,
							placement === "topbar" && "min-h-10 w-auto max-w-[180px] px-2",
						)}
						type="button"
					>
						<span
							aria-hidden="true"
							className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--sys-bg-muted)] text-xs font-semibold text-[var(--sys-text-muted)] group-hover:bg-white group-hover:text-[var(--sys-text-strong)] [&_svg]:size-4"
						>
							{initial ? initial : <UserRound aria-hidden="true" />}
						</span>
						<span className="min-w-0 flex-1">
							<span className="block truncate font-medium text-[var(--sys-text-strong)]">
								{label}
							</span>
							{detail ? (
								<span className="block truncate text-xs text-[var(--sys-text-subtle)]">
									{detail}
								</span>
							) : null}
						</span>
						<ChevronUp
							aria-hidden="true"
							className={cn(
								"size-4 shrink-0 text-[var(--sys-text-subtle)] opacity-0 transition-opacity group-hover:opacity-100",
								open && "opacity-100",
							)}
						/>
					</button>
				</DropdownMenuTrigger>
				<AccountMenu
					onLoginRequest={() => {
						setOpen(false);
						onLoginRequest?.();
					}}
					placement={placement}
					onSignOut={handleSignOut}
					onSettingsOpen={openSettings}
					signingOut={signingOut}
					signOutError={signOutError}
					state={state}
				/>
			</DropdownMenu>
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
	onLoginRequest,
	placement,
	onSettingsOpen,
	onSignOut,
	signingOut,
	signOutError,
	state,
}: {
	onLoginRequest: () => void;
	placement: "sidebar" | "topbar";
	onSettingsOpen: (section: AccountSettingsSectionId) => void;
	onSignOut: () => void;
	signingOut: boolean;
	signOutError: string | null;
	state: AccountEntryState;
}) {
	const authenticated = state.status === "authenticated";

	return (
		<DropdownMenuContent
			align={placement === "topbar" ? "end" : "start"}
			aria-label="账号"
			className="w-[calc(var(--layout-chat-sidebar-width)-24px)] max-w-[calc(100vw-24px)] border-[var(--sys-border-subtle)] bg-white p-1.5 text-[var(--sys-text-default)] shadow-[var(--shadow-md)] lg:w-[280px]"
			side={placement === "topbar" ? "bottom" : "top"}
			sideOffset={8}
		>
			{authenticated ? (
				<>
					<AccountMenuButton
						icon={<Settings aria-hidden="true" />}
						label="账号设置"
						onSelect={() => onSettingsOpen("account")}
					/>
					<AccountMenuButton
						icon={<Sparkles aria-hidden="true" />}
						label="个性化"
						onSelect={() => onSettingsOpen("memory")}
					/>
					<AccountMenuLink
						href="/feedback"
						icon={<HelpCircle aria-hidden="true" />}
						label="帮助与反馈"
					/>
					<DropdownMenuSeparator className="bg-[var(--sys-border-subtle)]" />
					<AccountMenuButton
						destructive
						disabled={signingOut}
						icon={<LogOut aria-hidden="true" />}
						label={signingOut ? "正在退出" : "退出登录"}
						onSelect={(event) => {
							event.preventDefault();
							void onSignOut();
						}}
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
						onSelect={onLoginRequest}
					/>
					<AccountMenuLink
						href="/account/register"
						icon={<UserPlus aria-hidden="true" />}
						label="创建账号"
					/>
				</>
			)}
		</DropdownMenuContent>
	);
}

function AccountMenuLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
	return (
		<DropdownMenuItem asChild className={accountMenuItemClass}>
			<a href={href}>
				<span className={accountMenuIconClass}>{icon}</span>
				<span className="truncate">{label}</span>
			</a>
		</DropdownMenuItem>
	);
}

function AccountMenuButton({
	destructive,
	disabled,
	icon,
	label,
	onSelect,
}: {
	destructive?: boolean;
	disabled?: boolean;
	icon: ReactNode;
	label: string;
	onSelect: (event: Event) => void;
}) {
	return (
		<DropdownMenuItem
			className={cn(
				accountMenuItemClass,
				"disabled:cursor-not-allowed disabled:opacity-60",
				destructive && "text-[var(--sys-status-danger)]",
			)}
			disabled={disabled}
			onSelect={onSelect}
			variant={destructive ? "destructive" : "default"}
		>
			<span className={cn(accountMenuIconClass, destructive && "text-current")}>{icon}</span>
			<span className="truncate">{label}</span>
		</DropdownMenuItem>
	);
}

function getAccountLabel(state: AccountEntryState) {
	if (state.status === "unauthenticated") {
		return "登录";
	}
	return "账号";
}
