import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "./cn";

export const badgeVariants = cva(
	"inline-flex w-fit items-center whitespace-nowrap rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
	{
		variants: {
			tone: {
				neutral: "border-border bg-secondary text-secondary-foreground",
				info: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
				success: "border-success/20 bg-success-subtle text-success",
				warning: "border-warning/20 bg-warning-subtle text-warning",
				danger: "border-danger/20 bg-danger-subtle text-danger",
			},
		},
		defaultVariants: { tone: "neutral" },
	},
);

export interface BadgeProps
	extends React.HTMLAttributes<HTMLSpanElement>,
		VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
	return <span className={cn(badgeVariants({ className, tone }))} data-slot="badge" {...props} />;
}
