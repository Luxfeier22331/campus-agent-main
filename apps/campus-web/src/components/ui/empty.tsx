import type * as React from "react";

import { cn } from "@/lib/utils";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="empty"
			className={cn(
				"flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-8 text-center",
				className,
			)}
			{...props}
		/>
	);
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="empty-header" className={cn("space-y-1", className)} {...props} />;
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"h3">) {
	return (
		<h3
			data-slot="empty-title"
			className={cn("font-medium text-foreground text-sm", className)}
			{...props}
		/>
	);
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			data-slot="empty-description"
			className={cn("max-w-sm text-muted-foreground text-sm", className)}
			{...props}
		/>
	);
}

export { Empty, EmptyDescription, EmptyHeader, EmptyTitle };
