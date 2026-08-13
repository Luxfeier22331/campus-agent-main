import { Button } from "@campus-agent/ui";
import { UserRound } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { cn } from "@/lib/utils";

const ProductAccountEntry = lazy(() =>
	import("./product-account-entry").then((module) => ({
		default: module.ProductAccountEntry,
	})),
);

export function DeferredProductAccountEntry({
	className,
	onLogin,
	presentation = "icon",
}: {
	className?: string | undefined;
	onLogin?: (() => void) | undefined;
	presentation?: "icon" | "label";
}) {
	const [activated, setActivated] = useState(false);

	if (!activated) {
		return (
			<AccountTriggerButton
				className={className}
				onClick={() => setActivated(true)}
				presentation={presentation}
			/>
		);
	}

	return (
		<Suspense
			fallback={<AccountTriggerButton className={className} disabled presentation={presentation} />}
		>
			<ProductAccountEntry
				className={className}
				onLogin={onLogin}
				openOnReady
				presentation={presentation}
			/>
		</Suspense>
	);
}

function AccountTriggerButton({
	className,
	disabled = false,
	onClick,
	presentation,
}: {
	className?: string | undefined;
	disabled?: boolean;
	onClick?: () => void;
	presentation: "icon" | "label";
}) {
	return (
		<Button
			aria-label="账号"
			className={cn(presentation === "label" ? "w-full justify-start px-3 text-sm" : "", className)}
			disabled={disabled}
			onClick={onClick}
			size={presentation === "icon" ? "icon-lg" : "lg"}
			type="button"
			variant="ghost"
		>
			{presentation === "icon" ? <UserRound aria-hidden="true" className="size-4" /> : "账号"}
		</Button>
	);
}
