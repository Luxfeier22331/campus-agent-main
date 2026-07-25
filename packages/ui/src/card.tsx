import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "./cn";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			className={cn(
				"min-w-0 rounded-[var(--card-radius)] border bg-card text-card-foreground shadow-[var(--card-shadow)]",
				className,
			)}
			data-slot="card"
			ref={ref}
			{...props}
		/>
	),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			className={cn("flex flex-col space-y-1.5 p-6", className)}
			data-slot="card-header"
			ref={ref}
			{...props}
		/>
	),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<
	HTMLHeadingElement,
	React.HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean }
>(({ asChild = false, className, ...props }, ref) => {
	const Component = asChild ? Slot : "h2";
	return (
		<Component
			className={cn("font-semibold leading-none", className)}
			data-slot="card-title"
			ref={ref}
			{...props}
		/>
	);
});
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		className={cn("text-sm text-muted-foreground", className)}
		data-slot="card-description"
		ref={ref}
		{...props}
	/>
));
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div className={cn("p-6 pt-0", className)} data-slot="card-content" ref={ref} {...props} />
	),
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			className={cn("flex items-center p-6 pt-0", className)}
			data-slot="card-footer"
			ref={ref}
			{...props}
		/>
	),
);
CardFooter.displayName = "CardFooter";
