import {
	ActionGroup,
	Button,
	cn,
	Disclosure,
	DisclosureSummary,
	StateMessage,
} from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { ChatAnswerBody, ChatAnswerSources } from "./chat-answer-content";
import { feedbackReasonLabels, feedbackVoteLabel } from "./chat-feedback-query";
import { formatTimestamp } from "./format";
import { fetchChatConversation } from "./ops-api/chat-conversations";
import { OpsApiError } from "./ops-api/core";
import { CopyableValue, ErrorState, PageHeader, StaleDataWarning } from "./ops-display";
import { normalizeRequestListReturnPath } from "./ops-view-helpers";
import { FilterSelect } from "./ui/filter-select";

function focusMessage(id: string) {
	const element = document.getElementById(`chat-message-${id}`);
	element?.focus({ preventScroll: true });
	element?.scrollIntoView?.({ block: "center" });
}

export function ChatConversationPage({
	conversationId,
	messageId,
	from,
	inline = false,
}: {
	inline?: boolean;
	conversationId: string;
	messageId?: string | undefined;
	from?: string | undefined;
}) {
	const jumpTarget = useRef<string | null>(null);
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
	const returnPath = normalizeRequestListReturnPath(from ?? "/conversations");
	const backLabel = returnPath.startsWith("/chat-feedback")
		? "返回回答反馈"
		: returnPath.startsWith("/requests/")
			? "返回执行详情"
			: returnPath.startsWith("/conversations")
				? "返回历史会话"
				: "返回运行记录";
	const targetExists = data?.messages.some((message) => message.id === messageId);
	const turns = groupConversationTurns(data?.messages ?? []);
	return (
		<section className="mx-auto w-full min-w-0 max-w-4xl">
			{inline ? null : (
				<Button asChild variant="ghost" className="mb-3">
					<Link to={returnPath}>
						<ArrowLeft className="size-4" />
						{backLabel}
					</Link>
				</Button>
			)}
			<PageHeader
				headingLevel={inline ? 2 : 1}
				title={data?.title || "会话详情"}
				description={data ? `${turns.length} 轮问答 · 消息时间为北京时间` : "读取会话内容"}
				actions={
					<ActionGroup>
						{inline ? (
							<Button asChild variant="ghost" size="icon" aria-label="独立打开会话">
								<Link
									to="/conversations/$conversationId"
									params={{ conversationId }}
									search={{ from: href, ...(messageId ? { messageId } : {}) }}
								>
									<ExternalLink className="size-4" />
								</Link>
							</Button>
						) : null}
						{messageId && targetExists ? (
							<Button variant="ghost" onClick={() => focusMessage(messageId)}>
								回到定位消息
							</Button>
						) : null}
						<Button
							variant="ghost"
							disabled={detail.isFetching}
							aria-busy={detail.isFetching}
							onClick={() => void detail.refetch()}
						>
							<RefreshCw className="size-4" />
							{detail.isFetching ? "刷新中" : "刷新"}
						</Button>
					</ActionGroup>
				}
			/>
			{unavailable ? (
				<StateMessage layout="inline" role="status" description={<> 该会话已删除或不存在。 </>} />
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
						<StateMessage
							layout="inline"
							role="status"
							className="mb-4"
							description={<>定位的消息已不可用，以下为当前保存的会话内容。</>}
						/>
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
								查看执行详情
							</Link>
						</p>
					) : null}
					<Disclosure className="mb-5 text-sm">
						<DisclosureSummary>会话信息</DisclosureSummary>
						<div className="grid gap-2 pt-3 sm:grid-cols-2">
							<CopyableValue label="会话 ID" value={data.id} />
							<p>创建于 {formatTimestamp(data.createdAt)}</p>
							<p>更新于 {formatTimestamp(data.updatedAt)}</p>
						</div>
					</Disclosure>
					{data.messages.length === 0 ? (
						<StateMessage
							layout="inline"
							role="status"
							description={<> 此会话尚无已保存的消息。 </>}
						/>
					) : (
						<div className="border-t border-border">
							{turns.length > 1 ? (
								<nav
									aria-label="会话轮次"
									className="mb-2 flex flex-wrap items-center gap-2 border-b border-border py-3"
								>
									<div className="min-w-0 flex-1 basis-40">
										<FilterSelect
											aria-label="定位轮次"
											value=""
											onCloseAutoFocus={(event) => {
												if (jumpTarget.current) {
													event.preventDefault();
													focusMessage(jumpTarget.current);
													jumpTarget.current = null;
												}
											}}
											onValueChange={(value) => {
												if (value) {
													jumpTarget.current = value;
													focusMessage(value);
												}
											}}
											options={[
												{ value: "", label: `定位轮次（共 ${turns.length} 轮）` },
												...turns.map((turn, index) => ({
													value: turn.id,
													label: `第 ${index + 1} 轮 · ${turn.messages[0]?.text.slice(0, 40) ?? ""}`,
												})),
											]}
										/>
									</div>
									<Button
										variant="ghost"
										size="icon"
										aria-label="跳到第一轮"
										onClick={() => focusMessage(turns[0]?.id ?? "")}
									>
										<ArrowUp className="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label="跳到最新一轮"
										onClick={() => focusMessage(turns.at(-1)?.id ?? "")}
									>
										<ArrowDown className="size-4" />
									</Button>
								</nav>
							) : null}
							{turns.map((turn, index) => (
								<ConversationTurn
									key={turn.id}
									turn={turn}
									index={index}
									messageId={messageId}
									href={href}
									returnPath={from ? returnPath : undefined}
									headingLevel={inline ? 3 : 2}
								/>
							))}
						</div>
					)}
				</>
			) : detail.isError ? (
				<ErrorState
					title="会话读取失败"
					error={detail.error}
					onRetry={() => void detail.refetch()}
				/>
			) : (
				<StateMessage layout="inline" role="status" description={<> 正在读取会话… </>} />
			)}
		</section>
	);
}

type ConversationMessage = Awaited<ReturnType<typeof fetchChatConversation>>["messages"][number];
interface Turn {
	id: string;
	messages: ConversationMessage[];
}

export function groupConversationTurns(messages: ConversationMessage[]): Turn[] {
	const turns: Turn[] = [];
	const byQuestion = new Map<string, Turn>();
	const byRequest = new Map<string, Turn>();
	for (const message of messages) {
		if (message.role !== "user") {
			continue;
		}
		const turn = { id: message.id, messages: [message] };
		byQuestion.set(message.id, turn);
		if (message.requestId) {
			byRequest.set(message.requestId, turn);
		}
	}
	for (const message of messages) {
		if (message.role === "user") {
			const turn = byQuestion.get(message.id);
			if (turn && !turns.includes(turn)) {
				turns.push(turn);
			}
			continue;
		}
		const turn =
			(message.parentMessageId ? byQuestion.get(message.parentMessageId) : undefined) ??
			(message.requestId ? byRequest.get(message.requestId) : undefined);
		if (turn) {
			turn.messages.push(message);
			if (!turns.includes(turn)) {
				turns.push(turn);
			}
		} else {
			turns.push({ id: message.id, messages: [message] });
		}
	}
	return turns;
}

function ConversationTurn({
	turn,
	index,
	messageId,
	href,
	returnPath,
	headingLevel,
}: {
	headingLevel: 2 | 3;
	turn: Turn;
	index: number;
	messageId: string | undefined;
	href: string;
	returnPath: string | undefined;
}) {
	const Heading = headingLevel === 3 ? "h3" : "h2";
	const first = turn.messages[0];
	const requests = new Map<string, ConversationMessage>();
	for (const message of turn.messages) {
		if (message.requestId) {
			requests.set(message.requestId, message);
		}
	}
	return (
		<section className="ops-turn" aria-label={`第 ${index + 1} 轮问答`}>
			<div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
				<Heading className="font-semibold text-foreground">第 {index + 1} 轮</Heading>
				{first ? <time dateTime={first.createdAt}>{formatTimestamp(first.createdAt)}</time> : null}
			</div>
			<div className="grid gap-4">
				{turn.messages.map((message) => (
					<article
						key={message.id}
						id={`chat-message-${message.id}`}
						tabIndex={-1}
						aria-label={`${message.role === "user" ? "用户问题" : "助手回答"}${message.id === messageId ? "，当前定位" : ""}`}
						className={cn(
							"ops-turn-message min-w-0 rounded-lg p-3 outline-offset-4 sm:p-4",
							message.role === "user" && "bg-secondary",
							message.id === messageId && "border-l-2 border-info pl-3",
						)}
					>
						<p className="mb-2 text-xs font-medium text-muted-foreground">
							{message.role === "user" ? "用户" : "助手"}
						</p>
						<div className="min-w-0">
							{message.id === messageId ? (
								<p className="mb-2 text-xs font-medium text-info">当前定位</p>
							) : null}
							{message.role === "user" ? (
								<p className="whitespace-pre-wrap break-words font-medium leading-7">
									{message.text}
								</p>
							) : (
								<ChatAnswerBody
									text={message.text}
									sources={message.sources}
									kind={message.kind === "error" ? "error" : "answer"}
								/>
							)}
							{message.feedback ? (
								<p className="mt-2 text-xs text-muted-foreground">
									{feedbackVoteLabel(message.feedback.vote)}
									{message.feedback.reasonCodes.length > 0
										? ` · ${message.feedback.reasonCodes.map((reason) => feedbackReasonLabels[reason]).join("、")}`
										: ""}
								</p>
							) : null}
							{message.sources.length > 0 ? (
								<Disclosure className="mt-3 text-sm">
									<DisclosureSummary>回答来源（{message.sources.length}）</DisclosureSummary>
									<div className="pt-3">
										<ChatAnswerSources sources={message.sources} />
									</div>
								</Disclosure>
							) : null}
						</div>
					</article>
				))}
			</div>
			<div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3 text-sm sm:px-4">
				{[...requests].map(([requestId, message]) => (
					<Link
						key={requestId}
						className="inline-flex min-h-11 items-center font-medium text-info hover:underline lg:min-h-8"
						to="/requests/$requestId"
						params={{ requestId }}
						search={{
							tab: "execution",
							from: messageReturnPath(href, message.id, returnPath),
						}}
					>
						查看执行详情
					</Link>
				))}
				<Disclosure className="min-w-0 text-xs">
					<DisclosureSummary className="min-h-11 lg:min-h-8">关联标识与时间</DisclosureSummary>
					<div className="grid gap-3 pt-3">
						{[...requests.keys()].map((id) => (
							<CopyableValue key={id} compact label="请求 ID" value={id} />
						))}
						{turn.messages.map((message) => (
							<div key={message.id} className="min-w-0 border-t border-border pt-2">
								<CopyableValue
									compact
									label={`${message.role === "user" ? "用户" : "助手"}消息 ID`}
									value={message.id}
								/>
								{message.parentMessageId ? (
									<CopyableValue compact label="父消息 ID" value={message.parentMessageId} />
								) : null}
								<p className="text-muted-foreground">{formatTimestamp(message.createdAt)}</p>
							</div>
						))}
					</div>
				</Disclosure>
			</div>
		</section>
	);
}

function messageReturnPath(href: string, messageId: string, returnPath: string | undefined) {
	const url = new URL(href, "https://ops-web.local");
	url.searchParams.set("messageId", messageId);
	if (url.pathname !== "/conversations" && returnPath) {
		url.searchParams.set("from", returnPath);
	}
	return `${url.pathname}${url.search}`;
}
