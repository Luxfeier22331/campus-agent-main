import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "./cn";

export const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:translate-y-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				primary:
					"border border-primary-foreground/20 bg-primary text-primary-foreground shadow-[var(--shadow-xs)] hover:bg-primary-hover active:bg-primary-pressed disabled:border-border-default disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)] disabled:shadow-none",
				destructive:
					"bg-destructive text-destructive-foreground shadow-[var(--shadow-xs)] hover:bg-destructive-hover active:bg-destructive-pressed disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)] disabled:shadow-none",
				outline:
					"border border-input bg-background shadow-[var(--shadow-xs)] hover:bg-surface-hover active:bg-surface-pressed disabled:border-border-default disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)] disabled:shadow-none",
				secondary:
					"bg-secondary text-secondary-foreground shadow-[var(--shadow-xs)] hover:bg-surface-hover active:bg-surface-pressed disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)] disabled:shadow-none",
				ghost:
					"hover:bg-surface-hover hover:text-accent-foreground active:bg-surface-pressed disabled:bg-transparent disabled:text-[var(--state-disabled-text)]",
				link: "text-link underline-offset-4 hover:text-link-hover hover:underline active:text-primary-pressed disabled:text-[var(--state-disabled-text)]",
			},
			size: {
				default: "min-h-[var(--ui-control-height)] px-4 py-2",
				sm: "min-h-[var(--control-height-sm)] px-3 text-xs",
				lg: "min-h-[var(--control-height-touch)] px-5",
				icon: "size-[var(--control-height-touch)]",
				"icon-lg": "size-[var(--control-height-touch)]",
			},
		},
		defaultVariants: { size: "default", variant: "primary" },
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ asChild = false, className, size, type = "button", variant, ...props }, ref) => {
		const Component = asChild ? Slot : "button";
		return (
			<Component
				className={cn(buttonVariants({ className, size, variant }))}
				data-slot="button"
				ref={ref}
				type={asChild ? undefined : type}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";
