import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";
import { cn } from "./cn";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ children, className, ...props }, ref) => (
	<SelectPrimitive.Trigger
		className={cn(
			"flex min-h-[var(--ui-control-height)] w-full min-w-0 items-center justify-between rounded-[var(--input-radius)] border border-input bg-background gap-2 px-3 py-2 text-base md:text-sm transition-colors motion-reduce:transition-none data-[placeholder]:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:border-border-default disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)] aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger [&>span:first-child]:min-w-0 [&>span:first-child]:truncate [&>span:last-child]:shrink-0",
			className,
		)}
		ref={ref}
		{...props}
	>
		{children}
		<SelectPrimitive.Icon asChild>
			<ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
		</SelectPrimitive.Icon>
	</SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.ScrollUpButton
		className={cn("flex items-center justify-center py-1", className)}
		ref={ref}
		{...props}
	>
		<ChevronUp aria-hidden="true" className="size-4" />
	</SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.ScrollDownButton
		className={cn("flex items-center justify-center py-1", className)}
		ref={ref}
		{...props}
	>
		<ChevronDown aria-hidden="true" className="size-4" />
	</SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

export const SelectContent = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ children, className, position = "popper", ...props }, ref) => (
	<SelectPrimitive.Portal>
		<SelectPrimitive.Content
			className={cn(
				"relative z-[var(--layer-overlay)] max-h-[var(--radix-select-content-available-height)] max-w-[calc(100vw-2rem)] min-w-32 overflow-hidden rounded-[var(--radius-lg)] border bg-popover text-popover-foreground shadow-md",
				position === "popper" &&
					"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
				className,
			)}
			position={position}
			ref={ref}
			{...props}
		>
			<SelectScrollUpButton />
			<SelectPrimitive.Viewport
				className={cn(
					"p-1",
					position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]",
				)}
			>
				{children}
			</SelectPrimitive.Viewport>
			<SelectScrollDownButton />
		</SelectPrimitive.Content>
	</SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectLabel = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Label>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.Label
		className={cn("px-2 py-1.5 font-semibold text-sm", className)}
		ref={ref}
		{...props}
	/>
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ children, className, ...props }, ref) => (
	<SelectPrimitive.Item
		className={cn(
			"relative flex min-h-[var(--control-height-touch)] select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
		ref={ref}
		{...props}
	>
		<span className="absolute left-2 flex size-4 items-center justify-center">
			<SelectPrimitive.ItemIndicator>
				<Check aria-hidden="true" className="size-4" />
			</SelectPrimitive.ItemIndicator>
		</span>
		<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
	</SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export const SelectSeparator = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
	<SelectPrimitive.Separator
		className={cn("-mx-1 my-1 h-px bg-border", className)}
		ref={ref}
		{...props}
	/>
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;
