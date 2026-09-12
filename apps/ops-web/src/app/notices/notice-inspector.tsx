import {
	Button,
	Field,
	NativeSelect,
	Skeleton,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@campus-agent/ui";
import {
	NOTICE_CATEGORIES,
	NOTICE_CATEGORY_LABELS,
	type NoticeCategory,
} from "campus-contracts/notices";
import { ExternalLink, MoreHorizontal, RefreshCw, Send, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { NoticeJob, NoticeJobCreate, NoticeSummary } from "../../shared/ops-contract";
import { formatTimestamp } from "../format";
import { ErrorState, InlineError } from "../ops-display";
import { NoticeTransportPeriods } from "../transport-notice-links";
import { getNoticeActionState } from "./notice-actions";
import { NoticeJobDiagnostics } from "./notice-job-diagnostics";
import { NoticeOcrSection } from "./notice-ocr";
import { NoticePreviewPanel } from "./notice-preview";
import type { NoticeJobFamily } from "./notice-status";
import {
	NoticeCategoryBadge,
	NoticeJobStatusBadge,
	NoticeStateBadge,
	noticeJobSummaryLabel,
} from "./notice-status";
import type { PendingNoticeJobSubmission } from "./use-notice-maintenance";

export interface NoticeInspectorProps {
	createJobError: unknown;
	currentNoticeJobs: NoticeJob[];
	currentPendingJobSubmissions: PendingNoticeJobSubmission[];
	detailError: unknown;
	detailPending: boolean;
	dirty: boolean;
	draftCategory: NoticeCategory | "";
	isFamilyBusy: (family: NoticeJobFamily) => boolean;
	mobile?: boolean;
	notice: NoticeSummary | null;
	onDraftCategory: (category: NoticeCategory | "") => void;
	onRetry: () => void;
	onSave: () => void;
	onStartJob: (input: NoticeJobCreate) => void;
	saveError: unknown;
	savePending: boolean;
	saveSucceeded: boolean;
	selectedNoticeId: number | null;
}

export function NoticeInspector(props: NoticeInspectorProps) {
	return <NoticeInspectorContent key={props.selectedNoticeId} {...props} />;
}

function NoticeInspectorContent(props: NoticeInspectorProps) {
	const [tab, setTab] = useState("body");
	const [maintenanceVisited, setMaintenanceVisited] = useState(false);
	const scroll = useRef<HTMLDivElement>(null);
	const positions = useRef<Record<string, number>>({ body: 0, maintenance: 0 });
	useLayoutEffect(() => {
		if (scroll.current) {
			scroll.current.scrollTop = positions.current[tab] ?? 0;
		}
	}, [tab]);
	const changeTab = (next: string) => {
		if (next === tab) {
			return;
		}
		positions.current[tab] = scroll.current?.scrollTop ?? 0;
		if (next === "maintenance") {
			setMaintenanceVisited(true);
		}
		setTab(next);
	};
	const {
		createJobError,
		currentNoticeJobs,
		currentPendingJobSubmissions,
		detailError,
		detailPending,
		dirty,
		draftCategory,
		isFamilyBusy,
		mobile = false,
		notice,
		onDraftCategory,
		onRetry,
		onSave,
		onStartJob,
		saveError,
		savePending,
		saveSucceeded,
		selectedNoticeId,
	} = props;

	if (selectedNoticeId !== null && detailPending && !notice) {
		return <InspectorSkeleton mobile={mobile} />;
	}
	if (!notice) {
		if (detailError) {
			return (
				<div className="px-5 py-5">
					<ErrorState error={detailError} onRetry={onRetry} title="通知详情读取失败" />
				</div>
			);
		}
		return (
			<div className="grid min-h-[30rem] place-items-center px-6 py-12 text-center">
				<div className="grid max-w-xs gap-2">
					<p className="font-medium">选择一条通知</p>
					<p className="text-muted-foreground text-sm">从左侧队列选择通知，阅读正文并维护分类。</p>
				</div>
			</div>
		);
	}

	const actionState = getNoticeActionState({ draftCategory, notice });
	const classifyDisabled = isFamilyBusy("classification");
	const publishDisabled = isFamilyBusy("publication");
	const latestJob = currentNoticeJobs[0];
	const pendingSubmission = currentPendingJobSubmissions[0];

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{mobile ? (
				<div className="border-border border-b px-5 py-4 pr-14">
					<p className="font-semibold">通知详情</p>
				</div>
			) : null}
			<div
				ref={scroll}
				data-notice-scroll
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5"
			>
				<div className="grid gap-6">
					<header className="grid gap-3">
						<div className="flex flex-wrap items-center gap-2">
							<NoticeStateBadge state={notice.state} />
							<NoticeCategoryBadge category={notice.category} />
							<span className="font-mono text-muted-foreground text-xs">#{notice.noticeId}</span>
						</div>
						<h2 className="break-words font-semibold text-xl leading-tight">{notice.title}</h2>
						{detailError ? <InlineError error={detailError} title="详情刷新失败" /> : null}
						{detailPending ? <p className="text-muted-foreground text-xs">正在刷新详情…</p> : null}
					</header>

					<Tabs value={tab} onValueChange={changeTab}>
						<TabsList aria-label="通知详情视图" className="sticky top-0 z-10 bg-card">
							<TabsTrigger value="body">正文</TabsTrigger>
							<TabsTrigger value="maintenance">维护</TabsTrigger>
						</TabsList>
						<TabsContent value="body" forceMount hidden={tab !== "body"}>
							<NoticePreviewPanel noticeId={notice.noticeId} active={tab === "body"} />
						</TabsContent>
						<TabsContent
							value="maintenance"
							{...(maintenanceVisited ? { forceMount: true } : {})}
							hidden={tab !== "maintenance"}
							className="space-y-6"
						>
							<section aria-labelledby="notice-category-editor" className="grid gap-3">
								<div>
									<h3 className="font-medium text-sm" id="notice-category-editor">
										分类
									</h3>
								</div>
								<Field label="通知分类">
									<NativeSelect
										aria-label="通知分类"
										onChange={(event) => onDraftCategory(event.target.value as NoticeCategory | "")}
										value={draftCategory}
									>
										<option value="">请选择分类</option>
										{NOTICE_CATEGORIES.map((value) => (
											<option key={value} value={value}>
												{NOTICE_CATEGORY_LABELS[value]}
											</option>
										))}
									</NativeSelect>
								</Field>
								<p className="text-muted-foreground text-xs">{actionState.saveDescription}</p>
								<Button disabled={savePending || !actionState.canSave} onClick={onSave}>
									保存分类
								</Button>
								{dirty ? (
									<p className="text-warning text-xs" role="status">
										有未保存的分类更改。
									</p>
								) : null}
								{saveError ? <InlineError error={saveError} title="分类保存失败" /> : null}
								{saveSucceeded && !dirty ? (
									<p className="text-success text-xs" role="status">
										分类已保存。
									</p>
								) : null}
							</section>

							<section
								aria-labelledby="notice-actions"
								className="grid gap-3 border-border border-t pt-5"
							>
								<div>
									<h3 className="font-medium text-sm" id="notice-actions">
										下一步
									</h3>
								</div>
								{actionState.primaryAction === "classify" ? (
									<Button
										disabled={classifyDisabled}
										onClick={() =>
											onStartJob({
												noticeId: notice.noticeId,
												operation: "notice-classify-one",
											})
										}
										variant="outline"
									>
										<Sparkles className="size-4" />
										使用模型分类
									</Button>
								) : null}
								{actionState.primaryAction === "publish" ? (
									<Button
										disabled={publishDisabled}
										onClick={() =>
											onStartJob({
												noticeId: notice.noticeId,
												operation: "notice-publish-one",
											})
										}
									>
										<Send className="size-4" />
										发布这条通知
									</Button>
								) : null}
								{actionState.primaryAction === "republish" ? (
									<Button
										disabled={publishDisabled}
										onClick={() =>
											onStartJob({
												noticeId: notice.noticeId,
												operation: "notice-republish-one",
											})
										}
									>
										<RefreshCw className="size-4" />
										重新发布
									</Button>
								) : null}
								{actionState.primaryAction === null ? (
									<p className="rounded-[var(--card-radius)] bg-surface-muted px-3 py-3 text-muted-foreground text-sm">
										这条通知已经发布。修改分类会立即影响学生端可见内容。
									</p>
								) : null}
								{actionState.showReclassify ? (
									<details className="rounded-[var(--card-radius)] border border-border">
										<summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
											<MoreHorizontal aria-hidden="true" className="size-4" />
											更多操作
										</summary>
										<div className="grid gap-2 border-border border-t p-3">
											<Button
												disabled={classifyDisabled}
												onClick={() =>
													onStartJob({
														noticeId: notice.noticeId,
														operation: "notice-classify-one",
													})
												}
												variant="outline"
											>
												<Sparkles className="size-4" />
												重新分类
											</Button>
											<p className="text-muted-foreground text-xs">
												模型结果会直接更新这条通知的分类。
											</p>
										</div>
									</details>
								) : null}
								{pendingSubmission ? (
									<div className="rounded-[var(--card-radius)] border border-border px-3 py-3">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<p className="font-medium text-sm">正在创建单条任务</p>
											<NoticeJobStatusBadge status="pending" />
										</div>
										<p className="mt-1 text-muted-foreground text-xs">
											{pendingSubmission.input.operation === "notice-classify-one"
												? "模型分类"
												: "发布"}{" "}
											· {formatTimestamp(new Date(pendingSubmission.submittedAt).toISOString())}
										</p>
									</div>
								) : latestJob ? (
									<div className="rounded-[var(--card-radius)] border border-border px-3 py-3">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<p className="font-medium text-sm">最近一次单条任务</p>
											<NoticeJobStatusBadge status={latestJob.status} />
										</div>
										<p className="mt-1 text-muted-foreground text-xs">
											{latestJob.operation === "notice-classify-one"
												? "模型分类"
												: latestJob.operation === "notice-republish-one"
													? "重新发布"
													: "发布"}{" "}
											{formatTimestamp(latestJob.createdAt)}
										</p>
										{noticeJobSummaryLabel(latestJob.operation, latestJob.summary) ? (
											<p className="mt-2 text-xs">
												{noticeJobSummaryLabel(latestJob.operation, latestJob.summary)}
											</p>
										) : null}
										<NoticeJobDiagnostics job={latestJob} />
									</div>
								) : null}
								{createJobError ? (
									<InlineError error={createJobError} title="任务启动失败" />
								) : null}
							</section>

							<NoticeTransportPeriods noticeId={notice.noticeId} active={tab === "maintenance"} />
							<section aria-labelledby="notice-source-metadata">
								<h3 className="mb-3 font-medium text-sm" id="notice-source-metadata">
									来源信息
								</h3>
								<dl className="grid gap-3 rounded-[var(--card-radius)] border border-border px-4 py-3 text-sm">
									<MetadataRow label="通知类型" value={notice.noticeType.name} />
									<MetadataRow label="来源组织" value={notice.organization?.name ?? "无组织"} />
									<MetadataRow
										label="发布时间"
										value={
											<time dateTime={notice.releasedAt}>{formatTimestamp(notice.releasedAt)}</time>
										}
									/>
									<MetadataRow
										label="内容形态"
										value={notice.isExternal ? "外链通知" : "站内通知"}
									/>
									{notice.externalUrl ? (
										<MetadataRow
											label="原始链接"
											value={
												<a
													className="inline-flex min-h-11 items-center gap-1 text-link underline underline-offset-4"
													href={notice.externalUrl}
													rel="noreferrer"
													target="_blank"
												>
													打开原始链接
													<ExternalLink aria-hidden="true" className="size-3.5" />
												</a>
											}
										/>
									) : null}
								</dl>
							</section>

							<NoticeOcrSection noticeId={notice.noticeId} active={tab === "maintenance"} />
						</TabsContent>
					</Tabs>
				</div>
			</div>
		</div>
	);
}

function MetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="grid gap-1 border-border border-b pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-start">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="min-w-0 break-words">{value}</dd>
		</div>
	);
}

function InspectorSkeleton({ mobile }: { mobile: boolean }) {
	return (
		<div className="grid gap-5 px-5 py-5">
			{mobile ? <Skeleton className="h-6 w-24" /> : null}
			<Skeleton className="h-5 w-44" />
			<Skeleton className="h-9 w-full" />
			<div className="grid gap-3 rounded-[var(--card-radius)] border border-border p-4">
				<Skeleton className="h-4 w-1/3" />
				<Skeleton className="h-4 w-2/3" />
				<Skeleton className="h-4 w-1/2" />
			</div>
			<Skeleton className="h-11 w-full" />
		</div>
	);
}
