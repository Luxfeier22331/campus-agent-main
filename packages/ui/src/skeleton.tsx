import { createElement, type HTMLAttributes } from "react";
import { cn } from "./cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return createElement("div", {
		className: cn("animate-pulse rounded-md bg-surface-muted", className),
		...props,
	});
}
