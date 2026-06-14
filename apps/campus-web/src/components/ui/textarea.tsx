import type { TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return (
		<textarea
			className={cn(
				"min-h-32 w-full rounded-xl border border-input bg-white px-4 py-3 text-sm text-foreground outline-none transition-shadow placeholder:text-[var(--sys-text-subtle)] focus:border-ring focus:shadow-[var(--state-focus-shadow)]",
				className,
			)}
			{...props}
		/>
	);
}
