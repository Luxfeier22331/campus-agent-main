import { ChevronDown } from "lucide-react";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import { cn } from "./cn";

export const Disclosure = forwardRef<HTMLDetailsElement, ComponentPropsWithoutRef<"details">>(
	({ className, ...props }, ref) => (
		<details ref={ref} className={cn("group/disclosure min-w-0", className)} {...props} />
	),
);
Disclosure.displayName = "Disclosure";

export const DisclosureSummary = forwardRef<HTMLElement, ComponentPropsWithoutRef<"summary">>(
	({ className, children, ...props }, ref) => (
		<summary
			ref={ref}
			className={cn(
				"flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-lg)] text-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden",
				className,
			)}
			{...props}
		>
			<span className="min-w-0">{children}</span>
			<ChevronDown
				aria-hidden="true"
				className="size-4 shrink-0 text-muted-foreground group-open/disclosure:rotate-180"
			/>
		</summary>
	),
);
DisclosureSummary.displayName = "DisclosureSummary";
