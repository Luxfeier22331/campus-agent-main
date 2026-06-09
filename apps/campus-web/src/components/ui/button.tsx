import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

export function Button({
	asChild = false,
	children,
	className,
	type = "button",
	variant = "primary",
	...props
}: PropsWithChildren<
	ButtonHTMLAttributes<HTMLButtonElement> & {
		asChild?: boolean;
		variant?: "ghost" | "outline" | "primary" | "secondary";
	}
>) {
	const Comp = asChild ? Slot : "button";
	return (
		<Comp
			className={cn(
				"inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)]",
				variant === "primary" &&
					"bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--sys-brand-interactive)_88%,black)]",
				variant === "secondary" &&
					"border border-border bg-white text-foreground hover:bg-[var(--sys-bg-subtle)]",
				variant === "outline" &&
					"border border-input bg-white text-foreground hover:bg-[var(--sys-bg-subtle)]",
				variant === "ghost" && "text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]",
				className,
			)}
			type={type}
			{...props}
		>
			{children}
		</Comp>
	);
}
