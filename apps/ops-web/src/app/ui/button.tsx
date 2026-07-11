import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "outline" | "ghost";

const variantClass: Record<ButtonVariant, string> = {
	ghost: "border-transparent bg-transparent text-slate-700 hover:bg-slate-100",
	outline: "border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
	primary: "border-transparent bg-slate-950 text-white hover:bg-slate-800",
};

export const Button = forwardRef<
	HTMLButtonElement,
	ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean; variant?: ButtonVariant }
>(function Button({ asChild, className, type = "button", variant = "primary", ...props }, ref) {
	const Comp = asChild ? Slot : "button";
	return (
		<Comp
			className={cn(
				"inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 py-2 font-semibold text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:pointer-events-none disabled:opacity-50",
				variantClass[variant],
				className,
			)}
			ref={ref}
			type={asChild ? undefined : type}
			{...props}
		/>
	);
});
