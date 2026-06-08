import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			className={cn(
				"min-h-11 w-full rounded-lg border border-input bg-white px-3 text-sm text-foreground outline-none transition-shadow placeholder:text-[var(--sys-text-subtle)] focus:border-ring focus:shadow-[var(--state-focus-shadow)]",
				className,
			)}
			{...props}
		/>
	);
}
