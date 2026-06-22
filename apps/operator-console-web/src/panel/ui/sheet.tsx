"use client";

import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/cn";

function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
	return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetContent({
	className,
	children,
	side = "left",
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	side?: "left" | "right";
}) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/35" />
			<DialogPrimitive.Content
				className={cn(
					"fixed inset-y-0 z-50 w-72 bg-white p-3 shadow-lg outline-none",
					side === "left" ? "left-0 border-r" : "right-0 border-l",
					className,
				)}
				{...props}
			>
				{children}
				<DialogPrimitive.Close className="absolute top-3 right-3 grid size-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100">
					<XIcon className="size-4" />
					<span className="sr-only">关闭</span>
				</DialogPrimitive.Close>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("mb-3 pr-10", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			className={cn("font-semibold text-slate-950 text-sm", className)}
			{...props}
		/>
	);
}

export { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger };
