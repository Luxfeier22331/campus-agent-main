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

export function CardHeader({
	children,
	className,
	...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
	return (
		<div className={cn("flex flex-col gap-1.5 p-5 pb-3", className)} {...props}>
			{children}
		</div>
	);
}

export function CardTitle({
	children,
	className,
	...props
}: PropsWithChildren<HTMLAttributes<HTMLHeadingElement>>) {
	return (
		<h2 className={cn("font-semibold text-base text-foreground", className)} {...props}>
			{children}
		</h2>
	);
}

export function CardDescription({
	children,
	className,
	...props
}: PropsWithChildren<HTMLAttributes<HTMLParagraphElement>>) {
	return (
		<p className={cn("text-muted-foreground text-sm", className)} {...props}>
			{children}
		</p>
	);
}

export function CardContent({
	children,
	className,
	...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
	return (
		<div className={cn("p-5", className)} {...props}>
			{children}
		</div>
	);
}
