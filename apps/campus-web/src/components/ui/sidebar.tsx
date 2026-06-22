"use client";

import { PanelLeftIcon } from "lucide-react";
import type * as React from "react";
import { createContext, useContext, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH = "var(--layout-chat-sidebar-width)";

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

function SidebarProvider({ children }: { children: React.ReactNode }) {
	const [openMobile, setOpenMobile] = useState(false);
	const value = useMemo(() => ({ openMobile, setOpenMobile }), [openMobile]);
	return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

function Sidebar({
	children,
	className,
	title = "导航",
	...props
}: React.ComponentProps<"aside"> & { title?: string }) {
	const { openMobile, setOpenMobile } = useSidebar();
	return (
		<>
			<aside
				className={cn(
					"hidden min-h-0 w-(--sidebar-width) shrink-0 border-r bg-sidebar lg:flex lg:flex-col",
					className,
				)}
				style={{ ["--sidebar-width" as string]: SIDEBAR_WIDTH }}
				{...props}
			>
				{children}
			</aside>
			<Sheet onOpenChange={setOpenMobile} open={openMobile}>
				<SheetContent
					className="w-[min(88vw,var(--layout-chat-sidebar-width))] bg-sidebar p-0 lg:hidden"
					closeLabel={`关闭${title}`}
					side="left"
				>
					<SheetTitle className="sr-only">{title}</SheetTitle>
					{children}
				</SheetContent>
			</Sheet>
		</>
	);
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-header"
			className={cn("shrink-0 border-b px-3 py-3", className)}
			{...props}
		/>
	);
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-content"
			className={cn("min-h-0 flex-1 overflow-y-auto px-2.5 py-3", className)}
			{...props}
		/>
	);
}

function SidebarTrigger({ children, className, ...props }: React.ComponentProps<typeof Button>) {
	const { setOpenMobile } = useSidebar();
	return (
		<Button
			aria-label="打开导航"
			className={cn("lg:hidden", className)}
			onClick={() => setOpenMobile(true)}
			size="icon-lg"
			type="button"
			variant="ghost"
			{...props}
		>
			{children ?? <PanelLeftIcon aria-hidden="true" className="size-5" />}
		</Button>
	);
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
	return <main className={cn("min-h-0 min-w-0 flex-1", className)} {...props} />;
}

export {
	Sidebar,
	SidebarContent,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
	useSidebar,
};
