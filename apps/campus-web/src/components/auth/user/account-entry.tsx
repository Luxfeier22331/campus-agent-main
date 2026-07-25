import { Button } from "@campus-agent/ui";
import { UserRound } from "lucide-react";
import { lazy, Suspense } from "react";
import { cn } from "@/lib/utils";

const AuthenticatedUserButton = lazy(() =>
	import("./user-button").then((module) => ({ default: module.UserButton })),
);

export function AccountEntry({
	authenticated,
	className,
	onLogin,
	pending,
	variant = "label",
}: {
	authenticated: boolean;
	className?: string;
	onLogin: () => void;
	pending: boolean;
	variant?: "icon" | "label";
}) {
	if (pending) {
		return <AccountEntryButton className={className} disabled label="账号" variant={variant} />;
	}
	if (authenticated) {
		return (
			<Suspense
				fallback={
					<AccountEntryButton className={className} disabled label="账号" variant={variant} />
				}
			>
				<AuthenticatedUserButton />
			</Suspense>
		);
	}
	return (
		<AccountEntryButton className={className} label="登录" onClick={onLogin} variant={variant} />
	);
}

function AccountEntryButton({
	className,
	disabled = false,
	label,
	onClick,
	variant,
}: {
	className?: string;
	disabled?: boolean;
	label: string;
	onClick?: () => void;
	variant: "icon" | "label";
}) {
	return (
		<Button
			aria-label={label}
			className={cn(variant === "label" ? "px-3 text-xs" : "", className)}
			disabled={disabled}
			onClick={onClick}
			size={variant === "icon" ? "icon-lg" : "lg"}
			type="button"
			variant="ghost"
		>
			{variant === "icon" ? <UserRound aria-hidden="true" className="size-4" /> : label}
		</Button>
	);
}
