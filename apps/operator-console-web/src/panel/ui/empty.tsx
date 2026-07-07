import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Empty({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				"flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white px-6 py-8 text-center",
				className,
			)}
			{...props}
		/>
	);
}

export function EmptyTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
	return <h3 className={cn("font-semibold text-slate-950 text-sm", className)} {...props} />;
}

export function EmptyDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
	return <p className={cn("mt-1 max-w-sm text-slate-500 text-sm", className)} {...props} />;
}
