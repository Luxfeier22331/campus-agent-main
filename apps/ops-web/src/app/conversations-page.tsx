import { Button, Input, NativeSelect, StateMessage } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { formatId, formatTimestamp } from "./format";
import { fetchChatConversations } from "./ops-api/chat-conversations";
import { ErrorState, PageHeader, StatusBadge } from "./ops-display";
import { replaceTimeQuery, type TimeSearch, timeQueryFields } from "./time-filters";
import { TimeRangeFilter, TimeRangeSummary } from "./ui/time-window-select";

interface ConversationsFilterDraft {
	q: string;
	status: string;
	feedback: string;
	hasFailures: string;
}

function filterDraft(search: Record<string, unknown>): ConversationsFilterDraft {
	return {
		q: typeof search.q === "string" ? search.q : "",
		status: typeof search.status === "string" ? search.status : "",
		feedback: typeof search.feedback === "string" ? search.feedback : "",
		hasFailures: typeof search.hasFailures === "boolean" ? String(search.hasFailures) : "",
	};
}

function isQuestionPreviewDuplicated(title: string, preview: string | null): boolean {
	if (preview === null) {
		return false;
	}
	if (preview === title) {
		return true;
	}
	return title.endsWith("...") && preview.startsWith(title.slice(0, -3));
}

export function ConversationsPage({ search }: { search: TimeSearch & Record<string, unknown> }) {
	const navigate = useNavigate();
	const location = useLocation();
	const { q, status, feedback, hasFailures } = search;
	const [draft, setDraft] = useState(() => filterDraft(search));
	useEffect(() => {
		setDraft(filterDraft({ q, status, feedback, hasFailures }));
	}, [q, status, feedback, hasFailures]);
	const params = new URLSearchParams();
	for (const key of ["q", "cursor", "from", "to", "window", "status", "feedback"]) {
		const value = search[key];
		if (typeof value === "string" && value) {
			params.set(key, value);
		}
	}
	if (typeof search.hasFailures === "boolean") {
		params.set("hasFailures", String(search.hasFailures));
	}
	const filterParams = new URLSearchParams(params);
	filterParams.delete("cursor");
	const filterKey = filterParams.toString();
	const query = useQuery<Awaited<ReturnType<typeof fetchChatConversations>>>({
		enabled: !search.timeError,
		queryKey: ["ops", "chat-conversations", filterKey, search.cursor],
		queryFn: ({ signal }) => fetchChatConversations(params, signal),
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === filterKey ? previous : undefined,
	});
	const hasFilters =
		["q", "status", "feedback", "hasFailures", "from", "to"].some(
			(k) => search[k] !== undefined && search[k] !== "",
		) || Boolean(search.window && search.window !== "today");
	return (
		<section>
			<PageHeader
				actions={
					<Button
						aria-label="刷新历史会话"
						disabled={query.isFetching}
						onClick={() => void query.refetch()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						{query.isFetching ? "刷新中" : "刷新"}
					</Button>
				}
				description="按会话查看用户问题、助手回答和需要排查的运行。日期按北京时间计算。"
				title="历史会话"
			/>
			<form
				className="my-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_10rem_auto]"
				onSubmit={(event) => {
					event.preventDefault();
					const value = (name: keyof typeof draft) => draft[name] || undefined;
					void navigate({
						to: "/conversations",
						search: {
							q: value("q"),
							status: value("status"),
							feedback: value("feedback"),
							hasFailures:
								value("hasFailures") === undefined ? undefined : value("hasFailures") === "true",
							...timeQueryFields(search),
						},
					});
				}}
			>
				<Input
					aria-label="搜索会话"
					value={draft.q}
					onChange={(event) => setDraft((previous) => ({ ...previous, q: event.target.value }))}
					name="q"
					placeholder="搜索标题、问题、回答或 request ID"
				/>
				<NativeSelect
					aria-label="会话状态"
					value={draft.status}
					onChange={(event) =>
						setDraft((previous) => ({ ...previous, status: event.target.value }))
					}
					name="status"
				>
					<option value="">全部状态</option>
					<option value="COMPLETED">已完成</option>
					<option value="FAILED">失败</option>
					<option value="RUNNING">运行中</option>
					<option value="PENDING">待处理</option>
					<option value="ACTION_REQUIRED">需要关注</option>
					<option value="CANCELLED">已取消</option>
				</NativeSelect>
				<NativeSelect
					aria-label="反馈状态"
					value={draft.feedback}
					onChange={(event) =>
						setDraft((previous) => ({ ...previous, feedback: event.target.value }))
					}
					name="feedback"
				>
					<option value="">全部反馈</option>
					<option value="WITH_FEEDBACK">有反馈</option>
					<option value="WITHOUT_FEEDBACK">无反馈</option>
				</NativeSelect>
				<NativeSelect
					aria-label="失败筛选"
					value={draft.hasFailures}
					onChange={(event) =>
						setDraft((previous) => ({ ...previous, hasFailures: event.target.value }))
					}
					name="hasFailures"
				>
					<option value="">全部运行</option>
					<option value="true">包含失败</option>
					<option value="false">不含失败</option>
				</NativeSelect>
				<div className="sm:col-span-full">
					<TimeRangeFilter
						search={search}
						scope="conversations"
						onChange={(time) =>
							void navigate({ to: "/conversations", search: replaceTimeQuery(search, time) })
						}
					/>
				</div>
				<Button type="submit">搜索</Button>
			</form>
			{query.isPending && !search.timeError ? (
				<StateMessage layout="inline" role="status" description={<> 正在读取历史会话... </>} />
			) : null}
			{query.isError && !query.data ? (
				<ErrorState error={query.error} onRetry={() => query.refetch()} title="历史会话读取失败" />
			) : null}
			{query.data && !search.timeError ? (
				<>
					<TimeRangeSummary filters={query.data.filters} />
					<div className="mb-3 flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
						<span>当前页 {query.data?.data.length ?? 0} 个会话 · 按最近活动时间排序</span>
						{query.isFetching ? <span role="status">正在更新结果…</span> : null}
					</div>
					{query.isRefetchError ? (
						<StateMessage
							layout="inline"
							role="status"
							className="mb-3"
							description={
								<>
									刷新失败，当前显示上一次成功结果。{" "}
									<button className="underline" onClick={() => void query.refetch()} type="button">
										重试
									</button>
								</>
							}
						/>
					) : null}
					{query.data?.data.length === 0 ? (
						<div className="border-border border-y bg-secondary p-4 text-sm">
							没有匹配的历史会话。
						</div>
					) : (
						<div className="divide-y divide-border border-y">
							{query.data?.data.map((c) => (
								<article className="grid gap-2 py-4" key={c.id}>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<Link
											className="font-medium text-foreground hover:underline"
											params={{ conversationId: c.id }}
											search={{ from: location.href }}
											to="/conversations/$conversationId"
										>
											{c.title}
										</Link>
										<StatusBadge status={c.latestStatus} />
									</div>
									<div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
										<span title={c.owner.displayName ? undefined : c.owner.id}>
											用户：
											{c.owner.displayName
												? `${c.owner.displayName}${c.owner.email ? `（${c.owner.email}）` : ""}`
												: c.owner.email || formatId(c.owner.id)}
										</span>
										<span>更新于 {formatTimestamp(c.updatedAt)}</span>
									</div>
									{isQuestionPreviewDuplicated(c.title, c.latestQuestionPreview) ? null : (
										<p className="text-sm text-foreground">
											{c.latestQuestionPreview ?? "暂无用户问题"}
										</p>
									)}
									{c.latestAnswerPreview ? (
										<p className="line-clamp-2 text-sm text-muted-foreground">
											{c.latestAnswerPreview}
										</p>
									) : null}
									<div className="flex gap-3 text-xs text-muted-foreground">
										{c.hasFailures ? <span>包含失败运行</span> : null}
										{c.hasFeedback ? <span>有用户反馈</span> : null}
									</div>
								</article>
							))}
						</div>
					)}
					<div className="flex gap-3">
						{query.data?.page.nextCursor ? (
							<Link
								className="mt-4 inline-flex font-medium text-info hover:underline"
								search={{ ...search, cursor: query.data.page.nextCursor }}
								to="/conversations"
							>
								下一页
							</Link>
						) : null}
						{hasFilters ? (
							<Button
								className="mt-4"
								onClick={() => {
									setDraft(filterDraft({}));
									void navigate({ to: "/conversations", search: {} });
								}}
								variant="ghost"
							>
								清除筛选
							</Button>
						) : null}
					</div>
				</>
			) : null}
		</section>
	);
}
