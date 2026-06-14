import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SupportSurfaceShell({
	children,
	className,
	contentClassName,
	eyebrow,
	title,
	toolbar,
}: {
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	eyebrow?: string;
	title: string;
	toolbar?: ReactNode;
}) {
	return (
		<section className={cn("mx-auto max-w-[1440px] px-4 py-6 pb-24 lg:px-6", className)}>
			<div className="flex flex-col gap-4 border-b border-[var(--sys-border-subtle)] pb-5 md:flex-row md:items-end md:justify-between">
				<div className="min-w-0">
					{eyebrow ? (
						<p className="text-sm font-medium text-[var(--sys-text-muted)]">{eyebrow}</p>
					) : null}
					<h1 className="mt-1 text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
						{title}
					</h1>
				</div>
				{toolbar ? <div className="w-full md:w-auto">{toolbar}</div> : null}
			</div>
			<div className={cn("mt-5", contentClassName)}>{children}</div>
		</section>
	);
}
