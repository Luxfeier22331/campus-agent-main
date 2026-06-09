import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/conversation/chat-composer";
import { MessageList } from "@/components/conversation/message-list";
import { QAShell } from "@/components/conversation/qa-shell";
import { ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import {
	deleteMessageFeedback,
	getConversationDetail,
	listConversations,
	submitChatRequestStream,
	submitMessageFeedback,
} from "@/features/conversation/api";
import type {
	ChatMessage,
	ConversationDetail,
	ConversationSummary,
	MessageFeedbackReasonCode,
	MessageFeedbackVote,
} from "@/features/conversation/model";
import {
	applyConversationStreamEvent,
	beginConversationRequest,
	type ConversationStatusHistoryItem,
	type ConversationViewState,
	createConversationViewState,
} from "@/features/conversation/view-state";
import { UnauthorizedError } from "@/platform/api/client";
import { buildAccountLoginUrlForCurrentRoute } from "@/platform/runtime/config";

export function ConversationPage() {
	const { conversationId } = useParams({ from: "/c/$conversationId" });
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [viewState, setViewState] = useState<ConversationViewState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const conversation = viewState?.conversation ?? null;

	useEffect(() => {
		Promise.all([listConversations(), getConversationDetail(conversationId)])
			.then(([summaries, detail]) => {
				setConversations(summaries);
				setViewState(createConversationViewState(detail));
				setError(null);
			})
			.catch((reason: unknown) => {
				if (reason instanceof UnauthorizedError) {
					window.location.href = buildAccountLoginUrlForCurrentRoute();
					return;
				}
				setError("暂时无法打开这个会话。");
			});
	}, [conversationId]);

	async function handleSubmit(prompt: string) {
		if (!conversation) {
			return;
		}
		setSubmitting(true);
		setError(null);
		const requestKey = `local_${Date.now().toString(36)}`;
		setViewState(
			beginConversationRequest({
				conversation,
				createdAt: new Date().toISOString(),
				prompt,
				requestKey,
			}),
		);
		try {
			for await (const event of submitChatRequestStream({ conversationId, prompt })) {
				setViewState((current) =>
					current ? applyConversationStreamEvent(current, event) : current,
				);
				if (event.event === "request.completed" && event.data.answer) {
					upsertConversationSummary(event.data.answer.conversation);
				}
				if (event.event === "request.failed") {
					setError("回答暂时没有生成，请稍后再试。");
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
			setError("消息暂时没有发出，请稍后再试。");
		} finally {
			setSubmitting(false);
		}
	}

	async function handleFeedback(
		message: ChatMessage,
		vote: MessageFeedbackVote,
		reasonCodes: MessageFeedbackReasonCode[],
	) {
		try {
			const result = await submitMessageFeedback({
				conversationId: message.conversationId,
				messageId: message.id,
				reasonCodes,
				vote,
			});
			setViewState((current) =>
				current ? updateMessageFeedback(current, message.id, result.feedback) : current,
			);
		} catch (reason) {
			if (reason instanceof UnauthorizedError) {
				window.location.href = buildAccountLoginUrlForCurrentRoute();
				return;
			}
			setError("反馈暂时没有保存。");
		}
	}

	async function handleDeleteFeedback(message: ChatMessage) {
		try {
			await deleteMessageFeedback({
				conversationId: message.conversationId,
				messageId: message.id,
			});
			setViewState((current) =>
				current ? updateMessageFeedback(current, message.id, null) : current,
			);
		} catch (reason) {
			if (reason instanceof UnauthorizedError) {
				window.location.href = buildAccountLoginUrlForCurrentRoute();
				return;
			}
			setError("反馈暂时没有撤回。");
		}
	}

	function handleRetryMessage(message: ChatMessage) {
		const prompt = viewState?.activeRequest?.prompt;
		if (message.retryable && prompt) {
			void handleSubmit(prompt);
		}
	}

	function upsertConversationSummary(detail: ConversationDetail) {
		setConversations((current) => {
			const summary: ConversationSummary = {
				createdAt: detail.createdAt,
				id: detail.id,
				title: detail.title,
				updatedAt: detail.updatedAt,
			};
			const withoutCurrent = current.filter((item) => item.id !== detail.id);
			return [summary, ...withoutCurrent];
		});
	}

	return (
		<QAShell
			activeConversationId={conversationId}
			conversations={conversations}
			footerText="历史会话会显示在这里，方便继续查看之前的问题。"
			topTitle={conversation?.title ?? "会话"}
		>
			<section className="flex min-h-0 flex-1 flex-col">
				{error ? <ErrorPanel message={error} /> : null}
				{conversation ? (
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="mx-auto w-full max-w-[var(--layout-chat-content-width)] flex-1 px-5 py-8 pb-32 md:py-12">
							<MessageList
								messages={conversation.messages}
								onDeleteFeedback={handleDeleteFeedback}
								onRetryMessage={handleRetryMessage}
								onSubmitFeedback={handleFeedback}
							/>
							<ConversationStatusTrail items={viewState?.statusHistory ?? []} />
						</div>
						<div className="sticky bottom-0 z-20 border-t border-border bg-[var(--sys-bg-subtle)] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3">
							<div className="mx-auto w-full max-w-[var(--layout-chat-content-width)]">
								<ChatComposer disabled={submitting} onSubmit={handleSubmit} />
							</div>
						</div>
					</div>
				) : (
					<div className="mx-auto w-full max-w-[var(--layout-chat-content-width)] px-5 py-8">
						<LoadingPanel label="正在读取会话" />
					</div>
				)}
			</section>
		</QAShell>
	);
}

function updateMessageFeedback(
	state: ConversationViewState,
	messageId: string,
	feedback: ChatMessage["feedback"],
): ConversationViewState {
	return {
		...state,
		conversation: {
			...state.conversation,
			messages: state.conversation.messages.map((message) =>
				message.id === messageId
					? {
							...message,
							feedback,
						}
					: message,
			),
		},
	};
}

function ConversationStatusTrail({ items }: { items: ConversationStatusHistoryItem[] }) {
	if (items.length === 0) {
		return null;
	}

	return (
		<div className="mt-6 flex flex-wrap gap-2 pl-12" role="status">
			{items.map((item) => (
				<span
					className="rounded-full border border-border bg-white px-3 py-1 text-xs text-[var(--sys-text-muted)]"
					key={item.id}
				>
					{item.label}
				</span>
			))}
		</div>
	);
}
