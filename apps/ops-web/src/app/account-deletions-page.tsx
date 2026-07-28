import { Badge, Button, Input, NativeSelect } from "@campus-agent/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { AccountDeletionAdminRecord } from "campus-contracts/account-admin";
import { RefreshCw, RotateCw } from "lucide-react";
import { useState } from "react";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { formatTimestamp } from "./format";
import { fetchAccountDeletions, retryAccountDeletion } from "./ops-api-client";
import { ErrorState, InlineError, PageHeader } from "./ops-display";
import { DataTable } from "./ui/data-table";

export interface AccountDeletionsSearch {
	cursor?: string;
	history?: string;
	status: "completed" | "needs_attention" | "pending" | "";
}

export function AccountDeletionsPage({ search }: { search: AccountDeletionsSearch }) {
	const queryClient = useQueryClient();
	const navigate = useNavigate({ from: "/account-deletions" });
	const history = decodeCursorHistory(search.history);
	const [selected, setSelected] = useState<string | null>(null);
	const [reason, setReason] = useState("");
	const [commandError, setCommandError] = useState<unknown>(null);
	const deletions = useQuery({
		placeholderData: keepPreviousData,
		queryFn: ({ signal }) =>
			fetchAccountDeletions(
				{ cursor: search.cursor, limit: 50, status: search.status || undefined },
				{ signal },
			),
		queryKey: ["ops", "account-deletions", search],
	});
	const setSearch = (next: AccountDeletionsSearch) => void navigate({ search: next });
	const retry = useMutation({
		mutationFn: ({ requestId, retryReason }: { requestId: string; retryReason: string }) =>
			retryAccountDeletion(requestId, retryReason, { idempotencyKey: crypto.randomUUID() }),
		onError: setCommandError,
		onSuccess: async () => {
			setSelected(null);
			setReason("");
			setCommandError(null);
			await queryClient.invalidateQueries({ queryKey: ["ops", "account-deletions"] });
		},
	});

	return (
		<section>
			<PageHeader
				actions={
					<Button
						disabled={deletions.isFetching}
						onClick={() => void deletions.refetch()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
				description="查看异步注销进度，并在依赖恢复后重试失败任务。"
				title="注销任务"
			/>
			<label
				className="mb-4 grid w-fit gap-1 text-muted-foreground text-xs"
				htmlFor="account-deletion-status"
			>
				任务状态
				<NativeSelect
					className="min-h-10"
					id="account-deletion-status"
					onChange={(event) =>
						setSearch({
							status: event.target.value as AccountDeletionsSearch["status"],
						})
					}
					value={search.status}
				>
					<option value="">全部状态</option>
					<option value="pending">处理中</option>
					<option value="needs_attention">需要处理</option>
					<option value="completed">已完成</option>
				</NativeSelect>
			</label>
			{commandError ? <InlineError error={commandError} title="注销任务操作失败" /> : null}
			{deletions.isError ? (
				<ErrorState
					error={deletions.error}
					onRetry={() => void deletions.refetch()}
					title="注销任务读取失败"
				/>
			) : deletions.data ? (
				<>
					<DataTable<AccountDeletionAdminRecord>
						caption="注销任务列表"
						columns={[
							{
								cell: (row) => <span className="font-mono text-xs">{row.requestId}</span>,
								header: "任务 ID",
								rowHeader: true,
							},
							{
								cell: (row) =>
									row.status === "completed" ? (
										<Badge tone="success">已完成</Badge>
									) : row.retryAvailable ? (
										<Badge tone="danger">需要处理</Badge>
									) : (
										<Badge tone="warning">处理中</Badge>
									),
								header: "状态",
							},
							{ cell: (row) => row.attemptCount, header: "尝试次数" },
							{
								cell: (row) =>
									row.ownerUserId ? (
										<span className="font-mono text-xs">{row.ownerUserId}</span>
									) : (
										"账号已删除"
									),
								header: "用户",
							},
							{ cell: (row) => row.lastErrorCode ?? "-", header: "最近错误" },
							{ cell: (row) => formatTimestamp(row.requestedAt), header: "申请时间" },
							{
								cell: (row) => (row.lastAttemptAt ? formatTimestamp(row.lastAttemptAt) : "-"),
								header: "最近尝试",
							},
							{
								cell: (row) =>
									row.status === "pending" ? formatTimestamp(row.nextAttemptAt) : "-",
								header: "下次尝试",
							},
							{
								cell: (row) => (row.completedAt ? formatTimestamp(row.completedAt) : "-"),
								header: "完成时间",
							},
							{ cell: (row) => formatTimestamp(row.updatedAt), header: "更新时间" },
							{
								cell: (row) =>
									row.retryAvailable ? (
										<Button onClick={() => setSelected(row.requestId)} variant="outline">
											<RotateCw className="size-4" />
											重试
										</Button>
									) : null,
								header: "操作",
							},
						]}
						data={deletions.data.items}
						rowKey={(row) => row.requestId}
					/>
					{deletions.data.items.length === 0 ? (
						<p className="mt-4 text-muted-foreground text-sm">没有符合条件的注销任务。</p>
					) : null}
					<div className="mt-4 flex gap-2">
						<Button
							disabled={history.length === 0}
							onClick={() => {
								const previous = history.slice();
								const cursor = previous.pop() || undefined;
								setSearch({
									cursor,
									history: encodeCursorHistory(previous),
									status: search.status,
								});
							}}
							variant="outline"
						>
							上一页
						</Button>
						<Button
							disabled={!deletions.data.nextCursor}
							onClick={() =>
								setSearch({
									cursor: deletions.data?.nextCursor ?? undefined,
									history: encodeCursorHistory([...history, search.cursor ?? ""]),
									status: search.status,
								})
							}
							variant="outline"
						>
							下一页
						</Button>
					</div>
				</>
			) : (
				<p className="text-muted-foreground text-sm">正在读取注销任务...</p>
			)}
			{selected ? (
				<form
					className="mt-4 flex flex-wrap items-end gap-2 border-border border-t pt-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (reason.trim()) {
							retry.mutate({ requestId: selected, retryReason: reason.trim() });
						}
					}}
				>
					<label
						className="grid flex-1 gap-1 text-muted-foreground text-xs"
						htmlFor="account-deletion-retry-reason"
					>
						重试原因
						<Input
							className="min-h-10"
							id="account-deletion-retry-reason"
							onChange={(event) => setReason(event.target.value)}
							value={reason}
						/>
					</label>
					<Button disabled={!reason.trim() || retry.isPending} type="submit">
						确认重试
					</Button>
					<Button onClick={() => setSelected(null)} variant="ghost">
						取消
					</Button>
				</form>
			) : null}
		</section>
	);
}
