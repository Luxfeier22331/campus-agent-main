import { Button, Input } from "@campus-agent/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { formatTimestamp } from "./format";
import { fetchChatConversations } from "./ops-api/chat-conversations";
import { ErrorState, PageHeader, PageShell, StatusBadge } from "./ops-display";

export function ConversationsPage({ search }: { search: Record<string, unknown> }) {
	const navigate = useNavigate();
	const location = useLocation();
	const params = new URLSearchParams();
	for (const key of ["q", "cursor", "from", "to", "status", "feedback"]) {
		const value = search[key];
		if (typeof value === "string" && value) {
			params.set(key, value);
		}
	}
	if (typeof search.hasFailures === "boolean") {
		params.set("hasFailures", String(search.hasFailures));
	}
	const query = useQuery({
		queryKey: ["ops", "chat-conversations", params.toString()],
		queryFn: ({ signal }) => fetchChatConversations(params, signal),
		placeholderData: keepPreviousData,
	});
	if (query.isPending && !query.data) {
		return <PageShell title="历史会话">正在读取历史会话...</PageShell>;
	}
	if (query.isError && !query.data) {
		return (
			<ErrorState error={query.error} onRetry={() => query.refetch()} title="历史会话读取失败" />
		);
	}
	const hasFilters = ["q", "status", "feedback", "hasFailures", "from", "to"].some(
		(k) => search[k] !== undefined && search[k] !== "",
	);
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
				description="按会话查看用户问题、助手回答和需要排查的运行。"
				title="历史会话"
			/>
			<form
				className="my-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_auto]"
				onSubmit={(event) => {
					event.preventDefault();
					const form = new FormData(event.currentTarget);
					const value = (n: string) => String(form.get(n) ?? "") || undefined;
					void navigate({
						to: "/conversations",
						search: {
							q: value("q"),
							status: value("status"),
							feedback: value("feedback"),
							hasFailures:
								value("hasFailures") === undefined ? undefined : value("hasFailures") === "true",
							from: (() => {
								const v = value("from");
								return v ? new Date(`${v}T00:00:00.000+08:00`).toISOString() : undefined;
							})(),
							to: (() => {
								const v = value("to");
								return v ? new Date(`${v}T23:59:59.999+08:00`).toISOString() : undefined;
							})(),
						},
					});
				}}
			>
				<Input
					aria-label="搜索会话"
					defaultValue={typeof search.q === "string" ? search.q : ""}
					name="q"
					placeholder="搜索标题、问题、回答或 request ID"
				/>
				<select
					aria-label="会话状态"
					className="rounded-md border border-input bg-background px-3"
					defaultValue={typeof search.status === "string" ? search.status : ""}
					name="status"
				>
					<option value="">全部状态</option>
					<option value="COMPLETED">已完成</option>
					<option value="FAILED">失败</option>
					<option value="RUNNING">运行中</option>
					<option value="PENDING">待处理</option>
					<option value="ACTION_REQUIRED">需要关注</option>
					<option value="CANCELLED">已取消</option>
				</select>
				<select
					aria-label="反馈状态"
					className="rounded-md border border-input bg-background px-3"
					defaultValue={typeof search.feedback === "string" ? search.feedback : ""}
					name="feedback"
				>
					<option value="">全部反馈</option>
					<option value="WITH_FEEDBACK">有反馈</option>
					<option value="WITHOUT_FEEDBACK">无反馈</option>
				</select>
				<select
					aria-label="失败筛选"
					className="rounded-md border border-input bg-background px-3"
					defaultValue={typeof search.hasFailures === "boolean" ? String(search.hasFailures) : ""}
					name="hasFailures"
				>
					<option value="">全部运行</option>
					<option value="true">包含失败</option>
					<option value="false">不含失败</option>
				</select>
				<input
					aria-label="开始日期"
					className="rounded-md border border-input bg-background px-3"
					defaultValue={typeof search.from === "string" ? search.from.slice(0, 10) : ""}
					name="from"
					type="date"
				/>
				<input
					aria-label="结束日期"
					className="rounded-md border border-input bg-background px-3"
					defaultValue={typeof search.to === "string" ? search.to.slice(0, 10) : ""}
					name="to"
					type="date"
				/>
				<Button type="submit">搜索</Button>
			</form>
			<div className="mb-3 flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
				<span>当前页 {query.data?.data.length ?? 0} 个会话 · 按最近活动时间排序</span>
				{query.isFetching ? <span role="status">正在更新结果…</span> : null}
			</div>
			{query.isRefetchError ? (
				<p className="mb-3 text-sm text-warning" role="status">
					刷新失败，当前显示上一次成功结果。{" "}
					<button className="underline" onClick={() => void query.refetch()} type="button">
						重试
					</button>
				</p>
			) : null}
			{query.data?.data.length === 0 ? (
				<div className="border-border border-y bg-secondary p-4 text-sm">没有匹配的历史会话。</div>
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
								<span>用户：{c.owner.displayName ?? c.owner.id}</span>
								<span>创建于 {formatTimestamp(c.createdAt)}</span>
								<span>更新于 {formatTimestamp(c.updatedAt)}</span>
								<span>{c.turnCount} 轮</span>
							</div>
							<p className="text-sm text-foreground">{c.latestQuestionPreview ?? "暂无用户问题"}</p>
							{c.latestAnswerPreview ? (
								<p className="line-clamp-2 text-sm text-muted-foreground">
									{c.latestAnswerPreview}
								</p>
							) : null}
							<div className="flex gap-3 text-xs text-muted-foreground">
								<span>{c.hasFailures ? "包含失败运行" : "运行正常"}</span>
								<span>{c.hasFeedback ? "有用户反馈" : "暂无反馈"}</span>
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
						onClick={() => void navigate({ to: "/conversations", search: {} })}
						variant="ghost"
					>
						清除筛选
					</Button>
				) : null}
			</div>
		</section>
	);
}
