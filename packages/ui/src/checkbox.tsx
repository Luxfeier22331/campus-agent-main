import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import * as React from "react";

import { cn } from "./cn";

export const Checkbox = React.forwardRef<
	React.ElementRef<typeof CheckboxPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
	<CheckboxPrimitive.Root
		className={cn(
			"peer group/checkbox grid size-5 shrink-0 place-content-center rounded-[var(--radius-sm)] border border-input bg-background transition-colors motion-reduce:transition-none enabled:hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger disabled:cursor-not-allowed disabled:!border-border-default disabled:!bg-[var(--state-disabled-bg)] disabled:!text-[var(--state-disabled-text)]",
			className,
		)}
		ref={ref}
		{...props}
	>
		<CheckboxPrimitive.Indicator className="grid place-content-center text-current">
			<Check
				aria-hidden="true"
				className="size-3.5 group-data-[state=indeterminate]/checkbox:hidden"
			/>
			<Minus
				aria-hidden="true"
				className="hidden size-3.5 group-data-[state=indeterminate]/checkbox:block"
			/>
		</CheckboxPrimitive.Indicator>
	</CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
