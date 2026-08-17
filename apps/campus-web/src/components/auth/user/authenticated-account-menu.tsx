import { cn } from "@campus-agent/ui";
import { Dropdown } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { campusAuthClient } from "@/platform/auth/client";
import { useCampusSession } from "@/platform/auth/session";

export type AccountMenuPlacement = "bottom-end" | "right-end" | "top-start";

const MENU_PLACEMENTS = {
	"bottom-end": "bottom end",
	"right-end": "right bottom",
	"top-start": "top start",
} as const;

export function AuthenticatedAccountMenu({
	className,
	onOpenChange,
	onSignedOut,
	open,
	menuPlacement = "bottom-end",
	presentation = "icon",
	showSubtitle = false,
}: {
	className?: string | undefined;
	menuPlacement?: AccountMenuPlacement;
	onOpenChange?: ((open: boolean) => void) | undefined;
	onSignedOut?: () => void;
	open?: boolean | undefined;
	presentation?: "icon" | "label";
	showSubtitle?: boolean;
}) {
	const navigate = useNavigate();
	const session = useCampusSession();
	const [signingOut, setSigningOut] = useState(false);
	const [signOutError, setSignOutError] = useState(false);
	const userName = session.data?.user.name?.trim() || "校园用户";
	const userEmail = session.data?.user.email ?? "";
	const initial = Array.from(userName)[0]?.toUpperCase() || "用";

	async function handleAction(key: React.Key) {
		if (key === "account") {
			void navigate({ to: "/account/settings/account" });
			return;
		}
		if (key === "security") {
			void navigate({ search: { redirectTo: undefined }, to: "/account/settings/security" });
			return;
		}
		if (key !== "sign-out" || signingOut) {
			return;
		}
		setSigningOut(true);
		setSignOutError(false);
		try {
			await campusAuthClient.signOut({ fetchOptions: { throw: true } });
			await session.refresh();
			onSignedOut?.();
			onOpenChange?.(false);
		} catch {
			setSignOutError(true);
		} finally {
			setSigningOut(false);
		}
	}

	return (
		<Dropdown
			{...(open === undefined ? {} : { isOpen: open })}
			{...(onOpenChange ? { onOpenChange } : {})}
		>
			<Dropdown.Trigger
				{...(presentation === "icon" ? { "aria-label": `账号：${userName}` } : {})}
				className={cn(
					"inline-flex min-h-11 items-center justify-center gap-2 rounded-md text-foreground outline-none transition-[color,background-color] duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
					presentation === "icon" ? "size-11" : "w-full min-w-0 justify-start px-2 text-sm",
					className,
				)}
			>
				<span
					aria-hidden="true"
					className="grid size-8 shrink-0 place-content-center rounded-full bg-surface-muted font-semibold text-xs text-[var(--sys-text-strong)]"
				>
					{initial}
				</span>
				{presentation === "label" ? (
					<span className="min-w-0 flex-1 text-left">
						<span className="block truncate font-medium">{userName}</span>
						{showSubtitle ? (
							<span className="block truncate text-[var(--sys-text-subtle)] text-xs">
								{userEmail}
							</span>
						) : null}
					</span>
				) : null}
			</Dropdown.Trigger>
			<Dropdown.Popover
				data-campus-account-surface="account-menu"
				placement={MENU_PLACEMENTS[menuPlacement]}
			>
				<div className="max-w-64 border-b px-3 py-2.5">
					<p className="truncate font-medium text-sm">{userName}</p>
					<p className="truncate text-[var(--sys-text-subtle)] text-xs">{userEmail}</p>
				</div>
				<Dropdown.Menu aria-label="账号菜单" onAction={handleAction}>
					<Dropdown.Item id="account" textValue="账号设置">
						<Settings aria-hidden="true" className="size-4" />
						<span>账号设置</span>
					</Dropdown.Item>
					<Dropdown.Item id="security" textValue="安全设置">
						<ShieldCheck aria-hidden="true" className="size-4" />
						<span>安全设置</span>
					</Dropdown.Item>
					<Dropdown.Item id="sign-out" isDisabled={signingOut} textValue="退出登录">
						<LogOut aria-hidden="true" className="size-4" />
						<span>{signingOut ? "正在退出" : "退出登录"}</span>
					</Dropdown.Item>
				</Dropdown.Menu>
				{signOutError ? (
					<p className="max-w-64 border-t px-3 py-2 text-danger text-xs" role="alert">
						退出失败，你仍保持登录状态。请稍后重试。
					</p>
				) : null}
			</Dropdown.Popover>
		</Dropdown>
	);
}
