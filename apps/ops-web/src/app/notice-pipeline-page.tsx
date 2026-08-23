import {
	Badge,
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Field,
	Input,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseZap, RefreshCw, Send, Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import type {
	NoticePipelineJob,
	NoticePipelineJobCreate,
	NoticePipelineOperation,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { createNoticePipelineJob, fetchNoticePipelineJobs } from "./ops-api/notice-pipeline";
import { ErrorState, InlineError, PageHeader } from "./ops-display";

const queryKey = ["notice-pipeline-jobs"] as const;

export function NoticePipelinePage() {
	const queryClient = useQueryClient();
	const jobs = useQuery({
		queryFn: ({ signal }) => fetchNoticePipelineJobs({ signal }),
		queryKey,
		refetchInterval: (query) =>
			query.state.data?.jobs.some((job) => job.status === "pending" || job.status === "running")
				? 3_000
				: false,
	});
	const create = useMutation({
		mutationFn: createNoticePipelineJob,
		onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
	});

	return (
		<section>
			<PageHeader
				description="从现有通知任务模板启动一次采集、分类或发布，并查看近期执行结果。"
				title="通知管线"
			/>
			<div className="grid gap-4 xl:grid-cols-3">
				<OperationCard
					description="增量采集新通知，或从指定日期回填历史通知。"
					disabled={create.isPending}
					icon={DatabaseZap}
					onCreate={(input) => create.mutate(input)}
					title="采集"
					type="collection"
				/>
				<OperationCard
					description="分类所有缺失项，或重新分类一条指定通知。"
					disabled={create.isPending}
					icon={Sparkles}
					onCreate={(input) => create.mutate(input)}
					title="分类"
					type="classification"
				/>
				<OperationCard
					description="将已采集且已分类的通知写入在线通知目录。"
					disabled={create.isPending}
					icon={Send}
					onCreate={(input) => create.mutate(input)}
					title="发布"
					type="publication"
				/>
			</div>
			{create.isError ? (
				<div className="mt-4">
					<InlineError error={create.error} title="任务启动失败" />
				</div>
			) : null}
			<div className="mt-6">
				<div className="mb-3 flex items-center justify-between gap-3">
					<h2 className="font-semibold text-foreground text-lg">近期任务</h2>
					<Button
						aria-label="刷新任务"
						disabled={jobs.isFetching}
						onClick={() => jobs.refetch()}
						variant="outline"
					>
						<RefreshCw className={jobs.isFetching ? "size-4 animate-spin" : "size-4"} />
						刷新
					</Button>
				</div>
				{jobs.isPending ? <p className="text-muted-foreground text-sm">正在读取任务...</p> : null}
				{jobs.isError && !jobs.data ? (
					<ErrorState error={jobs.error} onRetry={() => jobs.refetch()} title="任务读取失败" />
				) : null}
				{jobs.data ? <JobList jobs={jobs.data.jobs} /> : null}
			</div>
		</section>
	);
}

function OperationCard({
	description,
	disabled,
	icon: Icon,
	onCreate,
	title,
	type,
}: {
	description: string;
	disabled: boolean;
	icon: typeof DatabaseZap;
	onCreate: (input: NoticePipelineJobCreate) => void;
	title: string;
	type: "collection" | "classification" | "publication";
}) {
	const [value, setValue] = useState(type === "collection" ? "" : "");
	const submitOne = (event: FormEvent) => {
		event.preventDefault();
		if (type === "collection") {
			onCreate({ operation: "notice-backfill", startDate: value });
		} else {
			const noticeId = Number(value);
			onCreate({
				noticeId,
				operation: type === "classification" ? "notice-classify-one" : "notice-publish-one",
			});
		}
	};
	const allOperation: NoticePipelineOperation =
		type === "collection"
			? "notice-sync"
			: type === "classification"
				? "notice-classify-missing"
				: "notice-publish-all";
	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center gap-2">
					<Icon className="size-5 text-muted-foreground" />
					<CardTitle>{title}</CardTitle>
				</div>
				<p className="text-muted-foreground text-sm">{description}</p>
			</CardHeader>
			<CardContent className="grid gap-4">
				<Button
					disabled={disabled}
					onClick={() => onCreate({ operation: allOperation } as NoticePipelineJobCreate)}
				>
					{type === "collection"
						? "同步新通知"
						: type === "classification"
							? "分类缺失通知"
							: "发布全部通知"}
				</Button>
				<form className="grid gap-3 border-border border-t pt-4" onSubmit={submitOne}>
					<Field label={type === "collection" ? "回填起始日期" : "通知 ID"}>
						<Input
							aria-label={type === "collection" ? "回填起始日期" : `${title}通知 ID`}
							min={type === "collection" ? undefined : 1}
							onChange={(event) => setValue(event.target.value)}
							required
							type={type === "collection" ? "date" : "number"}
							value={value}
						/>
					</Field>
					<Button disabled={disabled || !value} type="submit" variant="outline">
						{type === "collection"
							? "开始回填"
							: type === "classification"
								? "分类这一条"
								: "发布这一条"}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

function JobList({ jobs }: { jobs: NoticePipelineJob[] }) {
	if (jobs.length === 0) {
		return (
			<p className="rounded-md border border-border p-5 text-muted-foreground text-sm">
				暂无由 Ops Web 启动的通知任务。
			</p>
		);
	}
	return (
		<div className="grid gap-3">
			{jobs.map((job) => (
				<JobRow job={job} key={job.jobName} />
			))}
		</div>
	);
}

function JobRow({ job }: { job: NoticePipelineJob }) {
	return (
		<div className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_auto]">
			<div className="min-w-0">
				<div className="flex flex-wrap items-center gap-2">
					<p className="truncate font-medium text-foreground" title={job.jobName}>
						{operationLabel(job.operation)}
					</p>
					<JobStatus status={job.status} />
				</div>
				<p className="mt-1 truncate font-mono text-muted-foreground text-xs" title={job.jobName}>
					{job.jobName}
				</p>
				{job.summary ? (
					<p className="mt-2 text-foreground text-sm">
						{Object.entries(job.summary)
							.map(([key, value]) => `${key}: ${String(value)}`)
							.join(" · ")}
					</p>
				) : null}
				{job.error ? <p className="mt-2 text-danger text-sm">{job.error}</p> : null}
			</div>
			<div className="text-muted-foreground text-xs md:text-right">
				<p>创建 {formatTimestamp(job.createdAt)}</p>
				{job.completedAt ? <p className="mt-1">完成 {formatTimestamp(job.completedAt)}</p> : null}
			</div>
		</div>
	);
}

function JobStatus({ status }: { status: NoticePipelineJob["status"] }) {
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

function operationLabel(operation: NoticePipelineOperation): string {
	return (
		{
			"notice-backfill": "通知回填",
			"notice-classify-missing": "分类缺失通知",
			"notice-classify-one": "分类单条通知",
			"notice-publish-all": "发布全部通知",
			"notice-publish-one": "发布单条通知",
			"notice-sync": "同步新通知",
		} as const
	)[operation];
}
