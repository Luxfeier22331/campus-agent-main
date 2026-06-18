import type {
	HTMLAttributes,
	TableHTMLAttributes,
	TdHTMLAttributes,
	ThHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";

export function TableWrap({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn("overflow-x-auto rounded-lg border border-slate-200 bg-white", className)}
			{...props}
		/>
	);
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
	return <table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />;
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
	return (
		<th
			className={cn(
				"border-slate-200 border-b bg-slate-50 px-3 py-2 font-semibold text-slate-600 text-xs uppercase",
				className,
			)}
			{...props}
		/>
	);
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
	return (
		<td className={cn("border-slate-100 border-b px-3 py-3 align-top", className)} {...props} />
	);
}
