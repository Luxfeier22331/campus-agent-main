import type { HTMLAttributes } from "react";
import { cn } from "./cn";
export function ActionGroup({
	layout = "inline",
	className,
	...props
}: HTMLAttributes<HTMLDivElement> & { layout?: "inline" | "footer" }) {
	return (
		<div
			{...props}
			className={cn(
				layout === "footer"
					? "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
					: "flex flex-wrap items-center gap-2",
				className,
			)}
		/>
	);
}
