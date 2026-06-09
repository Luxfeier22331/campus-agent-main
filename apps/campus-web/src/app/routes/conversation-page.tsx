import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/conversation/chat-composer";
import { ConversationSidebar } from "@/components/conversation/conversation-sidebar";
import { MessageList } from "@/components/conversation/message-list";
import { ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import {
	getConversationDetail,
	listConversations,
	submitChatRequestStream,
} from "@/features/conversation/api";
import {
	buildAssistantMessageFromCompletedAnswer,
	getLifecycleLabel,
} from "@/features/conversation/lifecycle";
import type {
	ChatRequestStreamEvent,
	ConversationDetail,
	ConversationSummary,
} from "@/features/conversation/model";
import { UnauthorizedError } from "@/platform/api/client";
import { buildAccountLoginUrlForCurrentRoute } from "@/platform/runtime/config";

export function ConversationPage() {
	const { conversationId } = useParams({ from: "/c/$conversationId" });
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [conversation, setConversation] = useState<ConversationDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [lifecycleEvents, setLifecycleEvents] = useState<ChatRequestStreamEvent[]>([]);
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
					window.location.href = buildAccountLoginUrlForCurrentRoute();
					return;
				}
				setError(reason instanceof Error ? reason.message : "会话加载失败。");
			});
	}, [conversationId]);

	async function handleSubmit(prompt: string) {
		setSubmitting(true);
		setLifecycleEvents([]);
		setError(null);
		try {
			for await (const event of submitChatRequestStream({ conversationId, prompt })) {
				setLifecycleEvents((current) => [...current, event]);
				if (event.event === "request.completed" && event.data.answer) {
					const answer = event.data.answer;
					const assistantMessage = buildAssistantMessageFromCompletedAnswer(event);
					setConversation(
						assistantMessage && answer.conversation.messages.length === 0
							? {
									...answer.conversation,
									messages: [
										...((conversation?.messages ?? []) as ConversationDetail["messages"]),
										assistantMessage,
									],
								}
							: answer.conversation,
					);
				}
				if (event.event === "request.failed") {
					setError(event.data.error?.message ?? "请求失败。");
				}
				if (event.event === "request.cancelled") {
					setError("请求已取消。");
				}
			}
		} catch (reason) {
			if (reason instanceof UnauthorizedError) {
				window.location.href = buildAccountLoginUrlForCurrentRoute();
				return;
			}
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
						<LifecycleStatus events={lifecycleEvents} />
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

function LifecycleStatus({ events }: { events: ChatRequestStreamEvent[] }) {
	if (events.length === 0) {
		return null;
	}

	return (
		<div className="mb-4 flex flex-wrap gap-2" role="status">
			{events.map((event) => (
				<span
					className="rounded-full border border-border bg-white px-3 py-1 text-xs text-[var(--sys-text-muted)]"
					key={`${event.event}:${event.data.requestId}:${event.data.occurredAt}`}
				>
					{getLifecycleLabel(event.event)}
				</span>
			))}
		</div>
	);
}
