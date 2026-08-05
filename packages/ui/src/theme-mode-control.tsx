import { Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";
import { cn } from "./cn";
import { type ThemeMode, useTheme } from "./theme-provider";

const options: ReadonlyArray<{
	icon: typeof Sun;
	label: string;
	value: ThemeMode;
}> = [
	{ icon: Monitor, label: "跟随系统", value: "system" },
	{ icon: Sun, label: "浅色", value: "light" },
	{ icon: Moon, label: "深色", value: "dark" },
];

export interface ThemeModeControlProps extends React.HTMLAttributes<HTMLDivElement> {
	disabled?: boolean;
	/**
	 * Accessible name for the mode group. Pass null when an external visible
	 * label is associated through aria-labelledby.
	 */
	label?: string | null;
}

export function ThemeModeControl({
	className,
	disabled = false,
	label = "外观",
	...props
}: ThemeModeControlProps) {
	const { mode, setMode } = useTheme();
	const name = React.useId();
	return (
		<div
			className={cn("grid select-none gap-1.5 border-0 p-0", className)}
			data-slot="theme-mode-control"
			role="radiogroup"
			aria-label={label ?? undefined}
			{...props}
		>
			<div className="grid min-h-11 grid-cols-3 items-stretch gap-0.5 rounded-md border border-border bg-surface-muted p-0.5">
				{options.map(({ icon: Icon, label: optionLabel, value }) => (
					<label
						className={cn("relative min-w-0", disabled ? "cursor-not-allowed" : "cursor-pointer")}
						key={value}
					>
						<input
							checked={mode === value}
							className="peer sr-only"
							disabled={disabled}
							name={name}
							onChange={() => setMode(value)}
							onClick={() => {
								if (mode === value) {
									setMode(value);
								}
							}}
							type="radio"
							value={value}
						/>
						<span className="flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-center text-muted-foreground text-xs transition-[color,background-color,box-shadow] duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] hover:bg-surface-hover hover:text-foreground peer-checked:bg-background peer-checked:text-foreground peer-checked:shadow-[var(--shadow-xs)] peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:text-[var(--state-disabled-text)]">
							{React.createElement(Icon, { "aria-hidden": true, className: "size-4 shrink-0" })}
							<span className="whitespace-nowrap">{optionLabel}</span>
						</span>
					</label>
				))}
			</div>
		</div>
	);
}
