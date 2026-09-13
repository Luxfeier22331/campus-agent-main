import { Button, cn, Disclosure, DisclosureSummary } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { ChatAnswerBody, ChatAnswerSources } from "./chat-answer-content";
import { feedbackTimeFormatter, feedbackVoteLabel } from "./chat-feedback-query";
import { fetchChatConversation } from "./ops-api/chat-conversations";
import { OpsApiError } from "./ops-api/core";
import { CopyableValue, ErrorState, PageHeader, StaleDataWarning } from "./ops-display";
import { normalizeRequestListReturnPath } from "./ops-view-helpers";

function focusMessage(id: string) {
	const element = document.getElementById(`chat-message-${id}`);
	element?.focus({ preventScroll: true });
	element?.scrollIntoView?.({ block: "center" });
}

export function ChatConversationPage({
	conversationId,
	messageId,
	from,
}: {
	conversationId: string;
	messageId?: string | undefined;
	from?: string | undefined;
}) {
	const href = useRouterState({ select: (state) => state.location.href });
	const detail = useQuery({
		queryKey: ["ops", "chat-conversations", conversationId],
		queryFn: ({ signal }) => fetchChatConversation(conversationId, signal),
		staleTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const unavailable = detail.error instanceof OpsApiError && detail.error.status === 404;
	const data = unavailable ? undefined : detail.data;
	useEffect(() => {
		if (data?.id && messageId) {
			focusMessage(messageId);
		}
	}, [data?.id, messageId]);
	const returnPath = normalizeRequestListReturnPath(from);
	const backLabel = returnPath.startsWith("/chat-feedback")
		? "返回回答反馈"
		: returnPath.startsWith("/requests/")
			? "返回运行详情"
			: returnPath.startsWith("/conversations")
				? "返回历史会话"
				: "返回运行诊断";
	const targetExists = data?.messages.some((message) => message.id === messageId);
	const answeredRequests = new Set(
		data?.messages
			.filter((message) => message.role === "assistant")
			.map((message) => message.requestId),
	);
	return (
		<section className="min-w-0">
			<a
				href={returnPath}
				className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
			>
				<ArrowLeft className="size-4" />
				{backLabel}
			</a>
			<PageHeader
				title={data?.title || "会话详情"}
				description="查看已保存的会话内容。消息时间为北京时间。"
				actions={
					<div className="flex flex-wrap gap-2">
						{messageId && targetExists ? (
							<Button variant="outline" onClick={() => focusMessage(messageId)}>
								回到定位消息
							</Button>
						) : null}
						<Button
							variant="outline"
							disabled={detail.isFetching}
							aria-busy={detail.isFetching}
							onClick={() => void detail.refetch()}
						>
							<RefreshCw className="size-4" />
							{detail.isFetching ? "刷新中" : "刷新"}
						</Button>
					</div>
				}
			/>
			{unavailable ? (
				<p role="status">该会话已删除或不存在。</p>
			) : data ? (
				<>
					{detail.isRefetchError ? (
						<StaleDataWarning
							title="会话刷新失败"
							error={detail.error}
							lastSuccessfulAt={detail.dataUpdatedAt}
							onRetry={() => void detail.refetch()}
						/>
					) : null}
					{messageId && !targetExists ? (
						<p role="status" className="mb-4 text-sm text-muted-foreground">
							定位的消息已不可用，以下为当前保存的会话内容。
						</p>
					) : null}
					{data.activeRequestId ? (
						<p className="mb-4 text-sm">
							会话仍有关联请求待处理。
							<Link
								className="ml-2 text-info underline"
								to="/requests/$requestId"
								params={{ requestId: data.activeRequestId }}
								search={{ from: href }}
							>
								查看运行详情
							</Link>
						</p>
					) : null}
					{data.messages.length === 0 ? (
						<p role="status">此会话尚无已保存的消息。</p>
					) : (
						<div className="max-w-3xl divide-y divide-border border-y border-border">
							{data.messages.map((message) => (
								<article
									key={message.id}
									id={`chat-message-${message.id}`}
									tabIndex={-1}
									aria-label={`${message.role === "user" ? "用户问题" : "助手回答"}${message.id === messageId ? "，当前定位" : ""}`}
									className={cn(
										"min-w-0 scroll-mt-6 py-6 outline-offset-4",
										message.id === messageId && "border-l-2 border-info pl-4",
									)}
								>
									<div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
										<h2 className="font-semibold">{message.role === "user" ? "用户" : "助手"}</h2>
										<time className="text-muted-foreground" dateTime={message.createdAt}>
											{feedbackTimeFormatter.format(new Date(message.createdAt))}
										</time>
										{message.id === messageId ? (
											<span className="font-medium text-info">当前定位</span>
										) : null}
										{message.feedback ? (
											<span>{feedbackVoteLabel(message.feedback.vote)}</span>
										) : null}
									</div>
									{message.role === "user" ? (
										<p className="whitespace-pre-wrap break-words leading-7">{message.text}</p>
									) : (
										<div className="space-y-5">
											<ChatAnswerBody
												text={message.text}
												kind={message.kind === "error" ? "error" : "answer"}
											/>
											<ChatAnswerSources sources={message.sources} />
										</div>
									)}
									{message.requestId &&
									(message.role === "assistant" || !answeredRequests.has(message.requestId)) ? (
										<Button asChild variant="outline" className="mt-4">
											<Link
												to="/requests/$requestId"
												params={{ requestId: message.requestId }}
												search={{
													from: `${href.split("?")[0]}?${new URLSearchParams({ messageId: message.id, ...(from ? { from: returnPath } : {}) })}`,
												}}
											>
												查看运行详情
											</Link>
										</Button>
									) : null}
									<Disclosure className="mt-3 text-sm">
										<DisclosureSummary>关联标识</DisclosureSummary>
										<div className="space-y-2 pt-3">
											<CopyableValue label="消息 ID" value={message.id} />
											{message.parentMessageId ? (
												<CopyableValue label="父消息 ID" value={message.parentMessageId} />
											) : null}
											{message.requestId ? (
												<CopyableValue label="请求 ID" value={message.requestId} />
											) : null}
										</div>
									</Disclosure>
								</article>
							))}
						</div>
					)}
					<Disclosure className="mt-6 text-sm">
						<DisclosureSummary>会话信息</DisclosureSummary>
						<div className="space-y-2 pt-3">
							<CopyableValue label="会话 ID" value={data.id} />
							<p>创建于 {feedbackTimeFormatter.format(new Date(data.createdAt))}</p>
							<p>更新于 {feedbackTimeFormatter.format(new Date(data.updatedAt))}</p>
						</div>
					</Disclosure>
				</>
			) : detail.isError ? (
				<ErrorState
					title="会话读取失败"
					error={detail.error}
					onRetry={() => void detail.refetch()}
				/>
			) : (
				<p role="status">正在读取会话…</p>
			)}
		</section>
	);
}
