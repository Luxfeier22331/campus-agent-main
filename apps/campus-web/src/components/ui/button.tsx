import { Slot } from "@radix-ui/react-slot";
import { type ButtonHTMLAttributes, forwardRef, type PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant =
	| "default"
	| "destructive"
	| "ghost"
	| "link"
	| "outline"
	| "primary"
	| "secondary";
type ButtonSize = "default" | "icon" | "icon-lg" | "icon-sm" | "icon-xs" | "lg" | "sm" | "xs";

export const Button = forwardRef<
	HTMLButtonElement,
	PropsWithChildren<
		ButtonHTMLAttributes<HTMLButtonElement> & {
			asChild?: boolean;
			size?: ButtonSize;
			variant?: ButtonVariant;
		}
	>
>(function Button(
	{
		asChild = false,
		children,
		className,
		size = "default",
		type = "button",
		variant = "primary",
		...props
	},
	ref,
) {
	const Comp = asChild ? Slot : "button";
	return (
		<Comp
			className={cn(
				"inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				size === "default" && "min-h-11 px-4",
				size === "xs" && "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
				size === "sm" && "h-8 gap-1.5 rounded-md px-3",
				size === "lg" && "h-10 rounded-md px-6",
				size === "icon" && "size-9",
				size === "icon-xs" && "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
				size === "icon-sm" && "size-8",
				size === "icon-lg" && "size-10",
				(variant === "default" || variant === "primary") &&
					"bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--sys-brand-interactive)_88%,black)]",
				variant === "secondary" &&
					"border border-border bg-white text-foreground hover:bg-[var(--sys-bg-subtle)]",
				variant === "outline" &&
					"border border-input bg-white text-foreground hover:bg-[var(--sys-bg-subtle)]",
				variant === "destructive" &&
					"bg-destructive text-white hover:bg-[color-mix(in_srgb,var(--sys-status-danger)_88%,black)]",
				variant === "ghost" && "text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]",
				variant === "link" && "min-h-0 px-0 text-primary underline-offset-4 hover:underline",
				className,
			)}
			ref={ref}
			type={type}
			{...props}
		>
			{children}
		</Comp>
	);
});
