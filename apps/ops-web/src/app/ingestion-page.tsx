import { Badge, Button, Card, CardContent, Field, NativeSelect, Textarea } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Play, RefreshCw, RotateCcw, Upload } from "lucide-react";
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
import {
	ErrorState,
	InlineError,
	KeyValue,
	PageHeader,
	PageShell,
	StaleDataWarning,
} from "./ops-display";
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

	const ingestionStatus = status.data;
	if (!(ingestionStatus || tasks.data) && (status.isPending || tasks.isPending)) {
		return <PageShell title="采集运行">正在读取采集状态...</PageShell>;
	}
	if (!(ingestionStatus || tasks.data)) {
		return (
			<section>
				<PageHeader description="查看通知采集计划、离线发布和采集任务。" title="采集运行" />
				<ErrorState
					error={status.error}
					onRetry={() => status.refetch()}
					title="采集状态读取失败"
				/>
			</section>
		);
	}

	const fileReleaseValidation = validateFileReleaseIds(fileIds);
	const parsedFileReleaseIds = fileReleaseValidation.ids;
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
	const refreshing = status.isFetching || tasks.isFetching;

	return (
		<section>
			<PageHeader
				actions={
					<Button
						aria-busy={refreshing}
						disabled={refreshing}
						onClick={() => {
							void Promise.all([status.refetch(), tasks.refetch()]);
						}}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						{refreshing ? "刷新中" : "刷新"}
					</Button>
				}
				description="查看通知采集计划、离线发布和采集任务。"
				title="采集运行"
			/>

			<div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
				{status.isRefetchError ? (
					<div className="xl:col-span-2">
						<StaleDataWarning
							error={status.error}
							lastSuccessfulAt={status.dataUpdatedAt}
							onRetry={() => void status.refetch()}
							title="通知发布状态刷新失败"
						/>
					</div>
				) : null}
				{ingestionStatus ? (
					(() => {
						const publication = ingestionStatus.notice.publication;
						return (
							<section aria-labelledby="notice-publication-heading" className="min-w-0">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<h2 className="font-semibold text-lg" id="notice-publication-heading">
											通知发布
										</h2>
										<p className="mt-1 text-muted-foreground text-sm">
											固定计划会检查新通知并更新离线发布。
										</p>
									</div>
									<Badge tone={publication.scheduleState === "ACTIVE" ? "success" : "warning"}>
										{scheduleLabel(publication.scheduleState)}
									</Badge>
								</div>
								<div className="mt-4 grid border-border border-y sm:grid-cols-2 lg:grid-cols-3">
									<KeyValue
										label="最近结果"
										value={publicationOutcomeLabel(publication.lastOutcome)}
									/>
									<KeyValue
										label="最近执行"
										value={formatOptionalTime(publication.lastAttemptAt)}
									/>
									<KeyValue label="下次执行" value={formatOptionalTime(publication.nextRunAt)} />
									<KeyValue
										label="当前发布"
										value={formatReleaseVersion(ingestionStatus.notice.release)}
									/>
									<KeyValue
										label="发布条目"
										value={ingestionStatus.notice.release?.item_count ?? "暂无"}
									/>
									<KeyValue
										label="最近变化"
										value={formatReleaseChanges(ingestionStatus.notice.release)}
									/>
								</div>
								<div className="mt-4 flex flex-wrap gap-2">
									{publication.scheduleState === "ACTIVE" ? (
										<Button
											aria-busy={scheduleMutation.isPending}
											disabled={scheduleMutation.isPending}
											onClick={() => scheduleMutation.mutate("pause")}
											variant="outline"
										>
											{scheduleMutation.isPending ? "暂停中" : "暂停计划"}
										</Button>
									) : (
										<Button
											aria-busy={scheduleMutation.isPending}
											disabled={
												scheduleMutation.isPending || publication.scheduleState === "MISSING"
											}
											onClick={() => scheduleMutation.mutate("resume")}
										>
											<Play className="size-4" />
											{scheduleMutation.isPending ? "恢复中" : "恢复计划"}
										</Button>
									)}
									<form onSubmit={reconcileSubmit}>
										<Button
											aria-busy={reconcileMutation.isPending}
											disabled={reconcileMutation.isPending}
											type="submit"
											variant="outline"
										>
											<RotateCcw className="size-4" />
											{reconcileMutation.isPending ? "提交中" : "立即完整核对"}
										</Button>
									</form>
								</div>
								{scheduleMutation.isError ? (
									<div className="mt-3">
										<InlineError error={scheduleMutation.error} title="通知计划修改失败" />
									</div>
								) : null}
								{scheduleMutation.isSuccess ? (
									<p className="mt-3 text-success text-sm" role="status">
										通知计划已{scheduleMutation.variables === "pause" ? "暂停" : "恢复"}。
									</p>
								) : null}
								{reconcileMutation.isError ? (
									<div className="mt-3">
										<InlineError error={reconcileMutation.error} title="完整核对提交失败" />
									</div>
								) : null}
								{reconcileMutation.isSuccess ? (
									<p className="mt-3 text-success text-sm" role="status">
										完整核对已进入队列。
									</p>
								) : null}
								<details className="mt-4 border-border border-t pt-4 text-sm">
									<summary className="w-fit cursor-pointer font-medium text-muted-foreground">
										查看最近检查与发布记录
									</summary>
									<div className="mt-3 grid sm:grid-cols-2">
										<KeyValue
											label="最近检查"
											value={formatOptionalTime(
												ingestionStatus.notice.release?.last_check_at ?? null,
											)}
										/>
										<KeyValue
											label="检查结果"
											value={releaseCheckLabel(
												ingestionStatus.notice.release?.last_check_outcome ?? null,
											)}
										/>
										<KeyValue
											label="最近发布"
											value={formatOptionalTime(
												ingestionStatus.notice.release?.last_published_at ?? null,
											)}
										/>
										<KeyValue
											label="最近完整核对"
											value={formatOptionalTime(
												ingestionStatus.notice.release?.last_reconcile_at ?? null,
											)}
										/>
										{ingestionStatus.notice.release?.current_release_id ? (
											<KeyValue
												label="发布 ID"
												value={
													<code className="text-xs">
														{ingestionStatus.notice.release.current_release_id}
													</code>
												}
											/>
										) : null}
										{ingestionStatus.notice.release?.last_check_error_code ? (
											<KeyValue
												label="错误代码"
												value={ingestionStatus.notice.release.last_check_error_code}
											/>
										) : null}
									</div>
								</details>
							</section>
						);
					})()
				) : (
					<section aria-labelledby="notice-publication-heading" className="min-w-0">
						{status.isError ? (
							<ErrorState
								error={status.error}
								onRetry={() => void status.refetch()}
								title="通知发布状态读取失败"
							/>
						) : (
							<p
								aria-live="polite"
								className="border-border border-y py-6 text-muted-foreground text-sm"
								role="status"
							>
								正在读取通知发布状态...
							</p>
						)}
					</section>
				)}

				<Card className="self-start">
					<CardContent className="p-5">
						<h2 className="font-semibold text-lg">按文件 ID 采集</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							提交已知的文件发布 ID，不会扫描其他范围。
						</p>
						<form className="mt-4 grid gap-3" onSubmit={fileReleaseSubmit}>
							<Field
								description="支持逗号或换行，最多 50 个不重复 ID。"
								error={fileReleaseValidation.error}
								id="file-release-ids"
								label="文件发布 ID"
							>
								<Textarea
									className="min-h-24 font-mono"
									name="fileReleaseIds"
									onChange={(event) => {
										setFileIds(event.target.value);
										fileReleaseRequestId.current = null;
										fileReleaseMutation.reset();
									}}
									required
									value={fileIds}
								/>
							</Field>
							<div>
								<Button
									aria-busy={fileReleaseMutation.isPending}
									disabled={fileReleaseMutation.isPending || parsedFileReleaseIds.length === 0}
									type="submit"
								>
									<Upload className="size-4" />
									{fileReleaseMutation.isPending ? "提交中" : "开始采集"}
								</Button>
							</div>
						</form>
						{fileReleaseMutation.isError ? (
							<div className="mt-3">
								<InlineError error={fileReleaseMutation.error} title="文件采集提交失败" />
							</div>
						) : null}
						{fileReleaseMutation.isSuccess ? (
							<p className="mt-3 text-success text-sm" role="status">
								已提交 {fileReleaseMutation.data.workflows.length} 个文件采集流程。
							</p>
						) : null}
					</CardContent>
				</Card>
			</div>

			<section
				className="mt-8 min-w-0 border-border border-t pt-6"
				aria-labelledby="ingestion-tasks-heading"
			>
				<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h2 className="font-semibold text-lg" id="ingestion-tasks-heading">
							采集任务
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							查看最近任务并进入详情处理失败记录。
						</p>
					</div>
					<Field className="w-full sm:w-44" id="ingestion-task-status" label="状态">
						<NativeSelect
							className="min-h-11"
							name="taskStatus"
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
						</NativeSelect>
					</Field>
				</div>
				{tasks.isRefetchError ? (
					<StaleDataWarning
						error={tasks.error}
						lastSuccessfulAt={tasks.dataUpdatedAt}
						onRetry={() => void tasks.refetch()}
						title="采集任务刷新失败"
					/>
				) : null}
				{tasks.isPending && !tasks.data ? (
					<p className="border-border border-y py-6 text-muted-foreground text-sm">
						正在读取采集任务...
					</p>
				) : tasks.isError && !tasks.data ? (
					<ErrorState
						error={tasks.error}
						onRetry={() => tasks.refetch()}
						title="采集任务读取失败"
					/>
				) : tasks.data ? (
					<>
						{tasks.data.tasks.length === 0 ? (
							<p className="border-border border-y py-6 text-muted-foreground text-sm">
								没有符合当前筛选条件的采集任务。
							</p>
						) : (
							<>
								<IngestionTaskMobileList tasks={tasks.data.tasks} />
								<div className="hidden md:block">
									<DataTable
										caption="采集任务"
										columns={taskColumns}
										data={tasks.data.tasks}
										minWidth="640px"
										rowKey={(task) => task.task_id}
									/>
								</div>
							</>
						)}
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
			</section>
		</section>
	);
}

const taskColumns = [
	{
		header: "任务",
		rowHeader: true,
		cell: (task: OpsIngestionTask) => <IngestionTaskLink task={task} />,
	},
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
								: "neutral"
				}
			>
				{taskStatusLabel(task.status)}
			</Badge>
		),
	},
	{ header: "更新时间", cell: (task: OpsIngestionTask) => formatTimestamp(task.updated_at) },
];

function IngestionTaskMobileList({ tasks }: { tasks: OpsIngestionTask[] }) {
	return (
		<div
			className="divide-y divide-border border-border border-y md:hidden"
			data-testid="ingestion-task-mobile-list"
		>
			{tasks.map((task) => (
				<article className="grid gap-2 py-3" key={task.task_id}>
					<div className="flex items-start justify-between gap-3">
						<IngestionTaskLink task={task} />
						<Badge
							tone={
								task.status === "completed"
									? "success"
									: task.status === "failed"
										? "danger"
										: task.status === "running"
											? "warning"
											: "neutral"
							}
						>
							{taskStatusLabel(task.status)}
						</Badge>
					</div>
					<div className="text-muted-foreground text-xs">
						<span>更新于 {formatTimestamp(task.updated_at)}</span>
					</div>
				</article>
			))}
		</div>
	);
}

function IngestionTaskLink({ task }: { task: OpsIngestionTask }) {
	const label = ingestionTaskLabel(task.registry_task_id);
	return (
		<Link
			aria-label={`查看${label}任务`}
			className="font-medium text-foreground underline decoration-border underline-offset-4"
			params={{ taskId: task.task_id }}
			title={`任务 ID：${task.task_id}`}
			to="/ingestion/tasks/$taskId"
		>
			{label}
		</Link>
	);
}

interface FileReleaseValidation {
	error?: string;
	ids: number[];
}

function validateFileReleaseIds(value: string): FileReleaseValidation {
	const tokens = value.split(/[\s,，;；]+/u).filter(Boolean);
	if (tokens.length === 0) {
		return { ids: [] };
	}
	if (tokens.length > 50) {
		return { error: "最多只能提交 50 个文件发布 ID。", ids: [] };
	}
	const invalid = tokens.find(
		(item) => !(/^\d+$/u.test(item) && Number.isSafeInteger(Number(item))) || Number(item) < 1,
	);
	if (invalid) {
		return { error: `文件发布 ID 必须是正整数：${invalid}`, ids: [] };
	}
	const ids = tokens.map(Number);
	if (new Set(ids).size !== ids.length) {
		return { error: "文件发布 ID 不能重复。", ids: [] };
	}
	return { ids };
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

function formatReleaseVersion(release: { version: number } | null) {
	return release ? `第 ${release.version} 版` : "暂无";
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

function ingestionTaskLabel(registryTaskId: string) {
	const labels: Record<string, string> = {
		"authenticated_documents.file_release_source.materialize": "门户文件整理",
		"campus_notices.internal_notice.document_units_validate": "校园通知校验",
		"campus_notices.internal_notice.materialize": "校园通知整理",
		"curriculum.curriculum_plan.chunk_prepare": "课程计划切分",
		"internal_portal.file_release.capture": "门户文件抓取",
		"internal_portal.notice.capture": "门户通知抓取",
		"official_web.capture": "官方网站抓取",
		"regulations.student_rules.chunk_prepare": "学生规则切分",
		"regulations.student_rules.document_units_validate": "学生规则校验",
		"wechat_official_account.capture": "微信公众号抓取",
	};
	return labels[registryTaskId] ?? "内容采集任务";
}
