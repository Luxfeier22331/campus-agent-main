"use client";

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

interface ToggleGroupContextValue {
	value: string | string[] | undefined;
}

const ToggleGroupContext = createContext<ToggleGroupContextValue>({ value: undefined });

function ToggleGroup({
	children,
	className,
	role = "group",
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
	const value =
		"value" in props && (typeof props.value === "string" || Array.isArray(props.value))
			? props.value
			: undefined;
	return (
		<ToggleGroupContext.Provider value={{ value }}>
			<ToggleGroupPrimitive.Root
				data-slot="toggle-group"
				role={role}
				className={cn("flex flex-wrap gap-2", className)}
				{...props}
			>
				{children}
			</ToggleGroupPrimitive.Root>
		</ToggleGroupContext.Provider>
	);
}

function ToggleGroupItem({
	className,
	role = "button",
	value,
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
	const group = useContext(ToggleGroupContext);
	const pressed = Array.isArray(group.value) ? group.value.includes(value) : group.value === value;
	return (
		<ToggleGroupPrimitive.Item
			aria-pressed={role === "button" ? pressed : undefined}
			data-slot="toggle-group-item"
			role={role}
			value={value}
			className={cn(
				"inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-white px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:border-primary data-[state=on]:bg-[var(--sys-brand-interactive-subtle)] data-[state=on]:text-primary",
				className,
			)}
			{...props}
		/>
	);
}

export { ToggleGroup, ToggleGroupItem };
