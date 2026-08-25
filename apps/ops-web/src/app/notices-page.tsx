import {
	Badge,
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Field,
	Input,
	NativeSelect,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	Skeleton,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	NOTICE_CATEGORIES,
	NOTICE_CATEGORY_LABELS,
	type NoticeCategory,
} from "campus-contracts/notices";
import { DatabaseZap, RefreshCw, Send, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type {
	NoticeJob,
	NoticeJobCreate,
	NoticeJobOperation,
	NoticeState,
	NoticeSummary,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import {
	createNoticeJob,
	fetchNotice,
	fetchNoticeJobs,
	fetchNotices,
	updateNoticeCategory,
} from "./ops-api/notices";
import { ErrorState, InlineError, PageHeader } from "./ops-display";

const noticesQueryKey = ["notices"] as const;
const noticeQueryKey = ["notice"] as const;
const jobsQueryKey = ["notice-jobs"] as const;

export function NoticesPage() {
	const queryClient = useQueryClient();
	const [category, setCategory] = useState("");
	const [page, setPage] = useState(1);
	const [q, setQ] = useState("");
	const [search, setSearch] = useState("");
	const [selectedNoticeId, setSelectedNoticeId] = useState<number | null>(null);
	const [state, setState] = useState<NoticeState | "">("");
	const previousJobStatuses = useRef(new Map<string, NoticeJob["status"]>());
	const filters = { category, page, q, state } as const;
	const notices = useQuery({
		queryFn: ({ signal }) =>
			fetchNotices({
				...(category ? { category } : {}),
				page,
				...(q ? { q } : {}),
				signal,
				...(state ? { state } : {}),
			}),
		queryKey: [...noticesQueryKey, filters],
	});
	const jobs = useQuery({
		queryFn: ({ signal }) => fetchNoticeJobs({ signal }),
		queryKey: jobsQueryKey,
		refetchInterval: (query) =>
			query.state.data?.jobs.some((job) => job.status === "pending" || job.status === "running")
				? 3_000
				: false,
	});
	useEffect(() => {
		if (!jobs.data) {
			return;
		}
		let noticeDataChanged = false;
		const nextJobStatuses = new Map<string, NoticeJob["status"]>();
		for (const job of jobs.data.jobs) {
			const previousStatus = previousJobStatuses.current.get(job.jobName);
			if (
				previousStatus &&
				isActiveNoticeJobStatus(previousStatus) &&
				isTerminalNoticeJobStatus(job.status)
			) {
				noticeDataChanged = true;
			}
			nextJobStatuses.set(job.jobName, job.status);
		}
		previousJobStatuses.current = nextJobStatuses;
		if (noticeDataChanged) {
			void Promise.all([
				queryClient.invalidateQueries({ queryKey: noticesQueryKey }),
				queryClient.invalidateQueries({ queryKey: noticeQueryKey }),
			]);
		}
	}, [jobs.data, queryClient]);
	const createJob = useMutation({
		mutationFn: createNoticeJob,
		onSuccess: async ({ job }) => {
			previousJobStatuses.current.set(job.jobName, job.status);
			await queryClient.invalidateQueries({ queryKey: jobsQueryKey });
		},
	});

	const submitSearch = (event: FormEvent) => {
		event.preventDefault();
		setPage(1);
		setQ(search.trim());
	};
	const updateFilter = (setter: (value: string) => void, value: string) => {
		setPage(1);
		setter(value);
	};

	return (
		<section>
			<PageHeader
				actions={
					<Button disabled={notices.isFetching} onClick={() => notices.refetch()} variant="outline">
						<RefreshCw className={notices.isFetching ? "size-4 animate-spin" : "size-4"} />
						刷新
					</Button>
				}
				description="查看采集到的通知，维护分类，并按状态完成分类与发布。"
				title="通知维护"
			/>

			<form
				className="mb-4 grid gap-3 rounded-md border border-border bg-card p-4 lg:grid-cols-[minmax(16rem,1fr)_13rem_13rem_auto]"
				onSubmit={submitSearch}
			>
				<Field label="搜索标题或通知 ID">
					<Input onChange={(event) => setSearch(event.target.value)} value={search} />
				</Field>
				<Field label="状态">
					<NativeSelect
						onChange={(event) =>
							updateFilter((value) => setState(value as NoticeState | ""), event.target.value)
						}
						value={state}
					>
						<option value="">全部状态</option>
						<option value="needs_classification">待分类</option>
						<option value="needs_publication">待发布</option>
						<option value="published">已发布</option>
					</NativeSelect>
				</Field>
				<Field label="分类">
					<NativeSelect
						onChange={(event) => updateFilter(setCategory, event.target.value)}
						value={category}
					>
						<option value="">全部分类</option>
						{NOTICE_CATEGORIES.map((value) => (
							<option key={value} value={value}>
								{NOTICE_CATEGORY_LABELS[value]}
							</option>
						))}
					</NativeSelect>
				</Field>
				<div className="flex items-end">
					<Button className="w-full" type="submit">
						搜索
					</Button>
				</div>
			</form>

			{notices.isPending ? <NoticeListSkeleton /> : null}
			{notices.isError && !notices.data ? (
				<ErrorState error={notices.error} onRetry={() => notices.refetch()} title="通知读取失败" />
			) : null}
			{notices.data ? (
				<NoticeList data={notices.data} onOpen={setSelectedNoticeId} onPage={setPage} />
			) : null}

			<JobPanel
				create={createJob.mutate}
				disabled={createJob.isPending}
				error={createJob.error}
				jobs={jobs.data?.jobs ?? []}
				jobsError={jobs.error}
				jobsPending={jobs.isPending}
			/>

			<NoticeSheet
				onClose={() => setSelectedNoticeId(null)}
				onJob={(input) => createJob.mutate(input)}
				open={selectedNoticeId !== null}
				noticeId={selectedNoticeId}
			/>
		</section>
	);
}

function NoticeList({
	data,
	onOpen,
	onPage,
}: {
	data: Awaited<ReturnType<typeof fetchNotices>>;
	onOpen: (noticeId: number) => void;
	onPage: (page: number) => void;
}) {
	if (data.items.length === 0) {
		return (
			<p className="rounded-md border border-border p-8 text-center text-muted-foreground text-sm">
				没有符合当前筛选条件的通知。
			</p>
		);
	}
	return (
		<>
			<div className="hidden overflow-hidden rounded-md border border-border md:block">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>通知</TableHead>
							<TableHead>来源</TableHead>
							<TableHead>分类</TableHead>
							<TableHead>状态</TableHead>
							<TableHead>发布时间</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.items.map((notice) => (
							<TableRow
								className="cursor-pointer"
								key={notice.noticeId}
								onClick={() => onOpen(notice.noticeId)}
								tabIndex={0}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										onOpen(notice.noticeId);
									}
								}}
							>
								<TableCell>
									<p className="max-w-xl font-medium">{notice.title}</p>
									<p className="mt-1 font-mono text-muted-foreground text-xs">#{notice.noticeId}</p>
								</TableCell>
								<TableCell>
									<p>{notice.noticeType.name}</p>
									<p className="text-muted-foreground text-xs">
										{notice.organization?.name ?? "无组织"}
									</p>
								</TableCell>
								<TableCell>{categoryLabel(notice.category)}</TableCell>
								<TableCell>
									<NoticeStateBadge state={notice.state} />
								</TableCell>
								<TableCell>{formatTimestamp(notice.releasedAt)}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="grid gap-3 md:hidden">
				{data.items.map((notice) => (
					<button
						className="rounded-md border border-border bg-card p-4 text-left"
						key={notice.noticeId}
						onClick={() => onOpen(notice.noticeId)}
						type="button"
					>
						<div className="flex items-start justify-between gap-3">
							<p className="font-medium">{notice.title}</p>
							<NoticeStateBadge state={notice.state} />
						</div>
						<p className="mt-2 text-muted-foreground text-sm">
							{categoryLabel(notice.category)} · {notice.noticeType.name}
						</p>
						<p className="mt-2 font-mono text-muted-foreground text-xs">
							#{notice.noticeId} · {formatTimestamp(notice.releasedAt)}
						</p>
					</button>
				))}
			</div>
			<div className="mt-4 flex items-center justify-between gap-3 text-muted-foreground text-sm">
				<p>
					共 {data.totalItems} 条，第 {data.page} / {Math.max(data.totalPages, 1)} 页
				</p>
				<div className="flex gap-2">
					<Button disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} variant="outline">
						上一页
					</Button>
					<Button
						disabled={data.page >= data.totalPages}
						onClick={() => onPage(data.page + 1)}
						variant="outline"
					>
						下一页
					</Button>
				</div>
			</div>
		</>
	);
}

function NoticeSheet({
	noticeId,
	onClose,
	onJob,
	open,
}: {
	noticeId: number | null;
	onClose: () => void;
	onJob: (input: NoticeJobCreate) => void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const detail = useQuery({
		enabled: noticeId !== null,
		queryFn: ({ signal }) => fetchNotice(noticeId as number, { signal }),
		queryKey: [...noticeQueryKey, noticeId],
	});
	const notice = detail.data?.notice;
	const [category, setCategory] = useState<NoticeCategory | "">("");
	useEffect(() => {
		setCategory(notice?.category ?? "");
	}, [notice]);
	const save = useMutation({
		mutationFn: updateNoticeCategory,
		onSuccess: async (result) => {
			queryClient.setQueryData([...noticeQueryKey, result.notice.noticeId], result);
			await queryClient.invalidateQueries({ queryKey: noticesQueryKey });
		},
	});
	return (
		<Sheet
			onOpenChange={(next) => {
				if (!next) {
					onClose();
				}
			}}
			open={open}
		>
			<SheetContent className="flex flex-col" side="right">
				<SheetHeader>
					<SheetTitle>通知详情</SheetTitle>
					<SheetDescription>维护通知分类，并按当前状态执行分类或发布。</SheetDescription>
				</SheetHeader>
				<div className="mt-5 flex-1 overflow-y-auto">
					{detail.isPending ? <NoticeListSkeleton /> : null}
					{detail.isError ? (
						<ErrorState
							error={detail.error}
							onRetry={() => detail.refetch()}
							title="通知读取失败"
						/>
					) : null}
					{notice ? (
						<div className="grid gap-5">
							<div>
								<div className="flex items-center gap-2">
									<NoticeStateBadge state={notice.state} />
									<span className="font-mono text-muted-foreground text-xs">
										#{notice.noticeId}
									</span>
								</div>
								<h2 className="mt-3 font-semibold text-lg">{notice.title}</h2>
								<p className="mt-2 text-muted-foreground text-sm">
									{notice.noticeType.name} · {notice.organization?.name ?? "无组织"} ·{" "}
									{formatTimestamp(notice.releasedAt)}
								</p>
								<p className="mt-2 text-muted-foreground text-sm">
									{notice.isExternal ? "外链通知" : "站内通知"}
									{notice.externalUrl ? (
										<>
											·
											<a
												className="text-primary underline underline-offset-4"
												href={notice.externalUrl}
												rel="noreferrer"
												target="_blank"
											>
												打开原始链接
											</a>
										</>
									) : null}
								</p>
							</div>
							<Field label="分类">
								<NativeSelect
									onChange={(event) => setCategory(event.target.value as NoticeCategory)}
									value={category}
								>
									<option value="">请选择分类</option>
									{NOTICE_CATEGORIES.map((value) => (
										<option key={value} value={value}>
											{NOTICE_CATEGORY_LABELS[value]}
										</option>
									))}
								</NativeSelect>
							</Field>
							<p className="text-muted-foreground text-sm">
								{notice.state === "published"
									? "保存后立即在学生端生效。"
									: notice.category === null
										? "选择并保存分类后，通知进入待发布状态。"
										: "保存后通知保持待发布状态。"}
							</p>
							<Button
								disabled={save.isPending || !category || category === notice.category}
								onClick={() => {
									if (category) {
										save.mutate({ category, noticeId: notice.noticeId });
									}
								}}
							>
								保存分类
							</Button>
							{save.isError ? <InlineError error={save.error} title="分类保存失败" /> : null}
							<div className="grid gap-2 border-border border-t pt-5">
								<Button
									onClick={() =>
										onJob({ noticeId: notice.noticeId, operation: "notice-classify-one" })
									}
									variant="outline"
								>
									<Sparkles className="size-4" />
									使用模型分类
								</Button>
								{notice.category && notice.state !== "published" ? (
									<Button
										onClick={() =>
											onJob({ noticeId: notice.noticeId, operation: "notice-publish-one" })
										}
									>
										<Send className="size-4" />
										发布这条通知
									</Button>
								) : null}
							</div>
						</div>
					) : null}
				</div>
				<SheetFooter>
					<Button onClick={onClose} variant="outline">
						关闭
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function JobPanel({
	create,
	disabled,
	error,
	jobs,
	jobsError,
	jobsPending,
}: {
	create: (input: NoticeJobCreate) => void;
	disabled: boolean;
	error: unknown;
	jobs: NoticeJob[];
	jobsError: unknown;
	jobsPending: boolean;
}) {
	const [startDate, setStartDate] = useState("");
	return (
		<Card className="mt-8">
			<CardHeader>
				<CardTitle>辅助任务</CardTitle>
				<p className="text-muted-foreground text-sm">
					用于同步、历史回填、批量分类和发布待发布通知。
				</p>
			</CardHeader>
			<CardContent className="grid gap-5">
				<div className="flex flex-wrap gap-2">
					<Button disabled={disabled} onClick={() => create({ operation: "notice-sync" })}>
						<DatabaseZap className="size-4" />
						同步新通知
					</Button>
					<Button
						disabled={disabled}
						onClick={() => create({ operation: "notice-classify-missing" })}
						variant="outline"
					>
						<Sparkles className="size-4" />
						分类缺失通知
					</Button>
					<Button
						disabled={disabled}
						onClick={() => create({ operation: "notice-publish-pending" })}
						variant="outline"
					>
						<Send className="size-4" />
						发布待发布通知
					</Button>
				</div>
				<form
					className="flex max-w-md items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						create({ operation: "notice-backfill", startDate });
					}}
				>
					<Field label="历史回填起始日期">
						<Input
							onChange={(event) => setStartDate(event.target.value)}
							required
							type="date"
							value={startDate}
						/>
					</Field>
					<Button disabled={disabled || !startDate} type="submit" variant="outline">
						开始回填
					</Button>
				</form>
				{error ? <InlineError error={error} title="任务启动失败" /> : null}
				<div>
					<h3 className="mb-3 font-medium">近期结果</h3>
					{jobsPending ? <p className="text-muted-foreground text-sm">正在读取任务...</p> : null}
					{jobsError ? <InlineError error={jobsError} title="任务读取失败" /> : null}
					<JobList jobs={jobs.slice(0, 8)} />
				</div>
			</CardContent>
		</Card>
	);
}

function JobList({ jobs }: { jobs: NoticeJob[] }) {
	if (jobs.length === 0) {
		return <p className="text-muted-foreground text-sm">暂无近期任务。</p>;
	}
	return (
		<div className="grid gap-2">
			{jobs.map((job) => (
				<div
					className="flex flex-col justify-between gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center"
					key={job.jobName}
				>
					<div>
						<div className="flex items-center gap-2">
							<p className="font-medium text-sm">{operationLabel(job.operation)}</p>
							<JobStatus status={job.status} />
						</div>
						<p className="mt-1 font-mono text-muted-foreground text-xs">{job.jobName}</p>
						{job.summary ? (
							<p className="mt-1 text-sm">
								{Object.entries(job.summary)
									.map(([key, value]) => `${key}: ${String(value)}`)
									.join(" · ")}
							</p>
						) : null}
						{job.error ? <p className="mt-1 text-danger text-xs">{job.error}</p> : null}
					</div>
					<div className="text-muted-foreground text-xs sm:text-right">
						<p>创建 {formatTimestamp(job.createdAt)}</p>
						{job.completedAt ? <p>完成 {formatTimestamp(job.completedAt)}</p> : null}
					</div>
				</div>
			))}
		</div>
	);
}

function NoticeListSkeleton() {
	return (
		<div className="grid gap-3">
			<Skeleton className="h-14" />
			<Skeleton className="h-14" />
			<Skeleton className="h-14" />
		</div>
	);
}

function isActiveNoticeJobStatus(status: NoticeJob["status"]): boolean {
	return status === "pending" || status === "running";
}

function isTerminalNoticeJobStatus(status: NoticeJob["status"]): boolean {
	return status === "succeeded" || status === "failed";
}

function categoryLabel(category: NoticeSummary["category"]): string {
	return category ? NOTICE_CATEGORY_LABELS[category] : "尚无分类结果";
}
function NoticeStateBadge({ state }: { state: NoticeState }) {
	const labels = {
		needs_classification: "待分类",
		needs_publication: "待发布",
		published: "已发布",
	} as const;
	const tones = {
		needs_classification: "warning",
		needs_publication: "neutral",
		published: "success",
	} as const;
	return <Badge tone={tones[state]}>{labels[state]}</Badge>;
}
function JobStatus({ status }: { status: NoticeJob["status"] }) {
	const labels = {
		failed: "失败",
		pending: "等待中",
		running: "运行中",
		succeeded: "成功",
	} as const;
	const tones = {
		failed: "danger",
		pending: "neutral",
		running: "warning",
		succeeded: "success",
	} as const;
	return <Badge tone={tones[status]}>{labels[status]}</Badge>;
}
function operationLabel(operation: NoticeJobOperation): string {
	return (
		{
			"notice-backfill": "通知回填",
			"notice-classify-missing": "分类缺失通知",
			"notice-classify-one": "分类单条通知",
			"notice-publish-pending": "发布待发布通知",
			"notice-publish-one": "发布单条通知",
			"notice-sync": "同步新通知",
		} as const
	)[operation];
}
