import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		defaultVariants: {
			size: "default",
			variant: "default",
		},
		variants: {
			size: {
				default: "h-11 px-4 py-2",
				icon: "size-11",
				sm: "h-9 px-3",
			},
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
			},
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

export function Button({ asChild = false, className, size, variant, ...props }: ButtonProps) {
	const Comp = asChild ? Slot : "button";
	return <Comp className={cn(buttonVariants({ className, size, variant }))} {...props} />;
}

export { buttonVariants };
