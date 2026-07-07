import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/cn";

export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("grid gap-1.5 text-sm", className)} {...props} />;
}

interface FieldLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
	children: ReactNode;
	htmlFor: string;
}

export function FieldLabel({ children, className, htmlFor, ...props }: FieldLabelProps) {
	return (
		<label
			className={cn("font-semibold text-slate-700 text-xs leading-none", className)}
			htmlFor={htmlFor}
			{...props}
		>
			{children}
		</label>
	);
}

export function FieldError({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
	return <p className={cn("text-red-700 text-xs", className)} {...props} />;
}
