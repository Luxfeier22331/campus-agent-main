import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pause, Play, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import type { OpsIngestionTask } from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import {
	fetchIngestionStatus,
	fetchIngestionTasks,
	pauseNoticePublication,
	resumeNoticePublication,
	startFileReleaseBatch,
	startNoticeReconcile,
} from "./ops-api-client";
import { ErrorState, InlineError, KeyValue, PageHeader, PageShell } from "./ops-display";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { DataTable } from "./ui/data-table";

type TaskStatus = OpsIngestionTask["status"];

export function IngestionPage() {
	const queryClient = useQueryClient();
	const [cursor, setCursor] = useState<string | undefined>();
	const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
	const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
	const [fileIds, setFileIds] = useState("");
	const fileReleaseRequestId = useRef<string | null>(null);
	const reconcileRequestId = useRef<string | null>(null);
	const status = useQuery({
		queryFn: ({ signal }) => fetchIngestionStatus({ signal }),
		queryKey: ["ops", "ingestion", "status"],
		refetchInterval: 30_000,
	});
	const tasks = useQuery({
		placeholderData: keepPreviousData,
		queryFn: ({ signal }) =>
			fetchIngestionTasks({ cursor, limit: 50, status: statusFilter || undefined }, { signal }),
		queryKey: ["ops", "ingestion", "tasks", cursor, statusFilter],
		refetchInterval: 30_000,
	});
	const scheduleMutation = useMutation({
		mutationFn: (action: "pause" | "resume") =>
			action === "pause" ? pauseNoticePublication() : resumeNoticePublication(),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ops", "ingestion", "status"] }),
	});
	const fileReleaseMutation = useMutation({
		mutationFn: startFileReleaseBatch,
		onSuccess: () => {
			fileReleaseRequestId.current = null;
			setFileIds("");
			queryClient.invalidateQueries({ queryKey: ["ops", "ingestion", "tasks"] });
		},
	});
	const reconcileMutation = useMutation({
		mutationFn: startNoticeReconcile,
		onSuccess: () => {
			reconcileRequestId.current = null;
			queryClient.invalidateQueries({ queryKey: ["ops", "ingestion", "tasks"] });
		},
	});

	if (status.isPending && tasks.isPending) {
		return <PageShell title="采集运行">正在读取采集状态...</PageShell>;
	}
	if (status.isError || !status.data) {
		return (
			<section>
				<PageHeader description="内部门户通知和文件发布。" title="采集运行" />
				<Card>
					<CardContent className="p-4">
						<ErrorState
							error={status.error}
							onRetry={() => status.refetch()}
							title="采集状态读取失败"
						/>
					</CardContent>
				</Card>
			</section>
		);
	}

	const publication = status.data.notice.publication;
	const parsedFileReleaseIds = parseFileReleaseIds(fileIds);
	const fileReleaseSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (parsedFileReleaseIds.length > 0) {
			const requestId = fileReleaseRequestId.current ?? crypto.randomUUID();
			fileReleaseRequestId.current = requestId;
			fileReleaseMutation.mutate({ fileReleaseIds: parsedFileReleaseIds, requestId });
		}
	};
	const reconcileSubmit = (event: FormEvent) => {
		event.preventDefault();
		const requestId = reconcileRequestId.current ?? crypto.randomUUID();
		reconcileRequestId.current = requestId;
		reconcileMutation.mutate({ requestId });
	};

	return (
		<section>
			<PageHeader
				actions={
					<Button
						disabled={status.isFetching || tasks.isFetching}
						onClick={() => {
							void Promise.all([status.refetch(), tasks.refetch()]);
						}}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
				description="内部门户通知和文件发布。"
				title="采集运行"
			/>

			<div className="grid gap-4 xl:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle>通知采集</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="mb-3 flex flex-wrap gap-2">
							<Badge tone={publication.scheduleState === "ACTIVE" ? "success" : "warning"}>
								{scheduleLabel(publication.scheduleState)}
							</Badge>
							<Badge
								tone={
									publication.lastOutcome === "PUBLISHED"
										? "success"
										: publication.lastOutcome === "FAILED"
											? "danger"
											: "muted"
								}
							>
								{publicationOutcomeLabel(publication.lastOutcome)}
							</Badge>
						</div>
						<KeyValue label="最近执行" value={formatOptionalTime(publication.lastAttemptAt)} />
						<KeyValue
							label="最近检查"
							value={formatOptionalTime(status.data.notice.release?.last_check_at ?? null)}
						/>
						<KeyValue
							label="检查结果"
							value={releaseCheckLabel(status.data.notice.release?.last_check_outcome ?? null)}
						/>
						<KeyValue
							label="最近发布"
							value={formatOptionalTime(status.data.notice.release?.last_published_at ?? null)}
						/>
						<KeyValue
							label="最近完整核对"
							value={formatOptionalTime(status.data.notice.release?.last_reconcile_at ?? null)}
						/>
						<KeyValue label="下次执行" value={formatOptionalTime(publication.nextRunAt)} />
						<KeyValue
							label="当前发布"
							value={status.data.notice.release?.current_release_id ?? "暂无"}
						/>
						<KeyValue label="条目数" value={status.data.notice.release?.item_count ?? "暂无"} />
						<KeyValue label="最近变化" value={formatReleaseChanges(status.data.notice.release)} />
						{status.data.notice.release?.last_check_error_code ? (
							<KeyValue label="错误代码" value={status.data.notice.release.last_check_error_code} />
						) : null}
						<div className="mt-4 flex flex-wrap gap-2">
							{publication.scheduleState === "ACTIVE" ? (
								<Button
									disabled={scheduleMutation.isPending}
									onClick={() => scheduleMutation.mutate("pause")}
									variant="outline"
								>
									<Pause className="size-4" />
									暂停
								</Button>
							) : (
								<Button
									disabled={scheduleMutation.isPending || publication.scheduleState === "MISSING"}
									onClick={() => scheduleMutation.mutate("resume")}
								>
									<Play className="size-4" />
									恢复
								</Button>
							)}
						</div>
						{scheduleMutation.isError ? (
							<div className="mt-3">
								<InlineError error={scheduleMutation.error} title="通知计划修改失败" />
							</div>
						) : null}
						{scheduleMutation.isSuccess ? (
							<p className="mt-3 text-emerald-700 text-sm" role="status">
								通知计划已{scheduleMutation.variables === "pause" ? "暂停" : "恢复"}。
							</p>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>通知完整核对</CardTitle>
					</CardHeader>
					<CardContent>
						<form className="grid gap-3" onSubmit={reconcileSubmit}>
							<Button disabled={reconcileMutation.isPending} type="submit" variant="outline">
								<RotateCcw className="size-4" />
								{reconcileMutation.isPending ? "提交中" : "立即完整核对"}
							</Button>
						</form>
						{reconcileMutation.isError ? (
							<div className="mt-3">
								<InlineError error={reconcileMutation.error} title="通知完整核对提交失败" />
							</div>
						) : null}
						{reconcileMutation.isSuccess ? (
							<p className="mt-3 break-all text-emerald-700 text-sm" role="status">
								通知完整核对已提交：{reconcileMutation.data.workflow_id}
							</p>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>文件发布采集</CardTitle>
					</CardHeader>
					<CardContent>
						<form className="grid gap-3" onSubmit={fileReleaseSubmit}>
							<label className="grid gap-1 text-sm" htmlFor="file-release-ids">
								<span className="font-medium text-slate-700">文件发布 ID</span>
								<textarea
									className="min-h-24 resize-y rounded-md border border-slate-300 p-3 font-mono"
									id="file-release-ids"
									onChange={(event) => {
										setFileIds(event.target.value);
										fileReleaseRequestId.current = null;
										fileReleaseMutation.reset();
									}}
									required
									value={fileIds}
								/>
							</label>
							<Button
								disabled={fileReleaseMutation.isPending || parsedFileReleaseIds.length === 0}
								type="submit"
							>
								<Upload className="size-4" />
								{fileReleaseMutation.isPending ? "提交中" : "提交"}
							</Button>
						</form>
						{fileReleaseMutation.isError ? (
							<div className="mt-3">
								<InlineError error={fileReleaseMutation.error} title="文件发布采集提交失败" />
							</div>
						) : null}
						{fileReleaseMutation.isSuccess ? (
							<p className="mt-3 text-emerald-700 text-sm" role="status">
								已提交 {fileReleaseMutation.data.workflows.length} 个文件发布采集流程。
							</p>
						) : null}
					</CardContent>
				</Card>
			</div>

			<Card className="mt-4">
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<CardTitle>采集任务</CardTitle>
						<select
							aria-label="任务状态"
							className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm"
							onChange={(event) => {
								setCursor(undefined);
								setPreviousCursors([]);
								setStatusFilter(event.target.value as TaskStatus | "");
							}}
							value={statusFilter}
						>
							<option value="">全部状态</option>
							<option value="running">运行中</option>
							<option value="completed">已完成</option>
							<option value="failed">失败</option>
							<option value="canceled">已取消</option>
						</select>
					</div>
				</CardHeader>
				<CardContent>
					{tasks.isError && !tasks.data ? (
						<ErrorState
							error={tasks.error}
							onRetry={() => tasks.refetch()}
							title="采集任务读取失败"
						/>
					) : tasks.data ? (
						<>
							<DataTable
								columns={taskColumns}
								data={tasks.data.tasks}
								minWidth="980px"
								rowKey={(task) => task.task_id}
							/>
							<div className="mt-4 flex justify-end gap-2">
								<Button
									disabled={previousCursors.length === 0}
									onClick={() => {
										const previous = [...previousCursors];
										setCursor(previous.pop());
										setPreviousCursors(previous);
									}}
									variant="outline"
								>
									上一页
								</Button>
								<Button
									disabled={!tasks.data.page.next_cursor}
									onClick={() => {
										setPreviousCursors((value) => [...value, cursor]);
										setCursor(tasks.data?.page.next_cursor ?? undefined);
									}}
									variant="outline"
								>
									下一页
								</Button>
							</div>
						</>
					) : null}
				</CardContent>
			</Card>
		</section>
	);
}

const taskColumns = [
	{
		header: "任务",
		cell: (task: OpsIngestionTask) => (
			<Link
				className="font-mono text-slate-950 underline decoration-slate-300 underline-offset-4"
				params={{ taskId: task.task_id }}
				to="/ingestion/tasks/$taskId"
			>
				{task.task_id}
			</Link>
		),
	},
	{ header: "阶段", cell: (task: OpsIngestionTask) => task.registry_task_id },
	{
		header: "状态",
		cell: (task: OpsIngestionTask) => (
			<Badge
				tone={
					task.status === "completed"
						? "success"
						: task.status === "failed"
							? "danger"
							: task.status === "running"
								? "warning"
								: "muted"
				}
			>
				{taskStatusLabel(task.status)}
			</Badge>
		),
	},
	{ header: "提交人", cell: (task: OpsIngestionTask) => task.created_by },
	{ header: "更新时间", cell: (task: OpsIngestionTask) => formatTimestamp(task.updated_at) },
];

function parseFileReleaseIds(value: string): number[] {
	const ids = value
		.split(/[\s,，;；]+/u)
		.filter(Boolean)
		.map((item) => Number(item));
	if (
		ids.length === 0 ||
		ids.length > 50 ||
		ids.some((id) => !Number.isSafeInteger(id) || id < 1)
	) {
		return [];
	}
	return [...new Set(ids)].length === ids.length ? ids : [];
}

function formatOptionalTime(value: string | null) {
	return value ? formatTimestamp(value) : "暂无";
}

function scheduleLabel(value: "ACTIVE" | "MISSING" | "PAUSED") {
	return value === "ACTIVE" ? "运行中" : value === "PAUSED" ? "已暂停" : "未部署";
}

function publicationOutcomeLabel(value: string | null) {
	switch (value) {
		case "PUBLISHED":
			return "已发布";
		case "UNCHANGED":
			return "无变化";
		case "DEFERRED":
			return "已延后";
		case "FAILED":
			return "失败";
		case "RUNNING":
			return "执行中";
		case "CREDENTIAL_EXPIRED":
			return "凭据已过期";
		case "CREDENTIAL_UNAVAILABLE":
			return "凭据不可用";
		default:
			return "暂无结果";
	}
}

function releaseCheckLabel(value: string | null) {
	switch (value) {
		case "published":
			return "已发布";
		case "unchanged":
			return "无变化";
		case "deferred":
			return "已延后";
		case "failed":
			return "失败";
		default:
			return "暂无";
	}
}

function formatReleaseChanges(
	release: {
		last_added_count: number;
		last_updated_count: number;
		last_withdrawn_count: number;
	} | null,
) {
	return release
		? `新增 ${release.last_added_count}，更新 ${release.last_updated_count}，撤回 ${release.last_withdrawn_count}`
		: "暂无";
}

function taskStatusLabel(value: TaskStatus) {
	return value === "completed"
		? "已完成"
		: value === "failed"
			? "失败"
			: value === "running"
				? "运行中"
				: "已取消";
}
