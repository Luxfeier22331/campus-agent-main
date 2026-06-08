import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/conversation/chat-composer";
import { ConversationSidebar } from "@/components/conversation/conversation-sidebar";
import { MessageList } from "@/components/conversation/message-list";
import { ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import {
	getConversationDetail,
	listConversations,
	submitChatRequest,
} from "@/features/conversation/api";
import type { ConversationDetail, ConversationSummary } from "@/features/conversation/model";
import { UnauthorizedError } from "@/platform/api/client";

export function ConversationPage() {
	const { conversationId } = useParams({ from: "/c/$conversationId" });
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [conversation, setConversation] = useState<ConversationDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		Promise.all([listConversations(), getConversationDetail(conversationId)])
			.then(([summaries, detail]) => {
				setConversations(summaries);
				setConversation(detail);
				setError(null);
			})
			.catch((reason: unknown) => {
				if (reason instanceof UnauthorizedError) {
					window.location.href = "https://hub.muc.wiki/account/login";
					return;
				}
				setError(reason instanceof Error ? reason.message : "会话加载失败。");
			});
	}, [conversationId]);

	async function handleSubmit(prompt: string) {
		setSubmitting(true);
		try {
			const answer = await submitChatRequest({ conversationId, prompt });
			setConversation(answer.conversation);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "发送失败。");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="flex min-h-[calc(100dvh-56px)] pb-28 md:pb-0">
			<ConversationSidebar activeConversationId={conversationId} conversations={conversations} />
			<section className="mx-auto flex w-full max-w-[var(--layout-chat-content-width)] flex-col px-5 py-8">
				{error ? <ErrorPanel message={error} /> : null}
				{conversation ? (
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="flex-1 pb-32">
							<MessageList messages={conversation.messages} />
						</div>
						<div className="fixed inset-x-0 bottom-[64px] z-20 mx-auto max-w-[var(--layout-chat-content-width)] px-5 md:sticky md:bottom-0 md:bg-background md:pb-5">
							<ChatComposer disabled={submitting} onSubmit={handleSubmit} />
						</div>
					</div>
				) : (
					<LoadingPanel label="正在读取会话" />
				)}
			</section>
		</div>
	);
}
