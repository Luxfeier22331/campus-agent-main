import type * as React from "react";

import { cn } from "@/lib/utils";

interface FieldLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
	children: React.ReactNode;
	htmlFor: string;
}

function Field({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="field" className={cn("grid gap-2", className)} {...props} />;
}

function FieldLabel({ children, className, htmlFor, ...props }: FieldLabelProps) {
	return (
		<label
			data-slot="field-label"
			className={cn("font-medium text-foreground text-sm", className)}
			htmlFor={htmlFor}
			{...props}
		>
			{children}
		</label>
	);
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			data-slot="field-description"
			className={cn("text-muted-foreground text-xs", className)}
			{...props}
		/>
	);
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			data-slot="field-error"
			className={cn("text-destructive text-xs", className)}
			role="alert"
			{...props}
		/>
	);
}

export { Field, FieldDescription, FieldError, FieldLabel };
