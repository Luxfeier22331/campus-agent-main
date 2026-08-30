import {
	Button,
	Field,
	Input,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@campus-agent/ui";
import { ChevronDown, DatabaseZap, History, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import type { NoticeJob, NoticeJobCreate } from "../../shared/ops-contract";
import { formatTimestamp } from "../format";
import { InlineError } from "../ops-display";
import { NoticeJobDiagnostics } from "./notice-job-diagnostics";
import type { NoticeJobFamily } from "./notice-status";
import {
	isActiveNoticeJob,
	isBatchNoticeJob,
	NoticeJobStatusBadge,
	noticeJobSummaryLabel,
	noticeOperationLabel,
} from "./notice-status";
import type { PendingNoticeJobSubmission } from "./use-notice-maintenance";

const INITIAL_NOTICE_BACKFILL_DATE = "2025-12-01";

export function NoticeTaskCenter({
	createError,
	isFamilyBusy,
	jobs,
	jobsError,
	jobsPending,
	onCreate,
	onOpenChange,
	open,
	pendingSubmissions,
}: {
	createError: unknown;
	isFamilyBusy: (family: NoticeJobFamily) => boolean;
	jobs: NoticeJob[];
	jobsError: unknown;
	jobsPending: boolean;
	onCreate: (input: NoticeJobCreate) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	pendingSubmissions: PendingNoticeJobSubmission[];
}) {
	const [startDate, setStartDate] = useState(INITIAL_NOTICE_BACKFILL_DATE);
	const activeJobs = jobs.filter(isActiveNoticeJob);
	const recentJobs = jobs.filter((job) => !isActiveNoticeJob(job));

	return (
		<Sheet onOpenChange={onOpenChange} open={open}>
			<SheetContent
				aria-label="通知任务中心"
				className="flex w-[min(42rem,100vw)] max-w-none flex-col p-0"
				side="right"
			>
				<SheetHeader className="border-border border-b px-5 py-5 pr-14">
					<SheetTitle>通知任务中心</SheetTitle>
					<SheetDescription>
						启动库存、分类和发布任务，并查看全部手动任务状态。单条操作留在通知详情中。
					</SheetDescription>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
					<div className="grid gap-8">
						<section aria-labelledby="notice-start-actions">
							<div className="mb-4">
								<h2 className="font-semibold text-sm" id="notice-start-actions">
									启动任务
								</h2>
								<p className="mt-1 text-muted-foreground text-xs">
									同一组已有任务运行时，该组的新任务暂不可启动。
								</p>
							</div>
							<div className="grid gap-3">
								<ActionGroup
									description="同步新通知，或从指定日期重新采集历史通知。"
									icon={<DatabaseZap aria-hidden="true" />}
									title="库存更新"
								>
									<TaskAction
										disabled={isFamilyBusy("collection")}
										onClick={() => onCreate({ operation: "notice-sync" })}
										title="同步新通知"
									/>
									<details className="group border-border border-t pt-2">
										<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 font-medium text-sm hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
											<span className="flex items-center gap-2">
												<History aria-hidden="true" className="size-4 text-muted-foreground" />
												历史回填
											</span>
											<ChevronDown
												aria-hidden="true"
												className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
											/>
										</summary>
										<form
											className="grid gap-3 px-2 pt-2 pb-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
											onSubmit={(event) => {
												event.preventDefault();
												if (startDate) {
													onCreate({ operation: "notice-backfill", startDate });
												}
											}}
										>
											<Field description="首次初始化使用 2025-12-01。" label="起始日期">
												<Input
													onChange={(event) => setStartDate(event.target.value)}
													required
													type="date"
													value={startDate}
												/>
											</Field>
											<Button
												disabled={isFamilyBusy("collection") || !startDate}
												type="submit"
												variant="outline"
											>
												开始回填
											</Button>
										</form>
									</details>
								</ActionGroup>

								<ActionGroup
									description="为当前所有缺少分类的通知运行模型分类。"
									icon={<Sparkles aria-hidden="true" />}
									title="分类"
								>
									<TaskAction
										disabled={isFamilyBusy("classification")}
										onClick={() => onCreate({ operation: "notice-classify-missing" })}
										title="分类缺失通知"
									/>
								</ActionGroup>

								<ActionGroup
									description="发布当前所有已分类但尚未发布的通知。"
									icon={<Send aria-hidden="true" />}
									title="发布"
								>
									<TaskAction
										disabled={isFamilyBusy("publication")}
										onClick={() => onCreate({ operation: "notice-publish-pending" })}
										title="发布待发布通知"
									/>
								</ActionGroup>
							</div>
						</section>

						{createError ? <InlineError error={createError} title="任务启动失败" /> : null}

						<section aria-labelledby="notice-task-status">
							<div className="mb-4 flex items-baseline justify-between gap-3">
								<h2 className="font-semibold text-sm" id="notice-task-status">
									任务状态
								</h2>
								<p className="text-muted-foreground text-xs">最多显示 50 条</p>
							</div>
							{jobsError ? <InlineError error={jobsError} title="任务读取失败" /> : null}
							{jobsPending && jobs.length === 0 ? <TaskListSkeleton /> : null}
							{jobs.length === 0 && pendingSubmissions.length === 0 ? (
								jobsPending || jobsError ? null : (
									<TaskListEmpty />
								)
							) : (
								<div className="grid gap-6">
									<TaskSection
										ariaLabel="进行中任务"
										emptyMessage="当前没有进行中的任务。"
										jobs={activeJobs}
										pendingSubmissions={pendingSubmissions}
										title={`进行中（${activeJobs.length + pendingSubmissions.length}）`}
									/>
									{recentJobs.length > 0 || !(jobsPending || jobsError) ? (
										<TaskSection
											ariaLabel="最近任务记录"
											emptyMessage="暂无已完成的任务。"
											jobs={recentJobs}
											title="最近记录"
										/>
									) : null}
								</div>
							)}
						</section>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}

function ActionGroup({
	children,
	description,
	icon,
	title,
}: {
	children: React.ReactNode;
	description: string;
	icon: React.ReactNode;
	title: string;
}) {
	return (
		<section aria-label={title} className="rounded-[var(--card-radius)] border border-border p-4">
			<header className="flex items-start gap-3">
				<span className="mt-0.5 text-muted-foreground">{icon}</span>
				<div className="min-w-0">
					<h3 className="font-medium text-sm">{title}</h3>
					<p className="mt-1 text-muted-foreground text-xs">{description}</p>
				</div>
			</header>
			<div className="mt-4 grid gap-2">{children}</div>
		</section>
	);
}

function TaskAction({
	disabled,
	onClick,
	title,
}: {
	disabled: boolean;
	onClick: () => void;
	title: string;
}) {
	return (
		<Button className="w-full sm:w-fit" disabled={disabled} onClick={onClick}>
			{title}
		</Button>
	);
}

function TaskSection({
	ariaLabel,
	emptyMessage,
	jobs,
	pendingSubmissions = [],
	title,
}: {
	ariaLabel: string;
	emptyMessage: string;
	jobs: NoticeJob[];
	pendingSubmissions?: PendingNoticeJobSubmission[];
	title: string;
}) {
	return (
		<section aria-label={ariaLabel}>
			<h3 className="mb-2 font-medium text-sm">{title}</h3>
			{jobs.length === 0 && pendingSubmissions.length === 0 ? (
				<p className="rounded-md bg-surface-muted px-3 py-3 text-muted-foreground text-xs">
					{emptyMessage}
				</p>
			) : (
				<TaskList ariaLabel={ariaLabel} jobs={jobs} pendingSubmissions={pendingSubmissions} />
			)}
		</section>
	);
}

function TaskList({
	ariaLabel,
	jobs,
	pendingSubmissions,
}: {
	ariaLabel: string;
	jobs: NoticeJob[];
	pendingSubmissions: PendingNoticeJobSubmission[];
}) {
	return (
		<ul aria-label={ariaLabel} className="grid gap-2">
			{pendingSubmissions.map((submission) => (
				<li
					className="rounded-[var(--card-radius)] border border-border px-4 py-3"
					key={`${submission.submittedAt}:${submission.input.operation}`}
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="font-medium text-sm">
							{noticeOperationLabel(submission.input.operation)}
						</p>
						<NoticeJobStatusBadge status="pending" />
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
						<span>{noticeJobInputScopeLabel(submission.input)}</span>
						<span>正在创建任务</span>
					</div>
					<p className="mt-2 text-muted-foreground text-xs">
						提交于 {formatTimestamp(new Date(submission.submittedAt).toISOString())}
					</p>
				</li>
			))}
			{jobs.map((job) => {
				const summary = noticeJobSummaryLabel(job.operation, job.summary);
				return (
					<li
						className="rounded-[var(--card-radius)] border border-border px-4 py-3"
						key={job.jobName}
					>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<p className="font-medium text-sm">{noticeOperationLabel(job.operation)}</p>
							<NoticeJobStatusBadge status={job.status} />
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
							<span>{noticeJobScopeLabel(job)}</span>
							<span className="min-w-0 break-all font-mono">{job.jobName}</span>
						</div>
						<div className="mt-2 grid gap-1 text-muted-foreground text-xs">
							<span>创建于 {formatTimestamp(job.createdAt)}</span>
							{job.completedAt ? <span>完成于 {formatTimestamp(job.completedAt)}</span> : null}
						</div>
						{summary ? <p className="mt-2 text-xs">{summary}</p> : null}
						<NoticeJobDiagnostics job={job} />
					</li>
				);
			})}
		</ul>
	);
}

function noticeJobInputScopeLabel(input: NoticeJobCreate): string {
	if ("noticeId" in input) {
		return `单条 #${input.noticeId}`;
	}
	if (input.operation === "notice-backfill") {
		return `批量 · 起始日期 ${input.startDate}`;
	}
	return "批量";
}

function noticeJobScopeLabel(job: NoticeJob): string {
	if (job.noticeId !== null) {
		return `单条 #${job.noticeId}`;
	}
	return isBatchNoticeJob(job) ? "批量" : "单条";
}

function TaskListEmpty() {
	return (
		<div className="rounded-[var(--card-radius)] border border-dashed border-border px-4 py-8 text-center">
			<p className="font-medium text-sm">暂无手动任务</p>
			<p className="mt-1 text-muted-foreground text-xs">启动任务后，状态会显示在这里。</p>
		</div>
	);
}

function TaskListSkeleton() {
	return (
		<div aria-label="正在读取任务" className="grid gap-2" role="status">
			<div className="h-20 animate-pulse rounded-[var(--card-radius)] bg-surface-muted" />
			<div className="h-20 animate-pulse rounded-[var(--card-radius)] bg-surface-muted" />
		</div>
	);
}
