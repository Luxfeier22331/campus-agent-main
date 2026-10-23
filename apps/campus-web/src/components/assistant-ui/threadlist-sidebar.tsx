import { Tooltip, TooltipContent, TooltipTrigger } from "@campus-agent/ui";
import { Link } from "@tanstack/react-router";
import { MessageCircle, SearchIcon } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	preloadThreadHistorySearchPanel,
	ThreadHistorySearchDialog,
} from "@/components/assistant-ui/thread-history-search-dialog";
import { ThreadList, ThreadListNewButton } from "@/components/assistant-ui/thread-list";
import { AccountEntry } from "@/components/auth/user/account-entry";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarTrigger,
	useSidebar,
} from "@/components/ui/sidebar";
import { isEditableKeyboardTarget } from "@/lib/keyboard";

export function ThreadListSidebar({
	accountLoading,
	accountUnavailable,
	authenticated,
	onLoginRequired,
	onRetryAccountStatus,
	retryingAccountStatus,
	...props
}: React.ComponentProps<typeof Sidebar> & {
	accountLoading: boolean;
	accountUnavailable: boolean;
	authenticated: boolean;
	onLoginRequired: () => void;
	onRetryAccountStatus: () => void;
	retryingAccountStatus: boolean;
}) {
	const [searchOpen, setSearchOpen] = useState(false);
	const searchTriggerRef = useRef<HTMLButtonElement>(null);
	const searchReturnFocusRef = useRef<HTMLElement | null>(null);
	const { isMobile, mobileOpenerRef, setOpenMobile, state } = useSidebar();
	const compact = !isMobile && state === "collapsed";
	const openSearch = useCallback((returnFocusTarget?: HTMLElement | null) => {
		preloadThreadHistorySearchPanel();
		let target = returnFocusTarget;
		if (!target && typeof document !== "undefined") {
			const activeElement = document.activeElement;
			if (activeElement instanceof HTMLElement && activeElement !== document.body) {
				target = activeElement;
			}
		}
		searchReturnFocusRef.current = target ?? searchTriggerRef.current;
		setSearchOpen(true);
	}, []);
	const closeMobile = useCallback(() => {
		if (isMobile) {
			setOpenMobile(false);
		}
	}, [isMobile, setOpenMobile]);
	const handleLoginRequired = useCallback(() => {
		if (!isMobile) {
			onLoginRequired();
			return;
		}
		setOpenMobile(false);
		window.requestAnimationFrame(() => {
			mobileOpenerRef.current?.focus({ preventScroll: true });
			onLoginRequired();
		});
	}, [isMobile, mobileOpenerRef, onLoginRequired, setOpenMobile]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const commandKey = event.metaKey || event.ctrlKey;
			if (
				!(event.defaultPrevented || isEditableKeyboardTarget(event.target)) &&
				commandKey &&
				event.key.toLowerCase() === "k"
			) {
				event.preventDefault();
				openSearch();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [openSearch]);

	return (
		<>
			<Sidebar {...props}>
				<SidebarHeader className="aui-sidebar-header h-[var(--layout-chat-topnav-height)] shrink-0 justify-center gap-0 px-1.5 py-1">
					{compact ? (
						<SidebarToggle />
					) : (
						<div className="aui-sidebar-header-content flex min-w-0 items-center gap-1">
							<SidebarMenu className="min-w-0 flex-1">
								<SidebarMenuItem>
									<SidebarBrandLink onNavigate={closeMobile} />
								</SidebarMenuItem>
							</SidebarMenu>
							{isMobile ? null : <SidebarToggle />}
						</div>
					)}
				</SidebarHeader>
				<div className="aui-sidebar-primary-actions shrink-0 px-1.5 pb-1.5 pt-1">
					<SidebarMenu>
						{compact ? (
							<SidebarMenuItem>
								<SidebarBrandLink onNavigate={closeMobile} />
							</SidebarMenuItem>
						) : null}
						<SidebarMenuItem>
							<ThreadListNewButton onNavigate={closeMobile} />
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								aria-label="搜索聊天"
								className="h-11 px-2.5 lg:h-9 group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:!p-3"
								onClick={(event) => openSearch(event.currentTarget)}
								onFocus={preloadThreadHistorySearchPanel}
								onPointerEnter={preloadThreadHistorySearchPanel}
								ref={searchTriggerRef}
								tooltip="搜索聊天"
								type="button"
							>
								<SearchIcon aria-hidden="true" />
								<span>搜索聊天</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</div>
				<SidebarContent className="aui-sidebar-content px-1.5 pb-2 group-data-[collapsible=icon]:hidden">
					<ThreadList
						accountLoading={accountLoading}
						accountUnavailable={accountUnavailable}
						authenticated={authenticated}
						onNavigate={closeMobile}
						onRetryAccountStatus={onRetryAccountStatus}
						retryingAccountStatus={retryingAccountStatus}
					/>
				</SidebarContent>
				<SidebarFooter className="aui-sidebar-footer mt-auto shrink-0 overflow-visible p-1.5">
					<SidebarAccountEntry compact={compact} onLoginRequired={handleLoginRequired} />
				</SidebarFooter>
			</Sidebar>
			{searchOpen ? (
				<ThreadHistorySearchDialog
					onConversationSelect={closeMobile}
					onLoginRequired={handleLoginRequired}
					onOpenChange={setSearchOpen}
					open
					returnFocusRef={searchReturnFocusRef}
				/>
			) : null}
		</>
	);
}

function SidebarBrandLink({ onNavigate }: { onNavigate: () => void }) {
	return (
		<SidebarMenuButton
			asChild
			className="h-11 px-2.5 font-medium group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:!p-3"
			tooltip="校园问答"
		>
			<Link onClick={onNavigate} to="/">
				<MessageCircle aria-hidden="true" />
				<span>校园问答</span>
			</Link>
		</SidebarMenuButton>
	);
}

function SidebarToggle() {
	const { open } = useSidebar();
	return (
		<SidebarTrigger
			aria-controls="campus-chat-sidebar"
			aria-label={open ? "收起聊天记录" : "展开聊天记录"}
			className="size-11 shrink-0 lg:size-9"
		/>
	);
}

function SidebarAccountEntry({
	compact,
	onLoginRequired,
}: {
	compact: boolean;
	onLoginRequired: () => void;
}) {
	const account = (
		<div
			className={
				compact
					? "flex size-11 items-center justify-center [&_[data-slot=dropdown-trigger]]:flex [&_[data-slot=dropdown-trigger]]:size-11 [&_[data-slot=dropdown-trigger]]:items-center [&_[data-slot=dropdown-trigger]]:justify-center"
					: "min-w-0 w-full"
			}
		>
			<AccountEntry
				className={compact ? "size-11" : "min-h-11 w-full lg:min-h-10"}
				menuPlacement={compact ? "right-end" : "top-start"}
				onLogin={onLoginRequired}
				presentation={compact ? "icon" : "label"}
				showSubtitle={!compact}
			/>
		</div>
	);

	if (!compact) {
		return account;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>{account}</TooltipTrigger>
			<TooltipContent side="right">账号</TooltipContent>
		</Tooltip>
	);
}
