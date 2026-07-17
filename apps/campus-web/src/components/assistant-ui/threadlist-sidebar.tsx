import { MessagesSquare, SearchIcon } from "lucide-react";
import type * as React from "react";
import { lazy, Suspense, useEffect, useState } from "react";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { Button } from "@/components/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@/components/ui/sidebar";

const ThreadHistorySearchDialog = lazy(() =>
	import("@/components/assistant-ui/thread-history-search-dialog").then((module) => ({
		default: module.ThreadHistorySearchDialog,
	})),
);

export function ThreadListSidebar({
	onLoginRequired,
	...props
}: React.ComponentProps<typeof Sidebar> & {
	onLoginRequired: () => void;
}) {
	const [searchOpen, setSearchOpen] = useState(false);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const commandKey = event.metaKey || event.ctrlKey;
			if (commandKey && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setSearchOpen(true);
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	return (
		<>
			<Sidebar {...props}>
				<SidebarHeader className="aui-sidebar-header mb-2 border-b">
					<div className="aui-sidebar-header-content flex items-center justify-between gap-2">
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton size="lg" tooltip="聊天记录">
									<div className="aui-sidebar-header-icon-wrapper bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
										<MessagesSquare className="aui-sidebar-header-icon size-4" />
									</div>
									<div className="aui-sidebar-header-heading me-6 flex flex-col gap-0.5 leading-none">
										<span className="aui-sidebar-header-title font-semibold">聊天记录</span>
									</div>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
						<Button
							aria-label="搜索聊天"
							className="size-8 shrink-0"
							onClick={() => setSearchOpen(true)}
							size="icon"
							type="button"
							variant="ghost"
						>
							<SearchIcon className="size-4" />
						</Button>
					</div>
				</SidebarHeader>
				<SidebarContent className="aui-sidebar-content px-2">
					<ThreadList />
				</SidebarContent>
				<SidebarRail />
			</Sidebar>
			{searchOpen ? (
				<Suspense fallback={null}>
					<ThreadHistorySearchDialog
						onLoginRequired={onLoginRequired}
						onOpenChange={setSearchOpen}
						open
					/>
				</Suspense>
			) : null}
		</>
	);
}
