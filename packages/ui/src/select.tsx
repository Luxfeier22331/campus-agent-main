import { Select as SelectPrimitive } from "@base-ui/react/select";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "./cn";
import { controlClass } from "./control-styles";

const SelectPortalContext = React.createContext<{
	container: HTMLElement | null;
	setContainer: (container: HTMLElement | null) => void;
}>({ container: null, setContainer: () => undefined });

type SelectProps = Omit<SelectPrimitive.Root.Props<string>, "onValueChange" | "modal"> & {
	onValueChange?: (value: string) => void;
};

export function Select({ onValueChange, value, defaultValue, ...props }: SelectProps) {
	const [container, setContainer] = React.useState<HTMLElement | null>(null);
	return (
		<SelectPortalContext.Provider value={{ container, setContainer }}>
			<SelectPrimitive.Root
				{...props}
				value={value === "" ? null : value}
				defaultValue={defaultValue === "" ? null : defaultValue}
				onValueChange={(next) => onValueChange?.(next ?? "")}
				modal={false}
			/>
		</SelectPortalContext.Provider>
	);
}

export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
	HTMLButtonElement,
	Omit<SelectPrimitive.Trigger.Props, "className"> & { className?: string }
>(({ children, className, ...props }, ref) => {
	const { setContainer } = React.useContext(SelectPortalContext);
	const attachTrigger = React.useCallback(
		(node: HTMLButtonElement | null) => {
			// Keep options inside the owning dialog's focus and scroll boundary.
			setContainer(node?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null);
			if (typeof ref === "function") {
				return ref(node);
			}
			if (ref) {
				ref.current = node;
			}
		},
		[ref, setContainer],
	);
	return (
		<SelectPrimitive.Trigger
			{...props}
			className={cn(
				controlClass,
				"flex min-h-[var(--ui-control-height)] items-center justify-between gap-2 py-2 text-base md:text-sm enabled:hover:border-ring data-[popup-open]:border-ring data-[placeholder]:text-muted-foreground [&>span:first-child]:min-w-0 [&>span:first-child]:truncate [&>span:last-child]:shrink-0",
				className,
			)}
			ref={attachTrigger}
		>
			{children}
			<SelectPrimitive.Icon>
				<ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
});
SelectTrigger.displayName = "SelectTrigger";

type SelectContentProps = Omit<SelectPrimitive.Popup.Props, "className"> &
	Pick<SelectPrimitive.Positioner.Props, "align" | "side" | "sideOffset"> & {
		className?: string;
		onCloseAutoFocus?: ((event: Event) => void) | undefined;
	};

export const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
	(
		{
			children,
			className,
			align = "start",
			side,
			sideOffset = 4,
			onCloseAutoFocus,
			finalFocus,
			...props
		},
		ref,
	) => {
		const { container } = React.useContext(SelectPortalContext);
		return (
			<SelectPrimitive.Portal container={container ?? undefined}>
				<SelectPrimitive.Positioner
					align={align}
					side={side}
					sideOffset={sideOffset}
					alignItemWithTrigger={false}
					positionMethod="fixed"
					className="z-[var(--layer-overlay)]"
				>
					<DismissableLayer asChild>
						<SelectPrimitive.Popup
							{...props}
							className={cn(
								"min-w-[var(--anchor-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-lg)] border bg-popover text-popover-foreground shadow-[var(--shadow-sm)] outline-none",
								className,
							)}
							ref={ref}
							finalFocus={
								onCloseAutoFocus
									? () => {
											const event = new Event("select.closeAutoFocus", { cancelable: true });
											onCloseAutoFocus(event);
											return !event.defaultPrevented;
										}
									: finalFocus
							}
						>
							<SelectPrimitive.List className="max-h-[min(24rem,var(--available-height))] overflow-y-auto overscroll-contain p-1">
								{children}
							</SelectPrimitive.List>
						</SelectPrimitive.Popup>
					</DismissableLayer>
				</SelectPrimitive.Positioner>
			</SelectPrimitive.Portal>
		);
	},
);
SelectContent.displayName = "SelectContent";

export const SelectLabel = React.forwardRef<
	HTMLDivElement,
	Omit<SelectPrimitive.GroupLabel.Props, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
	<SelectPrimitive.GroupLabel
		{...props}
		className={cn("px-2 py-1.5 font-semibold text-sm", className)}
		ref={ref}
	/>
));
SelectLabel.displayName = "SelectLabel";

export const SelectItem = React.forwardRef<
	HTMLElement,
	Omit<SelectPrimitive.Item.Props, "className"> & { className?: string }
>(({ children, className, ...props }, ref) => (
	<SelectPrimitive.Item
		{...props}
		className={cn(
			"relative flex min-h-[var(--control-height-touch)] select-none items-center rounded-[var(--radius-md)] py-1.5 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:bg-selected data-[selected]:text-selected-foreground data-[selected]:data-[highlighted]:bg-selected-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
		ref={ref}
	>
		<span className="absolute left-2 flex size-4 items-center justify-center">
			<SelectPrimitive.ItemIndicator>
				<Check aria-hidden="true" className="size-4" />
			</SelectPrimitive.ItemIndicator>
		</span>
		<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
	</SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";

export const SelectSeparator = React.forwardRef<
	HTMLDivElement,
	Omit<SelectPrimitive.Separator.Props, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
	<SelectPrimitive.Separator
		{...props}
		className={cn("-mx-1 my-1 h-px bg-border", className)}
		ref={ref}
	/>
));
SelectSeparator.displayName = "SelectSeparator";
