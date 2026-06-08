import { Link } from "@tanstack/react-router";
import { MessageSquareText } from "lucide-react";

import type { ConversationSummary } from "@/features/conversation/model";
import { cn } from "@/lib/utils";

export function ConversationSidebar({
	activeConversationId,
	conversations,
}: {
	activeConversationId?: string;
	conversations: ConversationSummary[];
}) {
	return (
		<aside className="hidden w-[var(--layout-chat-sidebar-width)] shrink-0 border-r border-[var(--chat-sidebar-border)] bg-[var(--chat-sidebar-bg)] p-4 lg:block">
			<Link
				className="mb-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-white"
				to="/"
			>
				新会话
			</Link>
			<div className="space-y-1">
				{conversations.map((conversation) => (
					<Link
						className={cn(
							"flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-[var(--sys-text-muted)] hover:bg-white",
							activeConversationId === conversation.id &&
								"bg-white text-[var(--sys-text-strong)] shadow-[var(--shadow-xs)]",
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
		</aside>
	);
}
