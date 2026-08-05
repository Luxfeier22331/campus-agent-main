import { Button } from "@campus-agent/ui";
import { RefreshCw, UserRound } from "lucide-react";
import { lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import { useCampusSession } from "@/platform/auth/session";
import type { AccountMenuPlacement } from "./authenticated-account-menu";

const AuthenticatedAccountMenu = lazy(() =>
	import("./authenticated-account-menu").then((module) => ({
		default: module.AuthenticatedAccountMenu,
	})),
);

export function AccountEntry({
	className,
	menuOpen,
	menuPlacement = "bottom-end",
	onLogin,
	onMenuOpenChange,
	presentation = "label",
	showSubtitle = false,
}: {
	className?: string;
	menuOpen?: boolean;
	menuPlacement?: AccountMenuPlacement;
	onLogin: () => void;
	onMenuOpenChange?: (open: boolean) => void;
	presentation?: "icon" | "label";
	showSubtitle?: boolean;
}) {
	const session = useCampusSession();
	if (session.status === "loading") {
		return (
			<AccountEntryButton
				busy
				className={className}
				disabled
				label="账号"
				presentation={presentation}
			/>
		);
	}
	if (session.status === "unavailable") {
		return (
			<AccountEntryButton
				busy={session.isRefreshing}
				className={className}
				disabled={session.isRefreshing}
				label={session.isRefreshing ? "正在重试账号状态" : "重试账号状态"}
				onClick={() => void session.refresh()}
				presentation={presentation}
				retry
			/>
		);
	}
	if (session.status === "authenticated") {
		return (
			<Suspense
				fallback={
					<AccountEntryButton
						busy
						className={className}
						disabled
						label="账号"
						presentation={presentation}
					/>
				}
			>
				<AuthenticatedAccountMenu
					className={className}
					menuPlacement={menuPlacement}
					onOpenChange={onMenuOpenChange}
					open={menuOpen}
					presentation={presentation}
					showSubtitle={showSubtitle}
				/>
			</Suspense>
		);
	}
	return (
		<AccountEntryButton
			className={className}
			label="登录"
			onClick={onLogin}
			presentation={presentation}
		/>
	);
}

function AccountEntryButton({
	busy = false,
	className,
	disabled = false,
	label,
	onClick,
	presentation,
	retry = false,
}: {
	busy?: boolean;
	className?: string;
	disabled?: boolean;
	label: string;
	onClick?: () => void;
	presentation: "icon" | "label";
	retry?: boolean;
}) {
	return (
		<Button
			aria-label={label}
			aria-busy={busy || undefined}
			className={cn(
				presentation === "label" ? "w-full min-w-0 justify-start px-2 text-sm" : "",
				className,
			)}
			disabled={disabled}
			onClick={onClick}
			size={presentation === "icon" ? "icon-lg" : "lg"}
			type="button"
			variant="ghost"
		>
			{retry ? (
				<RefreshCw aria-hidden="true" className="size-4 shrink-0" />
			) : (
				<UserRound aria-hidden="true" className="size-4 shrink-0" />
			)}
			{presentation === "label" ? <span className="truncate">{label}</span> : null}
		</Button>
	);
}
