import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

type BadgeTone = "default" | "success" | "warning" | "danger" | "muted";

const toneClass: Record<BadgeTone, string> = {
	danger: "border-red-200 bg-red-50 text-red-700",
	default: "border-slate-200 bg-slate-100 text-slate-800",
	muted: "border-slate-200 bg-white text-slate-500",
	success: "border-emerald-200 bg-emerald-50 text-emerald-700",
	warning: "border-amber-200 bg-amber-50 text-amber-800",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
	tone?: BadgeTone;
}

export function Badge({ className, tone = "default", ...props }: BadgeProps) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium text-xs",
				toneClass[tone],
				className,
			)}
			{...props}
		/>
	);
}
