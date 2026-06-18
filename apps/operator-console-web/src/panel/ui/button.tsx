import { Slot } from "@radix-ui/react-slot";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

const variantClass: Record<ButtonVariant, string> = {
	danger: "border-transparent bg-red-600 text-white hover:bg-red-700",
	ghost: "border-transparent bg-transparent text-slate-700 hover:bg-slate-100",
	primary: "border-transparent bg-slate-950 text-white hover:bg-slate-800",
	secondary: "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
};

const sizeClass: Record<ButtonSize, string> = {
	icon: "size-10 p-0",
	md: "min-h-10 px-4 py-2 text-sm",
	sm: "min-h-9 px-3 py-1.5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	asChild?: boolean;
	size?: ButtonSize;
	variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{ asChild, className, size = "md", type = "button", variant = "secondary", ...props },
	ref,
) {
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:pointer-events-none disabled:opacity-50",
				variantClass[variant],
				sizeClass[size],
				className,
			)}
			ref={ref}
			type={asChild ? undefined : type}
			{...props}
		/>
	);
});
