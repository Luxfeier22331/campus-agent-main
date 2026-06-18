import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

type AlertTone = "info" | "warning" | "danger" | "success";

const toneClass: Record<AlertTone, string> = {
	danger: "border-red-200 bg-red-50 text-red-800",
	info: "border-sky-200 bg-sky-50 text-sky-800",
	success: "border-emerald-200 bg-emerald-50 text-emerald-800",
	warning: "border-amber-200 bg-amber-50 text-amber-900",
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
	tone?: AlertTone;
}

export function Alert({ className, tone = "info", ...props }: AlertProps) {
	return (
		<div
			className={cn("rounded-lg border px-4 py-3 text-sm", toneClass[tone], className)}
			role={tone === "danger" ? "alert" : "status"}
			{...props}
		/>
	);
}
