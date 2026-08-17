"use client";

import {
	Button,
	cn,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@campus-agent/ui";
import { Slot } from "radix-ui";
import { type ComponentPropsWithRef, forwardRef } from "react";

export type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
	tooltip: string;
	side?: "top" | "bottom" | "left" | "right";
};

export const TooltipIconButton = forwardRef<HTMLButtonElement, TooltipIconButtonProps>(
	({ children, tooltip, side = "bottom", className, ...rest }, ref) => (
		<TooltipProvider delayDuration={0}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						{...rest}
						className={cn(
							"aui-button-icon relative size-6 p-1 after:absolute after:-inset-x-2.5 after:-inset-y-2.5 after:content-[''] active:[&_svg]:scale-90",
							className,
						)}
						ref={ref}
					>
						<Slot.Slottable>{children}</Slot.Slottable>
						<span className="aui-sr-only sr-only">{tooltip}</span>
					</Button>
				</TooltipTrigger>
				<TooltipContent side={side}>{tooltip}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	),
);

TooltipIconButton.displayName = "TooltipIconButton";
