import { Link } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { searchConversations } from "@/features/conversation/api";
import type { ConversationSummary } from "@/features/conversation/model";

type SearchState = "idle" | "loading" | "error";

export function ConversationSearchDialog({
	conversations,
	onClose,
}: {
	conversations: ConversationSummary[];
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState(conversations);
	const [state, setState] = useState<SearchState>("idle");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const normalizedQuery = query.trim();
	const visibleConversations = normalizedQuery ? results : conversations;
	const emptyLabel = normalizedQuery ? "没有找到相关会话" : "暂无会话";

	useEffect(() => {
		inputRef.current?.focus();
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onClose();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	useEffect(() => {
		if (!normalizedQuery) {
			setResults(conversations);
			setState("idle");
			return;
		}
		let cancelled = false;
		setState("loading");
		const timer = window.setTimeout(() => {
			searchConversations({
				limit: 20,
				query: normalizedQuery,
				view: "active",
			})
				.then((response) => {
					if (cancelled) {
						return;
					}
					setResults(response.conversations);
					setState("idle");
				})
				.catch(() => {
					if (cancelled) {
						return;
					}
					setResults([]);
					setState("error");
				});
		}, 300);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [conversations, normalizedQuery]);

	const groupedConversations = useMemo(
		() => groupSearchResults(visibleConversations),
		[visibleConversations],
	);

	return (
		<div
			className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--alpha-black-40)] px-3 pt-[10dvh]"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
		>
			<section
				aria-label="搜索聊天"
				aria-modal="true"
				className="flex max-h-[min(640px,80dvh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--sys-border-subtle)] bg-white shadow-[var(--shadow-md)]"
				role="dialog"
			>
				<div className="flex min-h-14 items-center gap-3 border-b border-[var(--sys-border-subtle)] px-4">
					<Search aria-hidden="true" className="size-4 shrink-0 text-[var(--sys-text-muted)]" />
					<input
						className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--sys-text-strong)] outline-none placeholder:text-[var(--sys-text-subtle)]"
						onChange={(event) => setQuery(event.target.value)}
						placeholder="搜索聊天"
						ref={inputRef}
						value={query}
					/>
					<button
						aria-label="关闭搜索"
						className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
						onClick={onClose}
						type="button"
					>
						<X aria-hidden="true" className="size-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{state === "loading" ? (
						<p className="px-3 py-6 text-sm text-[var(--sys-text-muted)]" role="status">
							正在搜索
						</p>
					) : state === "error" ? (
						<p className="px-3 py-6 text-sm text-[var(--sys-status-danger)]">搜索暂时不可用</p>
					) : groupedConversations.length > 0 ? (
						<div className="space-y-3">
							{groupedConversations.map((group) => (
								<section key={group.label}>
									<p className="px-2 py-1 text-xs font-medium text-[var(--sys-text-subtle)]">
										{group.label}
									</p>
									<div className="space-y-1">
										{group.items.map((conversation) => (
											<Link
												className="block min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-[var(--sys-text-strong)] hover:bg-[var(--sys-bg-muted)]"
												key={conversation.id}
												onClick={onClose}
												params={{ conversationId: conversation.id }}
												to="/c/$conversationId"
											>
												<span className="block truncate">{conversation.title}</span>
											</Link>
										))}
									</div>
								</section>
							))}
						</div>
					) : (
						<p className="px-3 py-6 text-sm text-[var(--sys-text-muted)]">{emptyLabel}</p>
					)}
				</div>
			</section>
		</div>
	);
}

function groupSearchResults(conversations: ConversationSummary[]) {
	const pinned = conversations.filter((conversation) => conversation.pinnedAt);
	const regular = conversations.filter((conversation) => !conversation.pinnedAt);
	return [
		...(pinned.length > 0 ? [{ items: pinned, label: "置顶" }] : []),
		...(regular.length > 0 ? [{ items: regular, label: "最近" }] : []),
	];
}
