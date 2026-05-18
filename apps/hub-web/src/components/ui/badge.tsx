import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium",
	{
		defaultVariants: {
			variant: "secondary",
		},
		variants: {
			variant: {
				default: "border-transparent bg-primary text-primary-foreground",
				muted: "border-transparent bg-muted text-muted-foreground",
				outline: "border-border text-foreground",
				secondary: "border-transparent bg-secondary text-secondary-foreground",
				warning: "border-amber-200 bg-amber-50 text-amber-900",
			},
		},
	},
);

export interface BadgeProps
	extends React.HTMLAttributes<HTMLSpanElement>,
		VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
	return <span className={cn(badgeVariants({ className, variant }))} {...props} />;
}

export { badgeVariants };
