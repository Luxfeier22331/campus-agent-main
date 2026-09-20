import {
	ActionGroup,
	Badge,
	Button,
	Input,
	NativeSelect,
	Skeleton,
	StateMessage,
} from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { ChatFeedbackDetailDialog } from "./chat-feedback-detail";
import {
	buildChatFeedbackQuery,
	type ChatFeedbackSearch,
	feedbackVoteLabel,
} from "./chat-feedback-query";
import { formatTimestamp } from "./format";
import { fetchChatFeedback } from "./ops-api/chat-feedback";
import { ErrorState, InlineError, PageHeader } from "./ops-display";
import { DataTable } from "./ui/data-table";

export function ChatFeedbackPage({ search }: { search: ChatFeedbackSearch }) {
	const navigate = useNavigate({ from: "/chat-feedback" });
	const href = useRouterState({ select: (state) => state.location.href });
	const [draft, setDraft] = useState(search);
	const [formError, setFormError] = useState<string | null>(null);
	const detailId = search.feedbackId ?? null;
	const detailTrigger = useRef<string | null>(null);
	useEffect(() => {
		setDraft(search);
		setFormError(null);
	}, [search]);
	const parsed = buildChatFeedbackQuery(search);
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
	const setSearch = (next: ChatFeedbackSearch) => void navigate({ search: next });
	const error = formError ?? ("error" in parsed ? parsed.error : null);
	return (
		<section className="min-w-0">
			<PageHeader
				title="回答反馈"
				description="查看当前反馈及对应问答。时间均为北京时间。"
				actions={
					<Button
						variant="outline"
						disabled={page.isFetching || "error" in parsed}
						onClick={() => void page.refetch()}
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
			/>
			<form
				className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[auto_auto_auto_minmax(12rem,1fr)_auto] xl:items-end"
				onSubmit={(event) => {
					event.preventDefault();
					const next = {
						vote: draft.vote || undefined,
						startDate: draft.startDate || undefined,
						endDate: draft.endDate || undefined,
						requestId: draft.requestId?.trim() || undefined,
					};
					const result = buildChatFeedbackQuery(next);
					if ("error" in result) {
						setFormError(result.error);
						return;
					}
					setFormError(null);
					setSearch(next);
				}}
			>
				<label className="grid min-w-0 gap-1 text-sm" htmlFor="feedback-vote">
					评价类型
					<NativeSelect
						id="feedback-vote"
						value={draft.vote ?? ""}
						onChange={(event) => setDraft({ ...draft, vote: event.target.value })}
					>
						<option value="">全部评价</option>
						<option value="helpful">有帮助</option>
						<option value="unhelpful">没有帮助</option>
					</NativeSelect>
				</label>
				<label className="grid min-w-0 gap-1 text-sm" htmlFor="feedback-startDate">
					开始日期
					<Input
						id="feedback-startDate"
						type="date"
						value={draft.startDate ?? ""}
						onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
					/>
				</label>
				<label className="grid min-w-0 gap-1 text-sm" htmlFor="feedback-endDate">
					结束日期
					<Input
						id="feedback-endDate"
						type="date"
						value={draft.endDate ?? ""}
						onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
					/>
				</label>
				<label className="grid min-w-0 gap-1 text-sm" htmlFor="feedback-requestId">
					请求 ID
					<Input
						id="feedback-requestId"
						placeholder="精确匹配请求 ID"
						maxLength={200}
						value={draft.requestId ?? ""}
						onChange={(event) => setDraft({ ...draft, requestId: event.target.value })}
					/>
				</label>
				<ActionGroup>
					<Button type="submit">查询</Button>
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							setDraft({});
							setFormError(null);
							setSearch({});
						}}
					>
						清除筛选
					</Button>
				</ActionGroup>
			</form>
			{error ? (
				<StateMessage
					layout="inline"
					role="alert"
					tone="danger"
					className="mb-4"
					description={error}
				/>
			) : null}
			{"query" in parsed ? (
				page.data ? (
					<>
						{page.isError ? (
							<div className="mb-3">
								<InlineError error={page.error} title="刷新失败，当前显示上次读取结果" />
								<Button variant="ghost" onClick={() => void page.refetch()}>
									重试刷新
								</Button>
							</div>
						) : null}
						<p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
							匹配反馈 {page.data.counts.total} 条 · 有帮助 {page.data.counts.helpful} 条 · 没有帮助{" "}
							{page.data.counts.unhelpful} 条
						</p>
						<DataTable
							busy={page.isFetching}
							caption="回答反馈列表"
							minWidth="0"
							rowKey={(row) => row.feedbackId}
							data={page.data.items}
							emptyMessage="没有符合条件的反馈。"
							columns={[
								{
									header: "问答",
									rowHeader: true,
									cell: (row) => (
										<div className="min-w-0 space-y-2 break-words [overflow-wrap:anywhere]">
											<Badge>{feedbackVoteLabel(row.vote)}</Badge>
											<p className="line-clamp-2 font-medium">
												{row.questionPreview ?? "原问题不可用"}
											</p>
											<p className="line-clamp-2 font-normal text-sm text-muted-foreground">
												{row.answerPreview}
											</p>
											<p className="font-normal text-xs text-muted-foreground sm:hidden">
												{formatTimestamp(row.updatedAt)}
											</p>
										</div>
									),
								},
								{
									header: "最近反馈时间",
									cellClassName: "hidden sm:table-cell whitespace-nowrap",
									headerClassName: "hidden sm:table-cell",
									cell: (row) => formatTimestamp(row.updatedAt),
								},
								{
									header: "操作",
									cellClassName: "w-20",
									cell: (row) => (
										<Button
											variant="outline"
											id={`feedback-open-${row.feedbackId}`}
											aria-label={`查看反馈：${row.questionPreview ?? "原问题不可用"}`}
											onClick={() => {
												detailTrigger.current = row.feedbackId;
												setSearch({ ...search, feedbackId: row.feedbackId });
											}}
										>
											查看
										</Button>
									),
								},
							]}
						/>
						<ActionGroup className="mt-4 justify-end">
							<Button
								variant="outline"
								disabled={history.length === 0 || page.isFetching}
								onClick={() =>
									setSearch({
										...search,
										feedbackId: undefined,
										cursor: history.at(-1) || undefined,
										history: encodeCursorHistory(history.slice(0, -1)),
									})
								}
							>
								<ChevronLeft className="size-4" />
								上一页
							</Button>
							<Button
								variant="outline"
								disabled={!page.data.nextCursor || page.isFetching}
								onClick={() =>
									setSearch({
										...search,
										feedbackId: undefined,
										cursor: page.data?.nextCursor ?? undefined,
										history: encodeCursorHistory([...history, search.cursor ?? ""]),
									})
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
			<ChatFeedbackDetailDialog
				restoreFocus={() =>
					(
						document.getElementById(`feedback-open-${detailTrigger.current}`) ??
						document.getElementById("feedback-vote")
					)?.focus()
				}
				feedbackId={detailId}
				returnPath={href}
				onClose={() => {
					detailTrigger.current = detailId;
					setSearch({ ...search, feedbackId: undefined });
				}}
			/>
		</section>
	);
}
