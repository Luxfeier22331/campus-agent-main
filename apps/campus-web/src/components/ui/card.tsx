import type { HTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

export function Card({
	children,
	className,
	...props
}: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
	return (
		<section
			className={cn("rounded-xl border border-border bg-card shadow-[var(--shadow-xs)]", className)}
			{...props}
		>
			{children}
		</section>
	);
}
