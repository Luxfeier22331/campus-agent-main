import { Button, Input } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { formatTimestamp } from "./format";
import { fetchChatConversations } from "./ops-api/chat-conversations";
import { ErrorState, PageHeader, PageShell, StatusBadge } from "./ops-display";

export function ConversationsPage({ search }: { search: Record<string, unknown> }) {
	const navigate = useNavigate();
	const params = new URLSearchParams();
	const q = typeof search.q === "string" ? search.q : "";
	if (q) {
		params.set("q", q);
	}
	if (typeof search.cursor === "string") {
		params.set("cursor", search.cursor);
	}
	if (typeof search.from === "string") {
		params.set("from", search.from);
	}
	if (typeof search.to === "string") {
		params.set("to", search.to);
	}
	if (typeof search.status === "string") {
		params.set("status", search.status);
	}
	if (typeof search.feedback === "string") {
		params.set("feedback", search.feedback);
	}
	if (typeof search.hasFailures === "boolean") {
		params.set("hasFailures", String(search.hasFailures));
	}
	if (typeof search.from === "string") {
		params.set("from", search.from);
	}
	if (typeof search.to === "string") {
		params.set("to", search.to);
	}
	const query = useQuery({
		queryKey: ["ops", "chat-conversations", params.toString()],
		queryFn: ({ signal }) => fetchChatConversations(params, signal),
	});
	if (query.isPending) {
		return <PageShell title="历史会话">正在读取历史会话...</PageShell>;
	}
	if (query.isError) {
		return (
			<ErrorState error={query.error} onRetry={() => query.refetch()} title="历史会话读取失败" />
		);
	}
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
						刷新
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
					const date = (name: string, end = false) => {
						const value = String(form.get(name) ?? "");
						return value
							? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`).toISOString()
							: undefined;
					};
					void navigate({
						to: "/conversations",
						search: {
							q: String(form.get("q") ?? "") || undefined,
							status: String(form.get("status") ?? "") || undefined,
							feedback: String(form.get("feedback") ?? "") || undefined,
							hasFailures:
								form.get("hasFailures") === ""
									? undefined
									: String(form.get("hasFailures")) === "true",
							from: date("from"),
							to: date("to", true),
						},
					});
				}}
			>
				<Input
					aria-label="搜索会话"
					defaultValue={q}
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
			<p className="mb-3 text-sm text-muted-foreground">
				共显示 {query.data.data.length} 个会话 · 按最近活动时间排序
			</p>
			{query.data.data.length === 0 ? (
				<div className="border-border border-y bg-secondary p-4 text-sm">没有匹配的历史会话。</div>
			) : (
				<div className="divide-y divide-border border-y">
					{query.data.data.map((conversation) => (
						<article className="grid gap-2 py-4" key={conversation.id}>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<Link
									className="font-medium text-foreground hover:underline"
									params={{ conversationId: conversation.id }}
									search={{ from: "/conversations" }}
									to="/conversations/$conversationId"
								>
									{conversation.title}
								</Link>
								<StatusBadge status={conversation.latestStatus} />
							</div>
							<div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
								<span>用户：{conversation.owner.displayName ?? conversation.owner.id}</span>
								<span>创建于 {formatTimestamp(conversation.createdAt)}</span>
								<span>更新于 {formatTimestamp(conversation.updatedAt)}</span>
								<span>{conversation.turnCount} 轮</span>
							</div>
							<p className="text-sm text-foreground">
								{conversation.latestQuestionPreview ?? "暂无用户问题"}
							</p>
							{conversation.latestAnswerPreview ? (
								<p className="line-clamp-2 text-sm text-muted-foreground">
									{conversation.latestAnswerPreview}
								</p>
							) : null}
							<div className="flex gap-3 text-xs text-muted-foreground">
								<span>{conversation.hasFailures ? "包含失败运行" : "运行正常"}</span>
								<span>{conversation.hasFeedback ? "有用户反馈" : "暂无反馈"}</span>
							</div>
						</article>
					))}
				</div>
			)}
			{query.data.page.nextCursor ? (
				<Link
					className="mt-4 inline-flex font-medium text-info hover:underline"
					search={{ ...search, cursor: query.data.page.nextCursor }}
					to="/conversations"
				>
					下一页
				</Link>
			) : null}
		</section>
	);
}
