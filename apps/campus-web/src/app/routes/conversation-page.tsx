import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/conversation/chat-composer";
import { MessageList } from "@/components/conversation/message-list";
import { QAShell } from "@/components/conversation/qa-shell";
import { ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import {
	cancelRun,
	deleteMessageFeedback,
	deleteTrailingMessages,
	getConversationDetail,
	listConversations,
	resumeRunEventsStream,
	submitChatRequestStream,
	submitMessageFeedback,
} from "@/features/conversation/api";
import type {
	ChatMessage,
	ChatRequestStreamEvent,
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
	markConversationRequestStopped,
} from "@/features/conversation/view-state";
import { UnauthorizedError } from "@/platform/api/client";
import { buildAccountLoginUrlForCurrentRoute } from "@/platform/runtime/config";

export function ConversationPage() {
	const { conversationId } = useParams({ from: "/c/$conversationId" });
	const navigate = useNavigate();
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [viewState, setViewState] = useState<ConversationViewState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loginRequested, setLoginRequested] = useState(false);
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
		try {
			await submitPrompt(prompt, conversation);
		} catch (reason) {
			if (reason instanceof UnauthorizedError) {
				setLoginRequested((current) => !current);
				return;
			}
			setError("消息暂时没有发出，请稍后再试。");
		} finally {
			setSubmitting(false);
		}
	}

	async function handleStopGeneration() {
		const runId = viewState?.activeRequest?.runId;
		if (!runId) {
			return;
		}
		try {
			await cancelRun(runId);
			setViewState((current) => (current ? markConversationRequestStopped(current) : current));
		} catch {
			setError("停止生成没有完成。");
		}
	}

	async function handleEditUserMessage(message: ChatMessage, nextText: string) {
		if (!conversation || submitting) {
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			await deleteTrailingMessages({
				conversationId,
				messageId: message.id,
			});
			setViewState((current) => {
				if (!current) {
					return current;
				}
				return {
					...current,
					conversation: {
						...current.conversation,
						messages: current.conversation.messages.filter(
							(currentMessage) =>
								Date.parse(currentMessage.createdAt) < Date.parse(message.createdAt),
						),
					},
				};
			});
			await submitPrompt(nextText, {
				...conversation,
				messages: conversation.messages.filter(
					(currentMessage) => Date.parse(currentMessage.createdAt) < Date.parse(message.createdAt),
				),
			});
		} catch (reason) {
			if (reason instanceof UnauthorizedError) {
				setLoginRequested((current) => !current);
				return;
			}
			setError("消息暂时没有重新发送。");
		} finally {
			setSubmitting(false);
		}
	}

	async function submitPrompt(prompt: string, baseConversation?: ConversationDetail) {
		const currentConversation = baseConversation ?? viewState?.conversation;
		if (!currentConversation) {
			return;
		}
		const requestKey = `local_${Date.now().toString(36)}`;
		let resumeCursor: { runId: string; sequence: number } | null = null;
		setViewState(
			beginConversationRequest({
				conversation: currentConversation,
				createdAt: new Date().toISOString(),
				prompt,
				requestKey,
			}),
		);
		try {
			for await (const event of submitChatRequestStream({ conversationId, prompt })) {
				resumeCursor = updateResumeCursor(resumeCursor, event);
				await applyStreamEventToConversation(event);
			}
		} catch (reason) {
			if (!resumeCursor?.runId) {
				throw reason;
			}
			for await (const event of resumeRunEventsStream({
				afterSequence: resumeCursor.sequence,
				runId: resumeCursor.runId,
			})) {
				resumeCursor = updateResumeCursor(resumeCursor, event);
				await applyStreamEventToConversation(event);
			}
		}
	}

	async function applyStreamEventToConversation(event: ChatRequestStreamEvent) {
		setViewState((current) => (current ? applyConversationStreamEvent(current, event) : current));
		if (event.event === "request.completed") {
			if (event.data.answer) {
				upsertConversationSummary(event.data.answer.conversation);
				return;
			}
			const detail = await getConversationDetail(conversationId);
			setViewState(createConversationViewState(detail));
			upsertConversationSummary(detail);
		}
		if (event.event === "request.failed") {
			setError("回答暂时没有生成，请稍后再试。");
		}
		if (event.event === "request.cancelled") {
			setError("请求已取消。");
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
				setLoginRequested((current) => !current);
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
				setLoginRequested((current) => !current);
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
				archivedAt: detail.archivedAt,
				createdAt: detail.createdAt,
				id: detail.id,
				pinnedAt: detail.pinnedAt,
				title: detail.title,
				updatedAt: detail.updatedAt,
			};
			const withoutCurrent = current.filter((item) => item.id !== detail.id);
			return [summary, ...withoutCurrent];
		});
	}

	function handleConversationUpdated(summary: ConversationSummary) {
		setConversations((current) => upsertSummary(current, summary));
		if (summary.id === conversationId) {
			setViewState((current) =>
				current
					? {
							...current,
							conversation: {
								...current.conversation,
								...summary,
							},
						}
					: current,
			);
		}
	}

	function handleConversationRemoved(removedConversationId: string) {
		setConversations((current) => current.filter((item) => item.id !== removedConversationId));
		if (removedConversationId === conversationId) {
			void navigate({ to: "/" });
		}
	}

	return (
		<QAShell
			activeConversationId={conversationId}
			conversations={conversations}
			loginRequested={loginRequested}
			onConversationArchived={handleConversationRemoved}
			onConversationDeleted={handleConversationRemoved}
			onConversationUpdated={handleConversationUpdated}
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
								onEditUserMessage={handleEditUserMessage}
								onRetryMessage={handleRetryMessage}
								onStopGeneration={handleStopGeneration}
								onSubmitFeedback={handleFeedback}
								stoppableRequestId={viewState?.activeRequest?.requestId}
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

function upsertSummary(
	conversations: ConversationSummary[],
	summary: ConversationSummary,
): ConversationSummary[] {
	const withoutCurrent = conversations.filter((item) => item.id !== summary.id);
	return [summary, ...withoutCurrent];
}

function updateResumeCursor(
	current: { runId: string; sequence: number } | null,
	event: ChatRequestStreamEvent,
): { runId: string; sequence: number } | null {
	const runId = event.data.runId ?? current?.runId;
	if (!runId) {
		return current;
	}
	return {
		runId,
		sequence: event.data.sequence ?? current?.sequence ?? 0,
	};
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
