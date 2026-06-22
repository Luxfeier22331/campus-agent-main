import type {
	HTMLAttributes,
	TableHTMLAttributes,
	TdHTMLAttributes,
	ThHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";

export function TableContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
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

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
	return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
	return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
	return <tr className={cn("border-slate-100 border-b", className)} {...props} />;
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
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

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
	return (
		<td className={cn("border-slate-100 border-b px-3 py-3 align-top", className)} {...props} />
	);
}
