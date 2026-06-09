import { Link } from "@tanstack/react-router";
import { MessageSquareText, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { ConversationSummary } from "@/features/conversation/model";
import { cn } from "@/lib/utils";

export function ConversationSidebar({
	activeConversationId,
	className,
	conversations,
	footerText = "历史会话只用于找回之前的问题；文档、校园地图和饭堂分布图保留在顶部导航中。",
}: {
	activeConversationId?: string;
	className?: string;
	conversations: ConversationSummary[];
	footerText?: string;
}) {
	const [query, setQuery] = useState("");
	const groupedConversations = useMemo(
		() => groupConversations(filterConversations(conversations, query)),
		[conversations, query],
	);

	return (
		<aside
			className={cn(
				"w-[var(--layout-chat-sidebar-width)] shrink-0 flex-col border-r border-[var(--chat-sidebar-border)] bg-[var(--chat-sidebar-bg)] px-4 py-5",
				className,
			)}
		>
			<div className="flex items-center gap-3">
				<span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--sys-brand-identity)] text-sm font-semibold text-white">
					民
				</span>
				<div className="min-w-0">
					<p className="truncate text-base font-semibold text-[var(--sys-text-strong)]">
						中央民族大学校园问答
					</p>
					<p className="text-xs text-[var(--sys-text-subtle)]">MUC Campus Q&A</p>
				</div>
			</div>
			<Link
				className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--sys-border-default)] bg-white px-3 text-sm font-semibold text-primary hover:bg-[var(--sys-brand-interactive-subtle)]"
				to="/"
			>
				<Plus aria-hidden="true" className="size-4" />
				新对话
			</Link>
			<label className="mt-5 flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm text-[var(--sys-text-muted)]">
				<Search aria-hidden="true" className="size-4 shrink-0" />
				<input
					className="min-w-0 flex-1 border-0 bg-transparent outline-none placeholder:text-[var(--sys-text-subtle)]"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="搜索历史会话"
					value={query}
				/>
			</label>
			<div className="mt-5 min-h-0 flex-1 overflow-y-auto">
				{groupedConversations.length > 0 ? (
					<div className="space-y-5">
						{groupedConversations.map((group) => (
							<section key={group.label}>
								<p className="px-2 text-xs font-semibold text-[var(--sys-text-subtle)]">
									{group.label}
								</p>
								<div className="mt-2 space-y-1">
									{group.items.map((conversation) => (
										<Link
											className={cn(
												"flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-[var(--sys-text-muted)] hover:bg-white hover:text-[var(--sys-text-strong)]",
												activeConversationId === conversation.id &&
													"bg-[var(--sys-brand-interactive-subtle)] font-semibold text-primary",
											)}
											key={conversation.id}
											params={{ conversationId: conversation.id }}
											to="/c/$conversationId"
										>
											<MessageSquareText aria-hidden="true" className="size-4 shrink-0" />
											<span className="truncate">{conversation.title}</span>
										</Link>
									))}
								</div>
							</section>
						))}
					</div>
				) : (
					<p className="rounded-lg bg-white px-3 py-3 text-sm leading-6 text-[var(--sys-text-muted)]">
						登录后会在这里显示历史会话。
					</p>
				)}
			</div>
			<div className="mt-auto border-t border-border px-2 pt-4 text-xs leading-5 text-[var(--sys-text-subtle)]">
				<p>{footerText}</p>
				<a className="mt-3 inline-flex font-medium text-[var(--sys-text-muted)]" href="/account">
					账号
				</a>
			</div>
		</aside>
	);
}

function filterConversations(conversations: ConversationSummary[], query: string) {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return conversations;
	}
	return conversations.filter((conversation) =>
		conversation.title.toLowerCase().includes(normalized),
	);
}

function groupConversations(conversations: ConversationSummary[]) {
	const groups = new Map<string, ConversationSummary[]>();
	for (const conversation of conversations) {
		const label = getConversationGroupLabel(conversation.updatedAt);
		groups.set(label, [...(groups.get(label) ?? []), conversation]);
	}
	return Array.from(groups, ([label, items]) => ({ items, label }));
}

function getConversationGroupLabel(updatedAt: string) {
	const timestamp = Date.parse(updatedAt);
	if (Number.isNaN(timestamp)) {
		return "更早";
	}
	const now = new Date();
	const updated = new Date(timestamp);
	if (now.toDateString() === updated.toDateString()) {
		return "今天";
	}
	const elapsedDays = (startOfDay(now).getTime() - startOfDay(updated).getTime()) / 86_400_000;
	if (elapsedDays > 0 && elapsedDays < 7) {
		return "本周";
	}
	return "更早";
}

function startOfDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
