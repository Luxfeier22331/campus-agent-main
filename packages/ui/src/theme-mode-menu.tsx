import { Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";
import { Button } from "./button";
import { cn } from "./cn";
import * as DropdownMenuPrimitive from "./dropdown-menu";
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
		<DropdownMenuPrimitive.DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
			<TooltipProvider delayDuration={300}>
				<Tooltip
					onOpenChange={(open) => setTooltipOpen(menuOpen ? false : open)}
					open={menuOpen ? false : tooltipOpen}
				>
					<TooltipTrigger asChild>
						<DropdownMenuPrimitive.DropdownMenuTrigger asChild>
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
						</DropdownMenuPrimitive.DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom">{accessibleLabel}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<DropdownMenuPrimitive.DropdownMenuPortal>
				<DropdownMenuPrimitive.DropdownMenuContent
					align="end"
					aria-labelledby={menuLabelId}
					className={cn("min-w-44", contentClassName)}
					data-slot="theme-mode-menu-content"
					collisionPadding={16}
					sideOffset={6}
				>
					<DropdownMenuPrimitive.DropdownMenuLabel
						className="px-2 py-1.5 font-medium text-muted-foreground text-xs"
						id={menuLabelId}
					>
						{label}
					</DropdownMenuPrimitive.DropdownMenuLabel>
					<DropdownMenuPrimitive.DropdownMenuRadioGroup
						onValueChange={(value) => setMode(value as ThemeMode)}
						value={mode}
					>
						{options.map(({ icon: Icon, label: optionLabel, value }) => (
							<DropdownMenuPrimitive.DropdownMenuRadioItem key={value} value={value}>
								<Icon aria-hidden="true" className="size-4" />
								<span>{optionLabel}</span>
							</DropdownMenuPrimitive.DropdownMenuRadioItem>
						))}
					</DropdownMenuPrimitive.DropdownMenuRadioGroup>
				</DropdownMenuPrimitive.DropdownMenuContent>
			</DropdownMenuPrimitive.DropdownMenuPortal>
		</DropdownMenuPrimitive.DropdownMenu>
	);
}
