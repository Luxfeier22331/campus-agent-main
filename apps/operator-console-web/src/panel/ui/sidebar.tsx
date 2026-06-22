"use client";

import { PanelLeftIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

interface SidebarContextValue {
	openMobile: boolean;
	setOpenMobile: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useSidebar() {
	const context = useContext(SidebarContext);
	if (!context) {
		throw new Error("useSidebar must be used within SidebarProvider.");
	}
	return context;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
	const [openMobile, setOpenMobile] = useState(false);
	const value = useMemo(() => ({ openMobile, setOpenMobile }), [openMobile]);
	return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function Sidebar({
	children,
	className,
	title = "导航",
	...props
}: HTMLAttributes<HTMLElement> & { title?: string }) {
	const { openMobile, setOpenMobile } = useSidebar();
	return (
		<>
			<aside
				className={cn(
					"sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 border-slate-200 border-r bg-white p-3 lg:block",
					className,
				)}
				{...props}
			>
				{children}
			</aside>
			<Sheet onOpenChange={setOpenMobile} open={openMobile}>
				<SheetContent className="lg:hidden">
					<SheetTitle className="sr-only">{title}</SheetTitle>
					{children}
				</SheetContent>
			</Sheet>
		</>
	);
}

export function SidebarTrigger({ className, ...props }: HTMLAttributes<HTMLButtonElement>) {
	const { setOpenMobile } = useSidebar();
	return (
		<Button
			aria-label="打开导航"
			className={cn("lg:hidden", className)}
			onClick={() => setOpenMobile(true)}
			size="icon"
			variant="ghost"
			{...props}
		>
			<PanelLeftIcon className="size-5" />
		</Button>
	);
}

export function SidebarContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("grid gap-1", className)} {...props} />;
}

export function SidebarInset({ className, ...props }: HTMLAttributes<HTMLElement>) {
	return <main className={cn("min-w-0 flex-1 p-4 lg:p-6", className)} {...props} />;
}
