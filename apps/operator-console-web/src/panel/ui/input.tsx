import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
	function Input({ className, ...props }, ref) {
		return (
			<input
				className={cn(
					"min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100 disabled:text-slate-500",
					className,
				)}
				ref={ref}
				{...props}
			/>
		);
	},
);
