"use client";

import { Dialog, DialogContent, DialogTitle, Skeleton } from "@campus-agent/ui";
import { useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { lazy, type RefObject, Suspense, useRef } from "react";
import type { searchConversations } from "@/features/conversation/api";

const loadThreadHistorySearchPanel = () =>
	import("@/components/assistant-ui/thread-history-search-panel").then((module) => ({
		default: module.ThreadHistorySearchPanel,
	}));

const ThreadHistorySearchPanel = lazy(loadThreadHistorySearchPanel);

export function preloadThreadHistorySearchPanel(): void {
	void loadThreadHistorySearchPanel();
}

export function ThreadHistorySearchDialog({
	initialQuery = "",
	onConversationSelect,
	onLoginRequired,
	navigateToConversation,
	onOpenChange,
	open,
	returnFocusRef,
	search,
}: {
	initialQuery?: string;
	onConversationSelect?: (() => void) | undefined;
	onLoginRequired: () => void;
	navigateToConversation?: ((conversationId: string) => void) | undefined;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	returnFocusRef: RefObject<HTMLElement | null>;
	search?: typeof searchConversations;
}) {
	const navigate = useNavigate();
	const dialogRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const skipReturnFocusRef = useRef(false);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="gap-0 overflow-hidden p-0"
				closeLabel="关闭搜索"
				onCloseAutoFocus={(event) => {
					if (skipReturnFocusRef.current) {
						event.preventDefault();
						return;
					}
					const returnTarget = returnFocusRef.current;
					if (returnTarget?.isConnected) {
						event.preventDefault();
						returnTarget.focus({ preventScroll: true });
					}
				}}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					(inputRef.current ?? dialogRef.current)?.focus({ preventScroll: true });
				}}
				ref={dialogRef}
			>
				<div className="border-b px-4 py-3 pr-14">
					<DialogTitle className="flex items-center gap-2 text-sm font-medium leading-6">
						<SearchIcon aria-hidden="true" className="size-4" />
						搜索聊天
					</DialogTitle>
				</div>
				<Suspense fallback={<ThreadHistorySearchPending />}>
					<ThreadHistorySearchPanel
						initialQuery={initialQuery}
						inputRef={inputRef}
						onConversationSelect={onConversationSelect}
						onHandoff={() => {
							skipReturnFocusRef.current = true;
						}}
						onLoginRequired={onLoginRequired}
						navigateToConversation={
							navigateToConversation ??
							((conversationId) => {
								void navigate({ params: { conversationId }, to: "/c/$conversationId" });
							})
						}
						onOpenChange={onOpenChange}
						open={open}
						{...(search ? { search } : {})}
					/>
				</Suspense>
			</DialogContent>
		</Dialog>
	);
}

function ThreadHistorySearchPending() {
	return (
		<div
			aria-label="正在载入聊天搜索"
			aria-live="polite"
			className="grid min-h-40 content-start gap-3 px-4 py-4"
			role="status"
		>
			<Skeleton className="h-12 w-full motion-reduce:animate-none" />
			<div aria-hidden="true" className="flex gap-2">
				<Skeleton className="h-9 w-16 motion-reduce:animate-none" />
				<Skeleton className="h-9 w-20 motion-reduce:animate-none" />
			</div>
			<Skeleton aria-hidden="true" className="h-4 w-2/3 motion-reduce:animate-none" />
		</div>
	);
}
