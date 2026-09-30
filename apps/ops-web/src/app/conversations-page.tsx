import { Button, cn, StateMessage } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight, MessageSquare, RefreshCw } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { ChatConversationPage } from "./chat-conversation-page";
import { ConversationFilters } from "./conversation-filters";
import { formatId, formatTimestamp } from "./format";
import { fetchChatConversations } from "./ops-api/chat-conversations";
import { ErrorState, PageHeader, StaleDataWarning, StatusBadge } from "./ops-display";
import type { TimeSearch } from "./time-filters";

const desktopQuery = "(min-width: 1280px)";
function subscribeDesktop(callback: () => void) {
	const media = window.matchMedia?.(desktopQuery);
	media?.addEventListener("change", callback);
	return () => media?.removeEventListener("change", callback);
}
const isDesktop = () => window.matchMedia?.(desktopQuery).matches ?? false;

export function ConversationsPage({ search }: { search: TimeSearch & Record<string, unknown> }) {
	const navigate = useNavigate();
	const location = useLocation();
	const wide = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
	const selectedId = typeof search.conversationId === "string" ? search.conversationId : undefined;
	const messageId = typeof search.messageId === "string" ? search.messageId : undefined;
	const readerRef = useRef<HTMLElement>(null);
	const previousSelection = useRef(selectedId);
	useEffect(() => {
		if (selectedId && !wide && !messageId) {
			readerRef.current?.focus({ preventScroll: true });
		}
		if (!selectedId && previousSelection.current) {
			document
				.getElementById(`conversation-open-${previousSelection.current}`)
				?.focus({ preventScroll: true });
		}
		previousSelection.current = selectedId;
	}, [selectedId, wide, messageId]);
	const history = decodeCursorHistory(
		typeof search.history === "string" ? search.history : undefined,
	);
	const params = new URLSearchParams();
	for (const key of [
		"q",
		"ownerQuery",
		"ownerId",
		"cursor",
		"from",
		"to",
		"window",
		"status",
		"feedback",
	]) {
		const value = search[key];
		if (typeof value === "string" && value) {
			params.set(key, value);
		}
	}
	if (typeof search.hasFailures === "boolean") {
		params.set("hasFailures", String(search.hasFailures));
	}
	const query = useQuery({
		enabled: !search.timeError,
		queryKey: ["ops", "chat-conversations", "list", params.toString()],
		queryFn: ({ signal }) => fetchChatConversations(params, signal),
	});
	const rows = query.data?.data ?? [];
	const selectedIndex = rows.findIndex((row) => row.id === selectedId);
	const selected = rows[selectedIndex];
	const select = (id: string | undefined) =>
		void navigate({
			to: "/conversations",
			search: { ...search, conversationId: id, messageId: undefined },
			resetScroll: !wide,
		});
	const listSearch = { ...search, conversationId: undefined, messageId: undefined };
	const showList = wide || !selectedId;
	return (
		<section className="ops-conversations min-w-0">
			<PageHeader title="历史会话" />
			<div className="ops-conversation-workspace">
				<section aria-label="会话筛选" hidden={!showList} className="ops-conversation-search">
					<ConversationFilters search={search} filters={query.data?.filters} />
				</section>
				<section
					aria-label="会话队列"
					hidden={!showList}
					className="ops-conversation-queue"
					data-scroll-restoration-id={`conversation-queue-${params}`}
				>
					<h2 className="sr-only">会话列表</h2>
					<div className="flex items-center justify-between gap-2 px-4 py-2">
						<div className="text-xs text-muted-foreground" role="status">
							{query.isFetching
								? "正在读取会话…"
								: query.data
									? `本页 ${rows.length} 个会话 · 最近活动优先`
									: "最近活动优先"}
						</div>
						<Button
							aria-label="刷新历史会话"
							variant="ghost"
							size="sm"
							disabled={query.isFetching}
							onClick={() => void query.refetch()}
						>
							<RefreshCw className="size-4" />
							刷新
						</Button>
					</div>
					{query.isError && !query.data ? (
						<ErrorState
							error={query.error}
							onRetry={() => query.refetch()}
							title="历史会话读取失败"
						/>
					) : null}
					{query.isRefetchError && query.data ? (
						<StaleDataWarning
							error={query.error}
							lastSuccessfulAt={query.dataUpdatedAt}
							onRetry={() => void query.refetch()}
							title="历史会话刷新失败"
						/>
					) : null}
					{query.data && !search.timeError ? (
						<>
							{rows.length === 0 ? (
								<StateMessage description="没有匹配的历史会话。" />
							) : (
								<nav aria-label="会话列表" className="px-2">
									{rows.map((c) => (
										<article key={c.id}>
											<Link
												id={`conversation-open-${c.id}`}
												to="/conversations"
												search={{ ...search, conversationId: c.id, messageId: undefined }}
												resetScroll={!wide}
												aria-label={c.title}
												aria-current={selectedId === c.id ? "true" : undefined}
												className={cn(
													"ops-conversation-row",
													selectedId === c.id && "ops-conversation-row-selected",
												)}
											>
												<div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
													<span className="truncate" title={c.owner.email || c.owner.id}>
														用户：{c.owner.displayName || c.owner.email || formatId(c.owner.id)}
													</span>
													<time
														className="shrink-0"
														dateTime={c.updatedAt}
														title={`${formatTimestamp(c.updatedAt)} 北京时间`}
													>
														{formatTimestamp(c.updatedAt).slice(5, 16)}
													</time>
												</div>
												<h3 className="line-clamp-2 break-words font-medium leading-6">
													{c.title}
												</h3>
												{c.latestQuestionPreview && c.latestQuestionPreview !== c.title ? (
													<p className="line-clamp-1 break-words text-sm">
														<span className="mr-2 text-muted-foreground">问</span>
														{c.latestQuestionPreview}
													</p>
												) : null}
												<p className="line-clamp-1 break-words text-sm text-muted-foreground">
													<span className="mr-2">答</span>
													{c.latestAnswerPreview ?? "最新一轮尚无回答"}
												</p>
												<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
													<span className="sr-only">最新一轮状态：</span>
													<StatusBadge status={c.latestStatus} />
													<span>{c.turnCount} 轮</span>
													{c.hasFailures ? <span className="text-danger">包含失败</span> : null}
													{c.hasFeedback ? <span>有反馈</span> : null}
												</div>
											</Link>
										</article>
									))}
								</nav>
							)}
							<div className="flex items-center justify-between gap-2 border-t border-border p-3">
								<Button
									variant="ghost"
									disabled={history.length === 0 || query.isFetching}
									onClick={() =>
										void navigate({
											to: "/conversations",
											search: {
												...listSearch,
												cursor: history.at(-1) || undefined,
												history: encodeCursorHistory(history.slice(0, -1)),
											},
										})
									}
								>
									<ChevronLeft className="size-4" />
									上一页
								</Button>
								<Button
									variant="ghost"
									disabled={!query.data.page.nextCursor || query.isFetching}
									onClick={() =>
										void navigate({
											to: "/conversations",
											search: {
												...listSearch,
												cursor: query.data?.page.nextCursor ?? undefined,
												history: encodeCursorHistory([
													...history,
													typeof search.cursor === "string" ? search.cursor : "",
												]),
											},
										})
									}
								>
									下一页
									<ChevronRight className="size-4" />
								</Button>
							</div>
						</>
					) : null}
				</section>
				{selectedId ? (
					<section
						ref={readerRef}
						tabIndex={-1}
						aria-label="会话阅读区"
						className="ops-conversation-reader outline-none"
					>
						<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
							<Button variant="ghost" onClick={() => select(undefined)}>
								<ArrowLeft className="size-4" />
								返回历史会话
							</Button>
							<fieldset className="flex items-center gap-1" aria-label="本页会话导航">
								<Button
									size="icon"
									variant="ghost"
									aria-label="上一条会话"
									disabled={selectedIndex <= 0 || query.isFetching}
									onClick={() => select(rows[selectedIndex - 1]?.id)}
								>
									<ChevronLeft className="size-4" />
								</Button>
								<span className="text-xs text-muted-foreground">
									{selectedIndex < 0 ? "当前会话" : `${selectedIndex + 1} / ${rows.length}`}
								</span>
								<Button
									size="icon"
									variant="ghost"
									aria-label="下一条会话"
									disabled={
										selectedIndex < 0 || selectedIndex >= rows.length - 1 || query.isFetching
									}
									onClick={() => select(rows[selectedIndex + 1]?.id)}
								>
									<ChevronRight className="size-4" />
								</Button>
							</fieldset>
						</div>
						<div
							key={selectedId}
							className="ops-conversation-reading-content"
							data-scroll-restoration-id={`conversation-reader-${selectedId}`}
						>
							{selected ? (
								<div className="mb-4 flex flex-wrap items-center gap-2 break-all text-xs text-muted-foreground">
									<StatusBadge status={selected.latestStatus} />
									<span>
										{selected.owner.displayName ||
											selected.owner.email ||
											formatId(selected.owner.id)}
									</span>
									{selected.owner.displayName && selected.owner.email ? (
										<span>{selected.owner.email}</span>
									) : null}
								</div>
							) : null}
							<ChatConversationPage
								key={selectedId}
								conversationId={selectedId}
								messageId={messageId}
								inline
								from={location.href}
							/>
						</div>
					</section>
				) : wide ? (
					<div className="flex min-w-0 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
						<MessageSquare aria-hidden="true" className="size-9" />
						<h2 className="text-lg font-medium text-foreground">选择一段会话</h2>
						<p className="max-w-xs text-sm leading-6">
							在左侧找到会话，在这里阅读完整问答、用户反馈和回答来源。
						</p>
					</div>
				) : null}
			</div>
		</section>
	);
}
