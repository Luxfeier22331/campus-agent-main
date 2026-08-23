"use client";

import { Button } from "@campus-agent/ui";
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
import { searchConversations } from "@/features/conversation/api";
import type { ConversationSearchResult } from "@/features/conversation/model";
import { UnauthorizedError } from "@/platform/api/client";

export function ThreadHistorySearchPanel({
	initialQuery = "",
	inputRef,
	onConversationSelect,
	onHandoff,
	onLoginRequired,
	navigateToConversation,
	onOpenChange,
	open,
	search = searchConversations,
}: {
	initialQuery?: string;
	inputRef: RefObject<HTMLInputElement | null>;
	onConversationSelect?: (() => void) | undefined;
	onHandoff: () => void;
	onLoginRequired: () => void;
	navigateToConversation?: ((conversationId: string) => void) | undefined;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	search?: typeof searchConversations;
}) {
	const [query, setQuery] = useState(initialQuery);
	const [results, setResults] = useState<ConversationSearchResult[]>([]);
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const [retryAttempt, setRetryAttempt] = useState(0);
	const trimmedQuery = query.trim();
	const emptyLabel = useMemo(() => {
		if (!trimmedQuery) {
			return "输入关键词搜索历史会话";
		}
		if (status === "loading") {
			return "";
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
		void retryAttempt;
		if (!(open && trimmedQuery)) {
			setResults([]);
			setStatus("idle");
			return;
		}

		const controller = new AbortController();
		setStatus("loading");
		const timeout = window.setTimeout(() => {
			search({ limit: 10, query: trimmedQuery, signal: controller.signal })
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
					setStatus("error");
				});
		}, 250);

		return () => {
			controller.abort();
			window.clearTimeout(timeout);
		};
	}, [onHandoff, onLoginRequired, onOpenChange, open, retryAttempt, search, trimmedQuery]);

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
						setStatus(nextQuery ? "loading" : "idle");
					}}
					placeholder="搜索历史会话"
					ref={inputRef}
					value={query}
				/>
				<CommandList aria-busy={status === "loading" || undefined}>
					<LayoutGroup>
						<motion.div layout>
							{status === "error" && results.length > 0 ? (
								<div
									className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground"
									role="alert"
								>
									<span>搜索结果暂时无法更新。</span>
									<Button
										onClick={() => setRetryAttempt((attempt) => attempt + 1)}
										size="sm"
										variant="ghost"
									>
										重试
									</Button>
								</div>
							) : null}
							<CommandEmpty>
								{status === "error" ? (
									<div className="grid justify-items-center gap-2">
										<span>搜索暂时不可用</span>
										<Button
											onClick={() => setRetryAttempt((attempt) => attempt + 1)}
											size="sm"
											variant="outline"
										>
											重试搜索
										</Button>
									</div>
								) : (
									<motion.span key={emptyLabel} {...stateSwap}>
										{emptyLabel}
									</motion.span>
								)}
							</CommandEmpty>
							{results.length > 0 ? (
								<motion.div key={trimmedQuery} layout {...contentSwap}>
									<CommandGroup heading="当前">
										{results.map((conversation) => (
											<motion.div key={conversation.id} layout {...contentSwap}>
												<CommandItem
													onSelect={() => {
														onHandoff();
														onOpenChange(false);
														onConversationSelect?.();
														navigateToConversation?.(conversation.id);
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
