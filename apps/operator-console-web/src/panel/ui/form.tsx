import type {
	HTMLAttributes,
	InputHTMLAttributes,
	LabelHTMLAttributes,
	SelectHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";

export function FieldLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("grid gap-1.5 text-sm", className)} {...props} />;
}

export function FieldText({ className, ...props }: LabelHTMLAttributes<HTMLSpanElement>) {
	return <span className={cn("font-semibold text-slate-700 text-xs", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			className={cn(
				"min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100 disabled:text-slate-500",
				className,
			)}
			{...props}
		/>
	);
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select
			className={cn(
				"min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100 disabled:text-slate-500",
				className,
			)}
			{...props}
		/>
	);
}
