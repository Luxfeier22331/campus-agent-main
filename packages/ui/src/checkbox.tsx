import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "./cn";

export const Checkbox = React.forwardRef<
	React.ElementRef<typeof CheckboxPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
	<CheckboxPrimitive.Root
		className={cn(
			"peer grid size-4 shrink-0 place-content-center rounded-sm border border-input bg-background shadow-[var(--shadow-xs)] hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border-default disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)] data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
			className,
		)}
		ref={ref}
		{...props}
	>
		<CheckboxPrimitive.Indicator className="grid place-content-center text-current">
			<Check className="size-4" />
		</CheckboxPrimitive.Indicator>
	</CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
