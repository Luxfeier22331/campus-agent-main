import type * as React from "react";

import { cn } from "@/lib/utils";

function Alert({
	className,
	variant = "default",
	...props
}: React.HTMLAttributes<HTMLDivElement> & {
	variant?: "default" | "destructive" | "success" | "warning";
}) {
	return (
		<div
			className={cn(
				"relative w-full rounded-lg border px-4 py-3 text-sm",
				variant === "default" && "border-border bg-card text-foreground",
				variant === "destructive" && "border-red-200 bg-red-50 text-red-800",
				variant === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800",
				variant === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
				className,
			)}
			role={variant === "destructive" ? "alert" : "status"}
			{...props}
		/>
	);
}

export { Alert };
