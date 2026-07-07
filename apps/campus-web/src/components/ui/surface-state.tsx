import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SurfaceStateKind = "empty" | "error" | "info" | "loading" | "success";

interface SurfaceStateProps {
	className?: string;
	description?: ReactNode;
	kind: SurfaceStateKind;
	primaryAction?: ReactNode;
	secondaryAction?: ReactNode;
	title: ReactNode;
}

export function SurfaceState({
	className,
	description,
	kind,
	primaryAction,
	secondaryAction,
	title,
}: SurfaceStateProps) {
	const role = kind === "error" ? "alert" : "status";
	const busy = kind === "loading" ? true : undefined;
	return (
		<Card
			aria-busy={busy}
			aria-label={typeof title === "string" ? title : undefined}
			className={cn(
				"grid min-h-32 gap-3 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-none",
				"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150",
				kind === "error" && "border-destructive/35 bg-destructive/5",
				className,
			)}
			role={role}
		>
			<div className="grid gap-1">
				<h3 className="text-sm font-semibold tracking-normal text-[var(--sys-text-strong)]">
					{title}
				</h3>
				{description ? (
					<p className="text-sm leading-6 text-[var(--sys-text-muted)]">{description}</p>
				) : null}
			</div>
			{kind === "loading" ? (
				<div className="grid gap-2" aria-hidden="true">
					<Skeleton className="h-3.5 w-40" />
					<Skeleton className="h-3.5 w-64 max-w-full" />
				</div>
			) : null}
			{primaryAction || secondaryAction ? (
				<div className="flex flex-wrap items-center gap-2">
					{primaryAction}
					{secondaryAction}
				</div>
			) : null}
		</Card>
	);
}
