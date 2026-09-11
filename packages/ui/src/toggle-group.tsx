import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "./cn";

export const toggleVariants = cva(
	"inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-selected data-[state=on]:text-selected-foreground data-[state=on]:hover:bg-selected-hover data-[state=on]:active:bg-selected-pressed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-transparent",
				outline:
					"border border-input bg-transparent shadow-sm hover:bg-surface-hover hover:text-foreground",
			},
			size: {
				default: "h-9 px-2 min-w-9",
				sm: "h-8 px-1.5 min-w-8",
				lg: "h-10 px-2.5 min-w-10",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

type Presentation = "plain" | "segmented" | "chips";
type ToggleStyle = VariantProps<typeof toggleVariants>;
const ToggleGroupContext = React.createContext<ToggleStyle & { presentation: Presentation }>({
	size: "default",
	variant: "default",
	presentation: "plain",
});

export const ToggleGroup = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
		ToggleStyle & {
			presentation?: Presentation;
		}
>(({ className, variant, size, presentation = "plain", children, ...props }, ref) => (
	<ToggleGroupPrimitive.Root
		ref={ref}
		className={cn(
			"flex items-center justify-center gap-1",
			presentation === "segmented" && "rounded-[1.75rem] bg-surface-muted p-1",
			presentation === "chips" && "flex-wrap justify-start gap-2",
			className,
		)}
		{...props}
	>
		<ToggleGroupContext.Provider value={{ variant, size, presentation }}>
			{children}
		</ToggleGroupContext.Provider>
	</ToggleGroupPrimitive.Root>
));
ToggleGroup.displayName = "ToggleGroup";

export const ToggleGroupItem = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & ToggleStyle
>(({ className, children, variant, size, ...props }, ref) => {
	const context = React.useContext(ToggleGroupContext);
	const chips = context.presentation === "chips";
	return (
		<ToggleGroupPrimitive.Item
			ref={ref}
			className={cn(
				toggleVariants({ variant: context.variant ?? variant, size: context.size ?? size }),
				context.presentation !== "plain" &&
					"h-auto min-h-11 min-w-0 select-none rounded-full px-3 py-2 shadow-none motion-reduce:transition-none focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-100 disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)]",
				context.presentation === "segmented" && "data-[state=on]:shadow-[var(--shadow-xs)]",
				chips &&
					"group/chip gap-1 whitespace-nowrap border border-input px-2 data-[state=on]:border-border-selected",
				className,
			)}
			{...props}
		>
			{chips ? (
				<Check aria-hidden="true" className="size-4 invisible group-data-[state=on]/chip:visible" />
			) : null}
			{children}
		</ToggleGroupPrimitive.Item>
	);
});
ToggleGroupItem.displayName = "ToggleGroupItem";
