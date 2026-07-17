import { UserRound } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";

const ProductAccountEntry = lazy(() =>
	import("./product-account-entry").then((module) => ({
		default: module.ProductAccountEntry,
	})),
);

export function DeferredProductAccountEntry({ className }: { className?: string }) {
	const [activated, setActivated] = useState(false);

	if (!activated) {
		return <AccountTriggerButton className={className} onClick={() => setActivated(true)} />;
	}

	return (
		<Suspense fallback={<AccountTriggerButton className={className} disabled />}>
			<ProductAccountEntry className={className} openOnReady />
		</Suspense>
	);
}

function AccountTriggerButton({
	className,
	disabled = false,
	onClick,
}: {
	className?: string;
	disabled?: boolean;
	onClick?: () => void;
}) {
	return (
		<Button
			aria-label="账号"
			className={className}
			disabled={disabled}
			onClick={onClick}
			size="icon-lg"
			type="button"
			variant="ghost"
		>
			<UserRound aria-hidden="true" className="size-4" />
		</Button>
	);
}
