import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "./cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.List
		className={cn("flex max-w-full gap-1 overflow-x-auto border-b", className)}
		ref={ref}
		{...props}
	/>
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Trigger
		className={cn(
			"min-h-11 whitespace-nowrap border-transparent border-b-2 px-4 font-medium text-muted-foreground text-sm transition-[color,border-color,background-color] duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-border-selected data-[state=active]:text-selected-foreground",
			className,
		)}
		ref={ref}
		{...props}
	/>
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Content
		className={cn(
			"mt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			className,
		)}
		ref={ref}
		{...props}
	/>
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
