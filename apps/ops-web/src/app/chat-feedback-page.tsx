import {
	ActionGroup,
	Badge,
	Button,
	Disclosure,
	DisclosureSummary,
	Field,
	Input,
	Skeleton,
	StateMessage,
	ToggleGroup,
	ToggleGroupItem,
} from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { ChatFeedbackDetailDialog } from "./chat-feedback-detail";
import {
	buildChatFeedbackQuery,
	type ChatFeedbackSearch,
	feedbackReasonLabels,
	feedbackVoteLabel,
} from "./chat-feedback-query";
import { formatTimestamp } from "./format";
import { fetchChatFeedback } from "./ops-api/chat-feedback";
import { ErrorState, PageHeader, StaleDataWarning } from "./ops-display";
import { TimeRangeFilter, TimeRangeSummary } from "./ui/time-window-select";

const desktopQuery = "(min-width: 1280px)";
function subscribeDesktop(callback: () => void) {
	const media = window.matchMedia?.(desktopQuery);
	media?.addEventListener("change", callback);
	return () => media?.removeEventListener("change", callback);
}
const isDesktop = () => window.matchMedia?.(desktopQuery).matches ?? false;

export function ChatFeedbackPage({ search }: { search: ChatFeedbackSearch }) {
	const navigate = useNavigate({ from: "/chat-feedback" });
	const href = useRouterState({ select: (state) => state.location.href });
	const wide = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
	const [requestDraft, setRequestDraft] = useState(search.requestId ?? "");
	useEffect(() => {
		setRequestDraft(search.requestId ?? "");
	}, [search.requestId]);
	const detailId = search.feedbackId ?? null;
	const detailTrigger = useRef<string | null>(null);
	const { window: timeWindow, from, to, startDate, endDate, vote, requestId, cursor } = search;
	const parsed = useMemo(
		() =>
			buildChatFeedbackQuery({
				window: timeWindow,
				from,
				to,
				startDate,
				endDate,
				vote,
				requestId,
				cursor,
			}),
		[timeWindow, from, to, startDate, endDate, vote, requestId, cursor],
	);
	const page = useQuery({
		queryKey: ["ops", "chat-feedback", "list", "query" in parsed ? parsed.query : search],
		enabled: "query" in parsed,
		queryFn: ({ signal }) => {
			if (!("query" in parsed)) {
				throw new Error(parsed.error);
			}
			return fetchChatFeedback(parsed.query, signal);
		},
	});
	const history = decodeCursorHistory(search.history);
	const setSearch = (next: ChatFeedbackSearch, resetScroll = false) =>
		void navigate({ search: next, resetScroll });
	const apply = (next: ChatFeedbackSearch) =>
		setSearch({ ...next, feedbackId: undefined, cursor: undefined, history: undefined });
	const counts = page.data?.counts;
	const selectedCount =
		search.vote === "helpful"
			? counts?.helpful
			: search.vote === "unhelpful"
				? counts?.unhelpful
				: counts?.total;
	const items = page.data?.items ?? [];
	const selectedIndex = items.findIndex((row) => row.feedbackId === detailId);
	const select = (id: string) => {
		detailTrigger.current = id;
		setSearch({ ...search, feedbackId: id });
	};
	const detail = (
		<ChatFeedbackDetailDialog
			inline={wide}
			restoreFocus={() =>
				(
					document.getElementById(`feedback-open-${detailTrigger.current}`) ??
					document.getElementById("feedback-all")
				)?.focus({ preventScroll: true })
			}
			feedbackId={detailId}
			returnPath={href}
			navigation={
				<ActionGroup className="mb-4" aria-label="当前页反馈导航">
					<Button
						variant="ghost"
						disabled={selectedIndex <= 0 || page.isFetching}
						onClick={() => {
							const row = items[selectedIndex - 1];
							if (row) {
								select(row.feedbackId);
							}
						}}
					>
						上一条
					</Button>
					<span className="text-xs text-muted-foreground">
						{selectedIndex >= 0 ? `本页 ${selectedIndex + 1} / ${items.length}` : "当前反馈"}
					</span>
					<Button
						variant="ghost"
						disabled={selectedIndex < 0 || selectedIndex >= items.length - 1 || page.isFetching}
						onClick={() => {
							const row = items[selectedIndex + 1];
							if (row) {
								select(row.feedbackId);
							}
						}}
					>
						下一条
					</Button>
				</ActionGroup>
			}
			onClose={() => {
				detailTrigger.current = detailId;
				setSearch({ ...search, feedbackId: undefined });
			}}
		/>
	);
	return (
		<section className="min-w-0">
			<PageHeader
				title="回答反馈"
				description="从用户评价查看对应问答，再进入会话或执行详情。"
				actions={
					<Button
						variant="ghost"
						disabled={page.isFetching || "error" in parsed}
						onClick={() => void page.refetch()}
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
			/>
			<div className="ops-filter-bar mb-4 flex flex-wrap items-start gap-4">
				<TimeRangeFilter
					search={
						search.startDate || search.endDate
							? {
									from: "query" in parsed ? parsed.query.from : undefined,
									to: "query" in parsed ? parsed.query.to : undefined,
								}
							: search
					}
					scope="overview"
					label="反馈更新时间"
					allowAll
					onChange={(time) => {
						const {
							window: _window,
							from: _from,
							to: _to,
							startDate: _start,
							endDate: _end,
							...rest
						} = search;
						apply({ ...rest, ...time });
					}}
				/>
				<Disclosure className="min-w-0 flex-1" open={Boolean(search.requestId)}>
					<DisclosureSummary>更多筛选</DisclosureSummary>
					<form
						className="mt-3 flex flex-wrap items-end gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							apply({ ...search, requestId: requestDraft.trim() || undefined });
						}}
					>
						<Field label="请求 ID">
							<Input
								id="feedback-requestId"
								placeholder="精确匹配请求 ID"
								maxLength={200}
								value={requestDraft}
								onChange={(event) => setRequestDraft(event.target.value)}
							/>
						</Field>
						<Button type="submit">查询</Button>
					</form>
				</Disclosure>
				<Button
					variant="ghost"
					onClick={() => {
						setRequestDraft("");
						apply({});
					}}
				>
					清除筛选
				</Button>
			</div>
			{"error" in parsed ? (
				<StateMessage layout="inline" role="alert" tone="danger" description={parsed.error} />
			) : (
				<TimeRangeSummary
					filters={{ from: parsed.query.from ?? null, to: parsed.query.to ?? null }}
				/>
			)}
			<ToggleGroup
				type="single"
				presentation="segmented"
				aria-label="评价类型"
				className="mb-4 flex-wrap justify-start"
				value={search.vote || "all"}
				onValueChange={(vote) => {
					if (vote && vote !== (search.vote || "all")) {
						apply({ ...search, vote: vote === "all" ? undefined : vote });
					}
				}}
			>
				<ToggleGroupItem className="min-h-11 px-3" id="feedback-all" value="all">
					全部 {counts?.total ?? "—"}
				</ToggleGroupItem>
				<ToggleGroupItem className="min-h-11 px-3" value="unhelpful">
					没有帮助 {counts?.unhelpful ?? "—"}
				</ToggleGroupItem>
				<ToggleGroupItem className="min-h-11 px-3" value="helpful">
					有帮助 {counts?.helpful ?? "—"}
				</ToggleGroupItem>
			</ToggleGroup>
			<div
				className={
					wide && detailId
						? "grid min-w-0 items-start gap-6 grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]"
						: "min-w-0"
				}
			>
				<div className="min-w-0">
					{"query" in parsed ? (
						page.data ? (
							<>
								{page.isError ? (
									<StaleDataWarning
										error={page.error}
										lastSuccessfulAt={page.dataUpdatedAt}
										onRetry={() => void page.refetch()}
										title="回答反馈刷新失败"
									/>
								) : null}
								<p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
									匹配反馈 {selectedCount} 条 · 当前页 {items.length} 条
								</p>
								{items.length > 0 ? (
									<div aria-busy={page.isFetching} className="divide-y border-y">
										{items.map((row) => (
											<button
												type="button"
												key={row.feedbackId}
												id={`feedback-open-${row.feedbackId}`}
												aria-label={`查看反馈：${row.questionPreview ?? "原问题不可用"}`}
												aria-pressed={detailId === row.feedbackId}
												onClick={() => select(row.feedbackId)}
												className="block w-full min-w-0 space-y-2 px-3 py-4 text-left transition-colors hover:bg-surface-hover aria-pressed:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [overflow-wrap:anywhere]"
											>
												<div className="flex flex-wrap items-center gap-2">
													<Badge>{feedbackVoteLabel(row.vote)}</Badge>
													<span className="text-xs text-muted-foreground">
														{row.reasonCodes
															.map((reason) => feedbackReasonLabels[reason])
															.join("、") || "未提供原因"}
													</span>
												</div>
												<p className="line-clamp-2 font-medium">
													{row.questionPreview ?? "原问题不可用"}
												</p>
												<p className="line-clamp-2 text-sm text-muted-foreground">
													{row.answerPreview}
												</p>
												<p className="text-xs text-muted-foreground">
													{formatTimestamp(row.updatedAt)}
												</p>
											</button>
										))}
									</div>
								) : (
									<StateMessage description="没有符合条件的反馈。" />
								)}
								<ActionGroup className="mt-4 justify-end">
									<Button
										variant="ghost"
										disabled={history.length === 0 || page.isFetching}
										onClick={() =>
											setSearch(
												{
													...search,
													feedbackId: undefined,
													cursor: history.at(-1) || undefined,
													history: encodeCursorHistory(history.slice(0, -1)),
												},
												true,
											)
										}
									>
										<ChevronLeft className="size-4" />
										上一页
									</Button>
									<Button
										variant="ghost"
										disabled={!page.data.nextCursor || page.isFetching}
										onClick={() =>
											setSearch(
												{
													...search,
													feedbackId: undefined,
													cursor: page.data?.nextCursor ?? undefined,
													history: encodeCursorHistory([...history, search.cursor ?? ""]),
												},
												true,
											)
										}
									>
										下一页
										<ChevronRight className="size-4" />
									</Button>
								</ActionGroup>
							</>
						) : page.isError ? (
							<ErrorState
								error={page.error}
								title="回答反馈读取失败"
								onRetry={() => void page.refetch()}
							/>
						) : (
							<div role="status" aria-label="正在读取回答反馈" className="space-y-3">
								<Skeleton className="h-6 w-64 max-w-full" />
								<Skeleton className="h-48 w-full" />
							</div>
						)
					) : null}
				</div>
				{detail}
			</div>
		</section>
	);
}
