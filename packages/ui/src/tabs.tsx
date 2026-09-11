import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "./cn";

export const Tabs = TabsPrimitive.Root;

type TabsPresentation = "underline" | "segmented";
const TabsPresentationContext = React.createContext<TabsPresentation>("underline");

export const TabsList = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
		presentation?: TabsPresentation;
	}
>(({ className, children, presentation = "underline", ...props }, ref) => (
	<TabsPrimitive.List
		className={cn(
			"flex max-w-full gap-1 overflow-x-auto",
			presentation === "underline" ? "border-b" : "w-fit rounded-[1.75rem] bg-surface-muted p-1",
			className,
		)}
		data-presentation={presentation}
		ref={ref}
		{...props}
	>
		<TabsPresentationContext.Provider value={presentation}>
			{children}
		</TabsPresentationContext.Provider>
	</TabsPrimitive.List>
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
	const presentation = React.useContext(TabsPresentationContext);
	return (
		<TabsPrimitive.Trigger
			className={cn(
				"min-h-11 shrink-0 whitespace-nowrap px-4 font-medium text-muted-foreground text-sm transition-[color,border-color,background-color] duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] motion-reduce:transition-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:text-[var(--state-disabled-text)]",
				presentation === "underline"
					? "border-transparent border-b-2 data-[state=active]:border-border-selected data-[state=active]:text-selected-foreground"
					: "rounded-full border border-transparent hover:bg-surface-hover data-[state=active]:border-border-selected data-[state=active]:bg-selected data-[state=active]:text-selected-foreground",
				className,
			)}
			ref={ref}
			{...props}
		/>
	);
});
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
