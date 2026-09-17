import type { DiningOpsContentReportRecord, DiningReportReason } from "@campus-agent/dining/domain";
import {
	Badge,
	Button,
	Input,
	NativeSelect,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@campus-agent/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { EyeOff, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { DiningTaskNavigation } from "./dining-navigation";
import { SubmissionPhoto, SubmissionSnapshot } from "./dining-submission-display";
import { formatTimestamp } from "./format";
import {
	fetchDiningReports,
	resolveDiningReports,
	resolveDiningSubmissionReports,
} from "./ops-api/dining";
import { ErrorState, InlineError, PageHeader, PageShell } from "./ops-display";
import { ConfirmAction } from "./ui/alert-dialog";
import { DataTable } from "./ui/data-table";

type ReportStatus = "pending" | "resolved";

export function DiningReportsPage() {
	const queryClient = useQueryClient();
	const [targetType, setTargetType] = useState<"review" | "submission" | "">("");
	const [submissionInput, setSubmissionInput] = useState("");
	const [submissionId, setSubmissionId] = useState("");
	const [status, setStatus] = useState<ReportStatus>("pending");
	const [cursor, setCursor] = useState<string | undefined>();
	const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
	const reports = useQuery({
		placeholderData: keepPreviousData,
		queryFn: ({ signal }) =>
			fetchDiningReports(
				{
					...(cursor ? { cursor } : {}),
					...(submissionId ? { submissionId } : {}),
					...(targetType ? { targetType } : {}),
					limit: 50,
					status,
				},
				{ signal },
			),
		queryKey: ["dining", "reports", cursor, status, targetType, submissionId],
	});
	const resolve = useMutation({
		mutationFn: (input: { resolution: "hide" | "keep"; report: DiningOpsContentReportRecord }) =>
			input.report.target.kind === "review"
				? resolveDiningReports(input.report.target.current.reviewId, input.resolution)
				: resolveDiningSubmissionReports(
						input.report.target.current.submissionId,
						input.report.target.current.revision,
						input.resolution,
					),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["dining", "reports"] }),
				queryClient.invalidateQueries({ queryKey: ["dining", "reviews"] }),
				queryClient.invalidateQueries({ queryKey: ["dining", "submissions"] }),
				queryClient.invalidateQueries({ queryKey: ["dining", "submission"] }),
			]);
		},
	});
	const changeStatus = (value: ReportStatus) => {
		setStatus(value);
		setCursor(undefined);
		setPreviousCursors([]);
	};
	if (!reports.data) {
		return (
			<div className="mx-auto w-full max-w-[1600px]">
				<DiningTaskNavigation />
				{reports.error ? (
					<ErrorState
						error={reports.error}
						onRetry={() => void reports.refetch()}
						title="举报读取失败"
					/>
				) : (
					<PageShell title="举报处理">正在读取举报...</PageShell>
				)}
			</div>
		);
	}
	const reportData = reports.data;
	const renderReportsPanel = (panelStatus: ReportStatus) => (
		<ReportsPanel
			hasNextPage={Boolean(reportData.nextCursor)}
			hasPreviousPage={previousCursors.length > 0}
			isFetching={reports.isFetching}
			onNextPage={() => {
				setPreviousCursors((values) => [...values, cursor]);
				setCursor(reportData.nextCursor ?? undefined);
			}}
			onPreviousPage={() => {
				const previous = [...previousCursors];
				setCursor(previous.pop());
				setPreviousCursors(previous);
			}}
			onResolve={(input) => resolve.mutate(input)}
			reports={reportData}
			resolveError={resolve.error}
			isResolving={resolve.isPending}
			status={panelStatus}
		/>
	);

	return (
		<section className="mx-auto w-full max-w-[1600px]">
			<DiningTaskNavigation />
			<PageHeader
				actions={
					<Button
						aria-label="刷新举报"
						disabled={reports.isFetching}
						onClick={() => void reports.refetch()}
						size="icon"
						variant="outline"
					>
						<RefreshCw className={`size-4 ${reports.isFetching ? "animate-spin" : ""}`} />
					</Button>
				}
				description="核对学生举报，并保留或隐藏相关投稿或评价。一次处理仅关闭同一目标的全部待处理举报。"
				title="举报处理"
			/>

			<form
				className="mb-4 grid gap-3 md:grid-cols-[12rem_minmax(12rem,1fr)_auto] md:items-end"
				onSubmit={(event) => {
					event.preventDefault();
					setSubmissionId(submissionInput.trim());
					setCursor(undefined);
					setPreviousCursors([]);
				}}
			>
				<label className="grid gap-1 text-sm" htmlFor="dining-report-target">
					<span>举报目标</span>
					<NativeSelect
						id="dining-report-target"
						value={targetType}
						onChange={(event) => {
							setTargetType(event.target.value as "review" | "submission" | "");
							setCursor(undefined);
							setPreviousCursors([]);
						}}
					>
						<option value="">全部目标</option>
						<option value="submission">用户投稿</option>
						<option value="review">评价</option>
					</NativeSelect>
				</label>
				<label className="grid gap-1 text-sm" htmlFor="dining-report-submission">
					<span>投稿标识</span>
					<Input
						id="dining-report-submission"
						value={submissionInput}
						onChange={(event) => setSubmissionInput(event.target.value)}
						placeholder="可选：按投稿及其评价筛选"
					/>
				</label>
				<Button type="submit" variant="outline">
					筛选投稿
				</Button>
			</form>
			{reports.error ? (
				<InlineError error={reports.error} title="刷新失败，以下为上次结果" />
			) : null}
			{reports.isPlaceholderData ? (
				<p role="status" className="text-muted-foreground text-sm">
					正在读取新范围，暂时显示上次结果。
				</p>
			) : null}
			<Tabs
				className="mt-5"
				onValueChange={(value) => changeStatus(value as ReportStatus)}
				value={status}
			>
				<TabsList aria-label="举报状态" presentation="segmented">
					<TabsTrigger value="pending">待处理</TabsTrigger>
					<TabsTrigger value="resolved">已处理</TabsTrigger>
				</TabsList>
				<TabsContent className="mt-5" value="pending">
					{status === "pending" ? renderReportsPanel("pending") : null}
				</TabsContent>
				<TabsContent className="mt-5" value="resolved">
					{status === "resolved" ? renderReportsPanel("resolved") : null}
				</TabsContent>
			</Tabs>
		</section>
	);
}

export function ReportsPanel({
	hasNextPage,
	hasPreviousPage,
	isFetching,
	isResolving,
	onNextPage,
	onPreviousPage,
	onResolve,
	reports,
	resolveError,
	status,
}: {
	hasNextPage: boolean;
	hasPreviousPage: boolean;
	isFetching: boolean;
	isResolving: boolean;
	onNextPage: () => void;
	onPreviousPage: () => void;
	onResolve: (input: { resolution: "hide" | "keep"; report: DiningOpsContentReportRecord }) => void;
	reports: Awaited<ReturnType<typeof fetchDiningReports>>;
	resolveError: unknown;
	status: ReportStatus;
}) {
	const actions = (report: DiningOpsContentReportRecord) => (
		<ReportActions report={report} isResolving={isResolving || isFetching} onResolve={onResolve} />
	);
	return (
		<>
			{resolveError ? (
				<div className="mb-4">
					<InlineError error={resolveError} title="举报处理失败" />
				</div>
			) : null}
			{reports.items.length === 0 ? (
				<p className="border-border border-y py-10 text-center text-muted-foreground text-sm">
					{status === "pending" ? "当前没有待处理举报。" : "当前没有已处理举报。"}
				</p>
			) : (
				<>
					<div className="hidden md:block">
						<DataTable
							caption={status === "pending" ? "待处理举报" : "已处理举报"}
							columns={[
								{
									header: "举报内容",
									rowHeader: true,
									cell: (report) => <ReportDescription report={report} />,
								},
								{ header: "被举报内容", cell: (report) => <ReportContent report={report} /> },
								{ header: "举报人 / 时间", cell: (report) => <ReportAuthor report={report} /> },
								{ header: "处理", cell: actions },
							]}
							data={reports.items}
							minWidth="1120px"
							rowKey={(report) => `${report.target.kind}:${report.reportId}`}
							stickyFirstColumn
							stickyLastColumn
						/>
					</div>
					<ul className="divide-y divide-border border-border border-y md:hidden">
						{reports.items.map((report) => (
							<li
								key={`${report.target.kind}:${report.reportId}`}
								className="min-w-0 space-y-4 py-5"
							>
								<ReportDescription report={report} />
								<ReportContent report={report} />
								<ReportAuthor report={report} />
								{actions(report)}
							</li>
						))}
					</ul>
				</>
			)}
			<div className="mt-4 flex justify-end gap-2">
				<Button
					disabled={!hasPreviousPage || isFetching}
					onClick={onPreviousPage}
					variant="outline"
				>
					上一页
				</Button>
				<Button disabled={!hasNextPage || isFetching} onClick={onNextPage} variant="outline">
					下一页
				</Button>
			</div>
		</>
	);
}

function ReportDescription({ report }: { report: DiningOpsContentReportRecord }) {
	return (
		<div className="max-w-sm">
			<Badge tone={reasonTone(report.reason)}>{reasonLabel(report.reason)}</Badge>
			<p className="mt-2 whitespace-pre-wrap break-words text-sm">
				{report.details || "无可用补充说明"}
			</p>
		</div>
	);
}

function ReportAuthor({ report }: { report: DiningOpsContentReportRecord }) {
	return (
		<div className="text-xs">
			<p className="break-all font-mono">举报人：{report.reporterUserId ?? "身份已清理"}</p>
			<p className="mt-1 text-muted-foreground">{formatTimestamp(report.createdAt)}</p>
		</div>
	);
}

function ReportContent({ report }: { report: DiningOpsContentReportRecord }) {
	const target = report.target;
	return (
		<div className="min-w-0 max-w-xl space-y-2">
			<p className="font-medium">{reportTargetName(report)}</p>
			<p className="whitespace-pre-wrap break-words">{reportCurrentBody(report)}</p>
			<p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">
				举报时：{reportOriginalBody(report)}
			</p>
			<div className="flex flex-wrap gap-2">
				{reviewState(report)}
				{target.targetRevision !== null &&
				target.targetRevision !== target.current.contentRevision ? (
					<Badge tone="neutral">内容已变更</Badge>
				) : null}
			</div>
			{target.kind === "submission" ? (
				<>
					{"photo" in target.current && target.current.photo ? (
						<SubmissionPhoto
							key={target.current.photo.photoId}
							photo={target.current.photo}
							label="被举报投稿当前照片"
						/>
					) : null}
					{target.reported.replayable && target.reported.photo ? (
						<details>
							<summary className="min-h-11 cursor-pointer py-3 text-sm">查看举报时照片</summary>
							<SubmissionSnapshot snapshot={target.reported} label="举报时内容" />
						</details>
					) : null}
					<Link
						className="inline-flex min-h-11 items-center text-sm text-link hover:underline"
						to="/dining/submissions/$submissionId"
						params={{ submissionId: target.current.submissionId }}
					>
						查看投稿详情与历史
					</Link>
				</>
			) : target.current.targetKind === "submission" ? (
				<Link
					className="inline-flex min-h-11 items-center text-sm text-link hover:underline"
					to="/dining/submissions/$submissionId"
					params={{ submissionId: target.current.submissionId }}
				>
					查看所属投稿
				</Link>
			) : null}
		</div>
	);
}

function ReportActions({
	report,
	isResolving,
	onResolve,
}: {
	report: DiningOpsContentReportRecord;
	isResolving: boolean;
	onResolve: (input: { report: DiningOpsContentReportRecord; resolution: "keep" | "hide" }) => void;
}) {
	if (report.resolution) {
		return (
			<div className="space-y-2">
				<Badge tone={report.resolution === "hide" ? "warning" : "success"}>
					{report.resolution === "hide" ? "已隐藏" : "已保留"}
				</Badge>
				<p className="text-muted-foreground text-xs">
					{report.resolvedAt ? formatTimestamp(report.resolvedAt) : ""}
				</p>
				<p className="break-all text-muted-foreground text-xs">
					处理人：{report.resolvedBy ?? "身份已清理"}
				</p>
			</div>
		);
	}
	const target = report.target;
	const purged = target.kind === "submission" && target.current.status === "purged";
	const canHide =
		target.kind === "review" ||
		((target.current.status === "public" || target.current.status === "hidden") &&
			!target.current.accountDeletingAt);
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-2">
				{(["keep", "hide"] as const).map((resolution) => {
					const label = `${resolution === "keep" ? "保留" : "隐藏"}${target.kind === "review" ? "评价" : "投稿"}`;
					return (
						<ConfirmAction
							key={resolution}
							title={`${resolution === "keep" ? "保留" : "隐藏"}这条${target.kind === "review" ? "评价" : "投稿"}？`}
							confirmLabel={label}
							confirmVariant={resolution === "keep" ? "primary" : "destructive"}
							description={
								resolution === "keep"
									? "保持目标当前状态，并仅关闭这个目标的全部待处理举报。不会恢复内容或采纳为正式菜品。"
									: "从学生端隐藏这个目标，并仅关闭它的全部待处理举报。父稿与评价的举报分别处理。"
							}
							onConfirm={() => onResolve({ resolution, report })}
							trigger={
								<Button
									disabled={isResolving || purged || (resolution === "hide" && !canHide)}
									variant={resolution === "keep" ? "outline" : "destructive"}
								>
									{resolution === "keep" ? (
										<ShieldCheck className="size-4" />
									) : (
										<EyeOff className="size-4" />
									)}
									{resolution === "keep" ? "保留" : "隐藏"}
								</Button>
							}
						/>
					);
				})}
			</div>
			{purged ? (
				<p className="text-muted-foreground text-xs">目标内容已清理，不可操作。</p>
			) : canHide ? null : (
				<p className="text-muted-foreground text-xs">内容已撤下；保留只关闭举报，不恢复内容。</p>
			)}
		</div>
	);
}

function reasonLabel(reason: DiningReportReason): string {
	return {
		inappropriate: "不当内容",
		other: "其他",
		privacy: "隐私问题",
		spam: "垃圾信息",
	}[reason];
}

function reasonTone(reason: DiningReportReason): "danger" | "neutral" | "warning" {
	if (reason === "privacy") {
		return "danger";
	}
	if (reason === "inappropriate") {
		return "warning";
	}
	return "neutral";
}

function reviewState(report: DiningOpsContentReportRecord) {
	if (report.target.kind === "submission") {
		const submission = report.target.current;
		const labels = {
			public: "公开",
			hidden: "已隐藏",
			deleted: "已删除",
			expired: "已过期",
			purged: "已清理",
		};
		const label =
			submission.status !== "purged" && submission.accountDeletingAt
				? "注销撤下"
				: submission.status === "public" && !submission.windowAvailable
					? "窗口未公开"
					: labels[submission.status];
		return <Badge tone="neutral">投稿：{label}</Badge>;
	}
	if (report.target.current.deletedAt) {
		return <Badge tone="neutral">评价已删除</Badge>;
	}
	if (report.target.current.hiddenAt) {
		return <Badge tone="warning">评价已隐藏</Badge>;
	}
	return <Badge tone="success">评价未隐藏</Badge>;
}

function reportTargetName(report: DiningOpsContentReportRecord) {
	if (report.target.kind === "submission") {
		return "用户投稿";
	}
	const review = report.target.current;
	return review.targetKind === "menu_item"
		? review.menuItemName
		: `投稿下评价：${review.submissionName ?? "正文已清理"}`;
}

function reportCurrentBody(report: DiningOpsContentReportRecord) {
	const target = report.target;
	if (target.kind === "review") {
		return target.current.body ?? "当前正文已清理";
	}
	return "name" in target.current
		? [target.current.name, target.current.priceText].filter(Boolean).join(" · ")
		: "当前正文已到期或清理";
}

function reportOriginalBody(report: DiningOpsContentReportRecord) {
	const target = report.target;
	if (target.kind === "review") {
		return target.reported.replayable ? target.reported.body : "历史不可回放";
	}
	return target.reported.replayable
		? [target.reported.name, target.reported.priceText].filter(Boolean).join(" · ")
		: "历史不可回放";
}
