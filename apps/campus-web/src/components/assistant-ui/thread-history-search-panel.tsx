"use client";

import { useNavigate } from "@tanstack/react-router";
import { LayoutGroup, motion } from "motion/react";
import { type RefObject, useEffect, useMemo, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { CampusMotionProvider, contentSwap, stateSwap } from "@/components/ui/motion";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { searchConversations } from "@/features/conversation/api";
import type { ConversationSearchResult } from "@/features/conversation/model";
import { UnauthorizedError } from "@/platform/api/client";

type ConversationSearchView = "active" | "archived";

export function ThreadHistorySearchPanel({
	inputRef,
	onConversationSelect,
	onHandoff,
	onLoginRequired,
	onOpenChange,
	open,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
	onConversationSelect?: (() => void) | undefined;
	onHandoff: () => void;
	onLoginRequired: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [view, setView] = useState<ConversationSearchView>("active");
	const [results, setResults] = useState<ConversationSearchResult[]>([]);
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
		if (open) {
			inputRef.current?.focus({ preventScroll: true });
		}
	}, [inputRef, open]);

	useEffect(() => {
		if (!(open && trimmedQuery)) {
			setResults([]);
			setStatus("idle");
			return;
		}

		const controller = new AbortController();
		setResults([]);
		setStatus("loading");
		const timeout = window.setTimeout(() => {
			searchConversations({ limit: 10, query: trimmedQuery, signal: controller.signal, view })
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
						onHandoff();
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
	}, [onHandoff, onLoginRequired, onOpenChange, open, trimmedQuery, view]);

	return (
		<CampusMotionProvider>
			<Command
				className="rounded-none [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:size-5"
				label="搜索历史会话"
				shouldFilter={false}
			>
				<CommandInput
					onValueChange={(value) => {
						const nextQuery = value.trim();
						setQuery(value);
						if (nextQuery === trimmedQuery) {
							return;
						}
						setResults([]);
						setStatus(nextQuery ? "loading" : "idle");
					}}
					placeholder="搜索历史会话"
					ref={inputRef}
					value={query}
				/>
				<div className="border-b px-3 py-2">
					<ToggleGroup
						aria-label="聊天记录范围"
						className="justify-start"
						onValueChange={(value) => {
							if (value === "active" || value === "archived") {
								setView(value);
								setResults([]);
								setStatus(trimmedQuery ? "loading" : "idle");
							}
						}}
						type="single"
						value={view}
					>
						<ToggleGroupItem className="min-h-11 sm:min-h-9" value="active">
							当前
						</ToggleGroupItem>
						<ToggleGroupItem className="min-h-11 sm:min-h-9" value="archived">
							已归档
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
				<CommandList>
					<LayoutGroup>
						<motion.div layout>
							<CommandEmpty>
								<motion.span key={emptyLabel} {...stateSwap}>
									{emptyLabel}
								</motion.span>
							</CommandEmpty>
							{results.length > 0 ? (
								<motion.div key={`${view}:${trimmedQuery}`} layout {...contentSwap}>
									<CommandGroup heading={view === "archived" ? "已归档" : "当前"}>
										{results.map((conversation) => (
											<motion.div key={conversation.id} layout {...contentSwap}>
												<CommandItem
													onSelect={() => {
														onHandoff();
														onOpenChange(false);
														onConversationSelect?.();
														void navigate({
															params: { conversationId: conversation.id },
															to: "/c/$conversationId",
														});
													}}
													value={conversation.id}
												>
													<div className="flex min-w-0 flex-col">
														<span className="truncate">{conversation.title}</span>
														{conversation.matchSnippet ? (
															<span className="text-muted-foreground line-clamp-2 text-xs">
																{conversation.matchSnippet}
															</span>
														) : null}
														<span className="text-muted-foreground text-xs">
															{formatConversationUpdatedAt(conversation.updatedAt)}
														</span>
													</div>
												</CommandItem>
											</motion.div>
										))}
									</CommandGroup>
								</motion.div>
							) : null}
						</motion.div>
					</LayoutGroup>
				</CommandList>
			</Command>
		</CampusMotionProvider>
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
