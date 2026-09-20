import type { ReactNode } from "react";
import { ActionGroup } from "./action-group";
import { cn } from "./cn";

export type StateMessageLayout = "inline" | "section" | "page" | "overlay";
export type StateMessageTone = "neutral" | "danger" | "warning";

export interface StateMessageProps {
	className?: string;
	description?: ReactNode;
	layout?: StateMessageLayout;
	primaryAction?: ReactNode;
	role?: "alert" | "status";
	secondaryAction?: ReactNode;
	textAlign?: "left" | "center";
	title?: ReactNode;
	tone?: StateMessageTone;
}

export function StateMessage({
	className,
	description,
	layout = "section",
	primaryAction,
	role,
	secondaryAction,
	textAlign = "left",
	title,
	tone = "neutral",
}: StateMessageProps) {
	return (
		<div
			className={cn(
				"min-w-0",
				layout === "inline" && "flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm",
				layout === "section" && "grid gap-2 py-6",
				layout === "page" &&
					"mx-auto flex min-h-[40dvh] max-w-2xl flex-col justify-center gap-2 py-12",
				layout === "overlay" &&
					"grid gap-2 rounded-[var(--radius-lg)] border border-border/70 bg-surface-raised p-4 shadow-[var(--shadow-sm)]",
				textAlign === "center" && "text-center",
				tone === "danger" && "text-danger",
				tone === "warning" && "text-warning",
				className,
			)}
			data-state-message={layout}
			role={role}
		>
			{title ? (
				<h2 className="text-sm font-semibold text-[var(--sys-text-strong)]">{title}</h2>
			) : null}
			{description ? (
				<p
					className={cn(
						"m-0 text-sm leading-6",
						tone === "neutral" && "text-[var(--sys-text-muted)]",
					)}
				>
					{description}
				</p>
			) : null}
			{primaryAction || secondaryAction ? (
				<ActionGroup>
					{primaryAction}
					{secondaryAction}
				</ActionGroup>
			) : null}
		</div>
	);
}
