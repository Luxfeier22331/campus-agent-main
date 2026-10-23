import { cva, type VariantProps } from "class-variance-authority";
import { createElement, type HTMLAttributes } from "react";
import { cn } from "./cn";

export const badgeVariants = cva(
	"inline-flex w-fit items-center whitespace-nowrap rounded-[var(--radius-sm)] border border-transparent px-2 py-0.5 text-xs font-medium",
	{
		variants: {
			tone: {
				neutral: "border-border bg-surface-muted text-secondary-foreground",
				info: "border-info-border bg-info-subtle text-info",
				success: "border-success-border bg-success-subtle text-success",
				warning: "border-warning-border bg-warning-subtle text-warning",
				danger: "border-danger-border bg-danger-subtle text-danger",
			},
		},
		defaultVariants: { tone: "neutral" },
	},
);

export interface BadgeProps
	extends HTMLAttributes<HTMLSpanElement>,
		VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
	return createElement("span", {
		className: cn(badgeVariants({ className, tone })),
		"data-slot": "badge",
		...props,
	});
}
