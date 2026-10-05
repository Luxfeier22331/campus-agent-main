import type {
	DiningOpsContentReportRecord,
	DiningOpsSubmissionRecord,
} from "@campus-agent/dining/domain";
import {
	ActionGroup,
	Button,
	ConfirmDialog,
	Field,
	Input,
	StateMessage,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { DiningTaskNavigation, diningWindowOptions } from "./dining-navigation";
import { reportReturnSearch } from "./dining-report-navigation";
import { ReportsPanel } from "./dining-reports-page";
import {
	SubmissionDeadline,
	SubmissionPhoto,
	SubmissionSnapshot,
	SubmissionStatus,
	submissionRestriction,
} from "./dining-submission-display";
import {
	type DiningSubmissionsSearch,
	submissionReturnSearch,
} from "./dining-submission-navigation";
import { formatTimestamp } from "./format";
import { OpsApiError } from "./ops-api/core";
import {
	changeDiningSubmission,
	fetchDiningReports,
	fetchDiningState,
	fetchDiningSubmission,
	fetchDiningSubmissions,
	resolveDiningReports,
	resolveDiningSubmissionReports,
} from "./ops-api/dining";
import { ErrorState, InlineError, PageHeader } from "./ops-display";
import { DataTable } from "./ui/data-table";
import { FilterSelect } from "./ui/filter-select";
import { useConfirmCommand } from "./use-confirm-command";
import { UserLink } from "./user-link";

export function DiningSubmissionsPage({ search = {} }: { search?: DiningSubmissionsSearch }) {
	const navigate = useNavigate({ from: "/dining/submissions" });
	const { windowId = "", status = "", reportStatus = "", cursor } = search;
	const [windowInput, setWindowInput] = useState(windowId);
	useEffect(() => setWindowInput(windowId), [windowId]);
	const previous = decodeCursorHistory(search.history);
	const filters = {
		windowId: windowId || undefined,
		status: status || undefined,
		reportStatus: reportStatus || undefined,
	};
	const changeFilters = (next: DiningSubmissionsSearch) =>
		void navigate({ search: { ...filters, ...next } });
	const filterKey = JSON.stringify(filters);

	const state = useQuery({
		queryKey: ["dining", "state"],
		queryFn: ({ signal }) => fetchDiningState({ signal }),
	});
	const windows = useMemo(
		() => (state.data ? diningWindowOptions(state.data.draft.bundle) : []),
		[state.data],
	);
	const labels = new Map(windows.map((window) => [window.windowId, window.label]));
	const submissions = useQuery<Awaited<ReturnType<typeof fetchDiningSubmissions>>>({
		queryKey: ["dining", "submissions", filterKey, cursor],
		placeholderData: (previous, query) => (query?.queryKey[2] === filterKey ? previous : undefined),
		queryFn: ({ signal }) =>
			fetchDiningSubmissions(
				{
					limit: 50,
					...(windowId ? { windowId } : {}),
					...(status ? { status } : {}),
					...(reportStatus ? { reportStatus } : {}),
					...(cursor ? { cursor } : {}),
				},
				{ signal },
			),
	});
	return (
		<section className="mx-auto w-full min-w-0 max-w-[1600px]">
			<DiningTaskNavigation />
			<PageHeader
				title="用户投稿"
				description="独立于正式菜单的学生内容。查看投稿、编辑历史和举报，执行隐藏或删除等运营操作。"
				actions={
					<Button
						variant="ghost"
						aria-label="刷新投稿"
						disabled={submissions.isFetching}
						onClick={() => void submissions.refetch()}
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
			/>
			<form
				className="ops-filter-bar mb-5 grid min-w-0 grid-cols-2 items-end gap-3 xl:grid-cols-[minmax(18rem,28rem)_12rem_12rem_auto] xl:justify-start"
				onSubmit={(event) => {
					event.preventDefault();
					changeFilters({ windowId: windowInput.trim() || undefined });
				}}
			>
				<Field label="窗口" className="col-span-2 min-w-0 xl:col-span-1">
					<Input
						id="submission-window"
						list="submission-windows"
						value={windowInput}
						onChange={(event) => setWindowInput(event.target.value)}
						placeholder="全部窗口，或输入窗口标识"
					/>
				</Field>
				<datalist id="submission-windows">
					{windows.map((window) => (
						<option key={window.windowId} value={window.windowId}>
							{window.label}
						</option>
					))}
				</datalist>

				<Field label="投稿状态">
					<FilterSelect
						id="submission-status"
						value={status}
						onValueChange={(nextValue) => {
							changeFilters({
								status: (nextValue || undefined) as DiningSubmissionsSearch["status"],
							});
						}}
						options={[
							{ value: "", label: "全部状态" },
							{ value: "public", label: "公开" },
							{ value: "hidden", label: "已隐藏" },
							{ value: "deleted", label: "已软删除" },
							{ value: "expired", label: "已到期" },
							{ value: "purged", label: "已清理" },
						]}
					/>
				</Field>
				<Field label="投稿举报">
					<FilterSelect
						id="submission-report-status"
						value={reportStatus}
						onValueChange={(nextValue) => {
							changeFilters({
								reportStatus: (nextValue || undefined) as DiningSubmissionsSearch["reportStatus"],
							});
						}}
						options={[
							{ value: "", label: "全部举报状态" },
							{ value: "pending", label: "有待处理举报" },
							{ value: "resolved", label: "有已处理举报" },
						]}
					/>
				</Field>
				<Button type="submit" variant="primary">
					筛选窗口
				</Button>
			</form>
			{state.error ? (
				<StateMessage layout="inline" description="窗口名称读取失败，仍可按窗口标识筛选投稿。" />
			) : null}
			{submissions.error ? (
				<div className="mb-4">
					<ErrorState
						error={submissions.error}
						title={submissions.data ? "刷新失败，以下为上次读取结果" : "投稿读取失败"}
						onRetry={() => void submissions.refetch()}
					/>
				</div>
			) : null}
			{submissions.isPending ? (
				<StateMessage
					layout="inline"
					role="status"
					className="py-8"
					description={<>正在读取投稿...</>}
				/>
			) : submissions.data ? (
				<>
					{submissions.isPlaceholderData ? (
						<StateMessage
							layout="inline"
							role="status"
							className="mb-3"
							description={<>正在读取下一页，暂时显示当前页。</>}
						/>
					) : null}
					{submissions.data.items.length === 0 ? (
						<StateMessage description={<>当前筛选范围没有投稿。</>} />
					) : (
						<>
							<div className="hidden xl:block">
								<DataTable
									caption="用户投稿列表"
									minWidth="960px"
									rowKey={(submission) => submission.submissionId}
									data={submissions.data.items}
									columns={[
										{
											header: "投稿",
											rowHeader: true,
											cell: (submission) => <SubmissionLink submission={submission} />,
										},
										{
											header: "状态",
											cell: (submission) => <SubmissionStatus submission={submission} />,
										},
										{
											header: "作者 / 窗口",
											cell: (submission) => (
												<SubmissionAttribution
													submission={submission}
													windowLabel={
														submission.status === "purged"
															? undefined
															: labels.get(submission.windowId)
													}
												/>
											),
										},
										{
											header: "待处理举报",
											cell: (submission) =>
												submission.status === "purged" ? "—" : submission.pendingReportCount,
										},
										{
											header: "时间",
											cell: (submission) =>
												submission.status === "purged"
													? formatTimestamp(submission.purgedAt)
													: formatTimestamp(submission.createdAt),
										},
									]}
								/>
							</div>
							<ul className="divide-y divide-border border-border border-y xl:hidden">
								{submissions.data.items.map((submission) => (
									<li key={submission.submissionId} className="space-y-2 py-3">
										<SubmissionLink submission={submission} />
										<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
											<SubmissionStatus submission={submission} />
											{submission.status !== "purged" && submission.pendingReportCount > 0 ? (
												<span>待处理举报 {submission.pendingReportCount}</span>
											) : null}
											<time>
												{formatTimestamp(
													submission.status === "purged"
														? submission.purgedAt
														: submission.createdAt,
												)}
											</time>
										</div>
										<SubmissionAttribution
											submission={submission}
											windowLabel={
												submission.status === "purged" ? undefined : labels.get(submission.windowId)
											}
										/>
										<SubmissionDeadline submission={submission} />
									</li>
								))}
							</ul>
						</>
					)}
					<ActionGroup className="mt-4 justify-end">
						<Button
							variant="ghost"
							disabled={previous.length === 0 || submissions.isFetching}
							onClick={() => {
								const history = [...previous];
								changeFilters({
									cursor: history.pop() || undefined,
									history: encodeCursorHistory(history),
								});
							}}
						>
							上一页
						</Button>
						<Button
							variant="ghost"
							disabled={!submissions.data.nextCursor || submissions.isFetching}
							onClick={() => {
								changeFilters({
									cursor: submissions.data?.nextCursor ?? undefined,
									history: encodeCursorHistory([...previous, cursor ?? ""]),
								});
							}}
						>
							下一页
						</Button>
					</ActionGroup>
				</>
			) : null}
		</section>
	);
}

function SubmissionLink({ submission }: { submission: DiningOpsSubmissionRecord }) {
	const from = useRouterState({ select: (state) => state.location.href });
	return (
		<div className="min-w-0 space-y-1">
			<Link
				className="inline-flex min-h-11 items-center break-words font-medium text-link hover:underline"
				to="/dining/submissions/$submissionId"
				params={{ submissionId: submission.submissionId }}
				search={{ from }}
			>
				{"name" in submission
					? submission.name
					: submission.status === "purged"
						? "已清理投稿"
						: "已到期投稿"}
			</Link>
			<p className="text-muted-foreground text-xs">
				用户投稿{"priceText" in submission ? ` · ${submission.priceText ?? "未填写价格"}` : ""}
			</p>
		</div>
	);
}

function SubmissionAttribution({
	submission,
	windowLabel,
}: {
	submission: DiningOpsSubmissionRecord;
	windowLabel?: string | undefined;
}) {
	if (submission.status === "purged") {
		return <p className="text-muted-foreground text-sm">身份与窗口已清理</p>;
	}
	return (
		<div className="min-w-0 space-y-1 text-sm">
			<p className="break-words">{submission.authorDisplayName ?? "身份已清理"}</p>
			<p className="break-all text-muted-foreground text-xs">
				{windowLabel ?? submission.windowId}
			</p>
		</div>
	);
}

type SubmissionAction = "hide" | "unhide" | "delete" | "restore";
const actionLabels: Record<SubmissionAction, string> = {
	hide: "隐藏投稿",
	unhide: "恢复公开",
	delete: "软删除投稿",
	restore: "恢复删除",
};
const actionDescriptions: Record<SubmissionAction, string> = {
	hide: "投稿、当前照片及关联评价将停止公开，并关闭该投稿的全部待处理举报。评价自身的隐藏或删除状态不变。",
	unhide: "在窗口与作者状态允许时重新公开投稿。已单独隐藏或删除的评价不会恢复。",
	delete: "立即撤下投稿，删除时起 30 天内可由运营恢复；到期后清理正文和照片。学生不能自行恢复。",
	restore: "仅撤销删除状态。原先隐藏的投稿仍保持隐藏，原先单独处理的评价不会恢复。",
};

export function DiningSubmissionDetailPage({
	submissionId,
	from,
}: {
	submissionId: string;
	from?: string | undefined;
}) {
	const confirmCommand = useConfirmCommand();

	const queryClient = useQueryClient();
	const [notice, setNotice] = useState("");
	const detail = useQuery({
		queryKey: ["dining", "submission", submissionId],
		queryFn: ({ signal }) => fetchDiningSubmission(submissionId, { signal }),
	});
	const refresh = async () => {
		await Promise.all([
			detail.refetch(),
			queryClient.invalidateQueries({ queryKey: ["dining", "submissions"] }),
			queryClient.invalidateQueries({ queryKey: ["dining", "reports"] }),
		]);
	};
	const mutation = useMutation({
		mutationFn: ({ action, revision }: { action: SubmissionAction; revision: number }) =>
			changeDiningSubmission(submissionId, revision, action),
		onSuccess: async (_result, variables) => {
			setNotice(`${actionLabels[variables.action]}已完成。`);
			await refresh();
		},
		onError: (error) => {
			setNotice("");
			if (error instanceof OpsApiError && error.status === 409) {
				void refresh();
			}
		},
	});
	const state = useQuery({
		queryKey: ["dining", "state"],
		queryFn: ({ signal }) => fetchDiningState({ signal }),
	});
	const windowLabels = new Map(
		state.data
			? diningWindowOptions(state.data.draft.bundle).map((window) => [
					window.windowId,
					window.label,
				])
			: [],
	);
	const submission = detail.data?.submission;
	const reportSearch = reportReturnSearch(from);
	return (
		<section className="mx-auto w-full min-w-0 max-w-[1200px]">
			<DiningTaskNavigation />
			<Link
				className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-link hover:underline"
				to={reportSearch ? "/dining/reports" : "/dining/submissions"}
				search={reportSearch ?? submissionReturnSearch(from)}
			>
				<ArrowLeft className="size-4" />
				{reportSearch ? "返回举报队列" : "返回投稿列表"}
			</Link>
			<PageHeader
				title="用户投稿详情"
				description="查看投稿内容，处理举报与公开状态。"
				actions={
					<Button
						variant="ghost"
						disabled={detail.isFetching}
						onClick={() => {
							mutation.reset();
							setNotice("");
							void refresh();
						}}
					>
						<RefreshCw className="size-4" />
						刷新详情
					</Button>
				}
			/>
			{detail.error ? (
				<div className="mb-4">
					<ErrorState
						error={detail.error}
						title={detail.data ? "刷新失败，以下为上次读取结果" : "投稿详情读取失败"}
						onRetry={() => void refresh()}
					/>
				</div>
			) : null}
			{detail.isPending ? (
				<StateMessage
					layout="inline"
					role="status"
					className="py-8"
					description={<>正在读取投稿详情...</>}
				/>
			) : null}
			{submission && detail.data ? (
				<>
					{submission.status === "purged" ? null : (
						<div className="mb-4 rounded-lg border border-border bg-background p-4">
							<div className="min-w-0 space-y-3">
								<h2 className="font-semibold">当前内容</h2>
								{"name" in submission ? (
									<>
										<p className="break-words text-lg font-medium">{submission.name}</p>
										<p>{submission.priceText ?? "未填写价格"}</p>
										{submission.photo ? (
											<SubmissionPhoto
												key={submission.photo.photoId}
												photo={submission.photo}
												label="投稿当前照片"
											/>
										) : (
											<p className="text-muted-foreground text-sm">无当前照片。</p>
										)}
									</>
								) : (
									<p className="text-muted-foreground text-sm">正文与照片已到期，不可回放。</p>
								)}
							</div>
						</div>
					)}

					<div className="mb-3 flex flex-wrap items-center gap-3">
						<SubmissionStatus submission={submission} />

						<SubmissionDeadline submission={submission} />
						{submissionRestriction(submission) ? (
							<p className="text-sm">{submissionRestriction(submission)}</p>
						) : null}
					</div>
					{mutation.error ? (
						<div className="mb-4">
							<InlineError error={mutation.error} title="投稿操作失败" />
							{mutation.error instanceof OpsApiError && mutation.error.status === 409 ? (
								<p className="mt-2 text-sm">
									内容或状态已变化，已重新读取。请核对最新内容后重新选择操作。
								</p>
							) : null}
						</div>
					) : null}
					{notice ? (
						<StateMessage layout="inline" role="status" className="mb-4" description={notice} />
					) : null}
					<div className="mb-6 flex flex-wrap gap-2">
						{(["hide", "unhide", "delete", "restore"] as const)
							.filter((action) =>
								action === "hide"
									? submission.status === "public" && submission.canDelete
									: action === "unhide"
										? submission.status === "hidden"
										: action === "delete"
											? submission.canDelete
											: submission.status === "deleted",
							)
							.map((action) => (
								<ConfirmDialog
									key={action}
									title={`${actionLabels[action]}？`}
									confirmLabel={actionLabels[action]}
									confirmVariant={
										action === "unhide" || action === "restore" ? "primary" : "destructive"
									}
									description={actionDescriptions[action]}
									{...confirmCommand(action, () => {
										setNotice("");
										return mutation.mutateAsync({ action, revision: submission.revision });
									})}
									trigger={
										<Button
											variant={action === "delete" ? "destructive" : "secondary"}
											disabled={
												mutation.isPending ||
												detail.isFetching ||
												Boolean(detail.error) ||
												(action === "unhide" && !submission.canUnhide) ||
												(action === "restore" && !submission.canRestore)
											}
										>
											{mutation.isPending && mutation.variables?.action === action
												? "处理中…"
												: actionLabels[action]}
										</Button>
									}
								/>
							))}
						{submission.status === "purged" ? null : (
							<Link
								className="inline-flex min-h-11 items-center text-link hover:underline"
								to="/dining/reviews"
								search={{ submission_id: submissionId }}
							>
								查看此投稿下的评价
							</Link>
						)}
					</div>

					<Tabs defaultValue="reports" className="min-w-0">
						<TabsList aria-label="投稿详情分区">
							<TabsTrigger value="reports">相关举报</TabsTrigger>
							<TabsTrigger value="history">编辑历史</TabsTrigger>
							<TabsTrigger value="information">作者与处理信息</TabsTrigger>
						</TabsList>
						<TabsContent value="reports">
							<SubmissionReports submissionId={submissionId} onResolved={refresh} />
						</TabsContent>
						<TabsContent value="history">
							<section
								className="mb-7 min-w-0 space-y-4"
								aria-labelledby="submission-history-title"
							>
								<h2 id="submission-history-title" className="font-semibold">
									编辑历史
								</h2>
								{detail.data.edits.length === 0 ? (
									<StateMessage
										description={
											submission.status === "purged" ? "编辑历史已清理。" : "尚无编辑记录。"
										}
									/>
								) : (
									<ol className="divide-y divide-border">
										{detail.data.edits.map((edit) => (
											<li key={edit.editId} className="space-y-2 py-3">
												<p className="text-muted-foreground text-sm">
													{formatTimestamp(edit.editedAt)} · {edit.editedBy ?? "身份已清理"}
												</p>
												<div className="grid min-w-0 gap-5 md:grid-cols-2">
													<SubmissionSnapshot
														snapshot={edit.previous}
														label={`修改前（内容版本 ${edit.previousRevision}）`}
													/>
													<SubmissionSnapshot
														snapshot={edit.next}
														label={`修改后（内容版本 ${edit.nextRevision}）`}
													/>
												</div>
											</li>
										))}
									</ol>
								)}
							</section>
						</TabsContent>
						<TabsContent value="information">
							<p className="mb-3 break-all text-xs text-muted-foreground">
								投稿标识：{submission.submissionId}
							</p>
							{submission.status === "purged" ? null : (
								<div className="min-w-0 space-y-2 text-sm">
									<h2 className="font-semibold">作者与处理信息</h2>
									<p>展示名：{submission.authorDisplayName ?? "身份已清理"}</p>
									<p className="break-all">
										内部用户标识：
										{submission.authorId ? <UserLink userId={submission.authorId} /> : "身份已清理"}
									</p>
									<p className="break-all">
										窗口：{windowLabels.get(submission.windowId) ?? submission.windowId}
									</p>
									<p>创建：{formatTimestamp(submission.createdAt)}</p>
									<p>更新：{formatTimestamp(submission.updatedAt)}</p>
									<p>最近操作者：{submission.updatedBy ?? "身份已清理"}</p>
									{submission.hiddenAt ? (
										<p>
											隐藏：{formatTimestamp(submission.hiddenAt)} ·{" "}
											{submission.hiddenBy ?? "身份已清理"}
										</p>
									) : null}
									{submission.deletedAt ? (
										<p>
											删除：{formatTimestamp(submission.deletedAt)} ·{" "}
											{submission.deletedBy ?? "身份已清理"}
										</p>
									) : null}
									{submission.accountDeletingAt ? (
										<p>注销撤下：{formatTimestamp(submission.accountDeletingAt)}</p>
									) : null}
								</div>
							)}
						</TabsContent>
					</Tabs>
				</>
			) : null}
		</section>
	);
}

function SubmissionReports({
	submissionId,
	onResolved,
}: {
	submissionId: string;
	onResolved: () => Promise<void>;
}) {
	const [status, setStatus] = useState<"pending" | "resolved">("pending");
	const [targetType, setTargetType] = useState<"review" | "submission">("submission");
	const [cursor, setCursor] = useState<string>();
	const [history, setHistory] = useState<Array<string | undefined>>([]);
	const reset = () => {
		setCursor(undefined);
		setHistory([]);
	};
	const reports = useQuery({
		queryKey: ["dining", "reports", submissionId, targetType, status, cursor],
		queryFn: ({ signal }) =>
			fetchDiningReports(
				{ submissionId, targetType, status, limit: 50, ...(cursor ? { cursor } : {}) },
				{ signal },
			),
	});
	const resolve = useMutation({
		mutationFn: ({
			report,
			resolution,
		}: {
			report: DiningOpsContentReportRecord;
			resolution: "keep" | "hide";
		}) =>
			report.target.kind === "review"
				? resolveDiningReports(report.target.current.reviewId, resolution)
				: resolveDiningSubmissionReports(
						report.target.current.submissionId,
						report.target.current.revision,
						resolution,
					),
		onSuccess: async () => {
			await onResolved();
		},
		onError: () => {
			void reports.refetch();
		},
	});
	return (
		<section className="min-w-0 space-y-4" aria-labelledby="submission-reports-title">
			<h2 id="submission-reports-title" className="font-semibold">
				相关举报与处理结果
			</h2>
			<div className="grid max-w-xl grid-cols-2 gap-3">
				<Field label="举报目标">
					<FilterSelect
						id="submission-report-target"
						value={targetType}
						onValueChange={(nextValue) => {
							setTargetType(nextValue as "review" | "submission");
							reset();
						}}
						options={[
							{ value: "submission", label: "此投稿" },
							{ value: "review", label: "此投稿下的评价" },
						]}
					/>
				</Field>
				<Field label="处理状态">
					<FilterSelect
						id="submission-report-state"
						value={status}
						onValueChange={(nextValue) => {
							setStatus(nextValue as "pending" | "resolved");
							reset();
						}}
						options={[
							{ value: "pending", label: "待处理" },
							{ value: "resolved", label: "已处理" },
						]}
					/>
				</Field>
			</div>
			{reports.error ? (
				<ErrorState
					error={reports.error}
					title="相关举报读取失败"
					onRetry={() => void reports.refetch()}
				/>
			) : reports.data ? (
				<ReportsPanel
					reports={reports.data}
					status={status}
					isResolving={resolve.isPending}
					resolveError={resolve.error}
					onResolve={(input) => resolve.mutateAsync(input)}
					hasNextPage={Boolean(reports.data.nextCursor)}
					hasPreviousPage={history.length > 0}
					isFetching={reports.isFetching}
					onNextPage={() => {
						setHistory((values) => [...values, cursor]);
						setCursor(reports.data?.nextCursor ?? undefined);
					}}
					onPreviousPage={() => {
						const previous = [...history];
						setCursor(previous.pop());
						setHistory(previous);
					}}
				/>
			) : (
				<StateMessage layout="inline" role="status" description={<>正在读取相关举报...</>} />
			)}
		</section>
	);
}
