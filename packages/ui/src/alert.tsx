import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "./cn";

const alertVariants = cva(
	"relative w-full rounded-md border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7",
	{
		variants: {
			tone: {
				neutral: "border-border bg-background text-foreground",
				info: "border-info/20 bg-info-subtle text-info",
				success: "border-success/20 bg-success-subtle text-success",
				warning: "border-warning/20 bg-warning-subtle text-warning",
				danger: "border-danger/50 bg-background text-danger [&>svg]:text-danger",
			},
		},
		defaultVariants: { tone: "neutral" },
	},
);

export const Alert = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, role = "alert", tone, ...props }, ref) => (
	<div className={cn(alertVariants({ className, tone }))} ref={ref} role={role} {...props} />
));
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<
	HTMLHeadingElement,
	React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
	<h3 className={cn("mb-1 font-semibold leading-none", className)} ref={ref} {...props} />
));
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div className={cn("text-sm [&_p]:leading-relaxed", className)} ref={ref} {...props} />
));
AlertDescription.displayName = "AlertDescription";
