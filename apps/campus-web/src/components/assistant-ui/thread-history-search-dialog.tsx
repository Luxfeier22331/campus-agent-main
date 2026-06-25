"use client";

import { useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { searchConversations } from "@/features/conversation/api";
import type { ConversationSummary } from "@/features/conversation/model";
import { UnauthorizedError } from "@/platform/api/client";

type ConversationSearchView = "active" | "archived";

export function ThreadHistorySearchDialog({
	onLoginRequired,
	onOpenChange,
	open,
}: {
	onLoginRequired: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [view, setView] = useState<ConversationSearchView>("active");
	const [results, setResults] = useState<ConversationSummary[]>([]);
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const trimmedQuery = query.trim();
	const emptyLabel = useMemo(() => {
		if (!trimmedQuery) {
			return "输入关键词搜索历史会话";
		}
		if (status === "loading") {
			return "正在搜索";
		}
		if (status === "error") {
			return "搜索暂时不可用";
		}
		return "没有匹配的聊天记录";
	}, [status, trimmedQuery]);

	useEffect(() => {
		if (!(open && trimmedQuery)) {
			setResults([]);
			setStatus("idle");
			return;
		}

		const controller = new AbortController();
		const timeout = window.setTimeout(() => {
			setStatus("loading");
			searchConversations({ limit: 10, query: trimmedQuery, view })
				.then((payload) => {
					if (controller.signal.aborted) {
						return;
					}
					setResults(payload.conversations);
					setStatus("idle");
				})
				.catch((error: unknown) => {
					if (controller.signal.aborted) {
						return;
					}
					if (error instanceof UnauthorizedError) {
						onOpenChange(false);
						onLoginRequired();
						return;
					}
					setResults([]);
					setStatus("error");
				});
		}, 250);

		return () => {
			controller.abort();
			window.clearTimeout(timeout);
		};
	}, [onLoginRequired, onOpenChange, open, trimmedQuery, view]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0" showCloseButton={false}>
				<Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:size-5">
					<div className="border-b px-3 py-2">
						<DialogTitle className="flex items-center gap-2 text-sm font-medium leading-6">
							<SearchIcon className="size-4" />
							搜索聊天
						</DialogTitle>
						<ToggleGroup
							aria-label="聊天记录范围"
							className="mt-2 justify-start"
							onValueChange={(value) => {
								if (value === "active" || value === "archived") {
									setView(value);
								}
							}}
							type="single"
							value={view}
						>
							<ToggleGroupItem value="active">当前</ToggleGroupItem>
							<ToggleGroupItem value="archived">已归档</ToggleGroupItem>
						</ToggleGroup>
					</div>
					<CommandInput placeholder="搜索历史会话" value={query} onValueChange={setQuery} />
					<CommandList>
						<CommandEmpty>{emptyLabel}</CommandEmpty>
						{results.length > 0 ? (
							<CommandGroup heading={view === "archived" ? "已归档" : "当前"}>
								{results.map((conversation) => (
									<CommandItem
										key={conversation.id}
										value={conversation.title}
										onSelect={() => {
											onOpenChange(false);
											void navigate({
												params: { conversationId: conversation.id },
												to: "/c/$conversationId",
											});
										}}
									>
										<div className="flex min-w-0 flex-col">
											<span className="truncate">{conversation.title}</span>
											<span className="text-muted-foreground text-xs">
												{formatConversationUpdatedAt(conversation.updatedAt)}
											</span>
										</div>
									</CommandItem>
								))}
							</CommandGroup>
						) : null}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}

function formatConversationUpdatedAt(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return new Intl.DateTimeFormat("zh-CN", {
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		month: "2-digit",
	}).format(date);
}
