import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";
import { Button } from "./button";
import { cn } from "./cn";
import { type ThemeMode, useTheme } from "./theme-provider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

interface ThemeModeOption {
	icon: typeof Sun;
	label: string;
	value: ThemeMode;
}

const options = [
	{ icon: Monitor, label: "跟随系统", value: "system" },
	{ icon: Sun, label: "浅色", value: "light" },
	{ icon: Moon, label: "深色", value: "dark" },
] satisfies readonly [ThemeModeOption, ...ThemeModeOption[]];

export interface ThemeModeMenuProps {
	className?: string;
	contentClassName?: string;
	label?: string;
}

export function ThemeModeMenu({ className, contentClassName, label = "外观" }: ThemeModeMenuProps) {
	const { mode, setMode } = useTheme();
	const [menuOpen, setMenuOpen] = React.useState(false);
	const [tooltipOpen, setTooltipOpen] = React.useState(false);
	const menuLabelId = React.useId();
	const current = options.find((option) => option.value === mode) ?? options[0];
	const accessibleLabel = `${label}，当前${current.label}`;

	return (
		<DropdownMenuPrimitive.Root onOpenChange={setMenuOpen} open={menuOpen}>
			<TooltipProvider delayDuration={300}>
				<Tooltip
					onOpenChange={(open) => setTooltipOpen(menuOpen ? false : open)}
					open={menuOpen ? false : tooltipOpen}
				>
					<TooltipTrigger asChild>
						<DropdownMenuPrimitive.Trigger asChild>
							<Button
								aria-label={accessibleLabel}
								className={className}
								data-slot="theme-mode-menu-trigger"
								size="icon-lg"
								variant="ghost"
							>
								{React.createElement(current.icon, {
									"aria-hidden": true,
									className: "size-4",
								})}
							</Button>
						</DropdownMenuPrimitive.Trigger>
					</TooltipTrigger>
					<TooltipContent side="bottom">{accessibleLabel}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<DropdownMenuPrimitive.Portal>
				<DropdownMenuPrimitive.Content
					align="end"
					aria-labelledby={menuLabelId}
					className={cn(
						"z-[var(--layer-overlay)] select-none min-w-44 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-sm)]",
						contentClassName,
					)}
					data-slot="theme-mode-menu-content"
					sideOffset={6}
				>
					<DropdownMenuPrimitive.Label
						className="px-2 py-1.5 font-medium text-muted-foreground text-xs"
						id={menuLabelId}
					>
						{label}
					</DropdownMenuPrimitive.Label>
					<DropdownMenuPrimitive.RadioGroup
						onValueChange={(value) => setMode(value as ThemeMode)}
						value={mode}
					>
						{options.map(({ icon: Icon, label: optionLabel, value }) => (
							<DropdownMenuPrimitive.RadioItem
								className="relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-sm px-2 pr-8 text-sm outline-none transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] focus:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:text-[var(--state-disabled-text)] data-[state=checked]:bg-selected data-[state=checked]:font-medium data-[state=checked]:text-selected-foreground"
								key={value}
								value={value}
							>
								<Icon aria-hidden="true" className="size-4" />
								<span>{optionLabel}</span>
								<DropdownMenuPrimitive.ItemIndicator className="absolute right-2 inline-flex size-4 items-center justify-center">
									<Check aria-hidden="true" className="size-4" />
								</DropdownMenuPrimitive.ItemIndicator>
							</DropdownMenuPrimitive.RadioItem>
						))}
					</DropdownMenuPrimitive.RadioGroup>
				</DropdownMenuPrimitive.Content>
			</DropdownMenuPrimitive.Portal>
		</DropdownMenuPrimitive.Root>
	);
}
