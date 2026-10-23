import type { DiningOpsContentReportRecord, DiningReportReason } from "@campus-agent/dining/domain";
import {
	ActionGroup,
	Badge,
	Button,
	ConfirmDialog,
	Disclosure,
	DisclosureSummary,
	Field,
	Input,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	StateMessage,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { EyeOff, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { DiningTaskNavigation } from "./dining-navigation";
import type { DiningReportsSearch } from "./dining-report-navigation";
import { SubmissionPhoto, SubmissionSnapshot } from "./dining-submission-display";
import { formatTimestamp } from "./format";
import {
	fetchDiningReports,
	resolveDiningReports,
	resolveDiningSubmissionReports,
} from "./ops-api/dining";
import { ErrorState, InlineError, PageHeader } from "./ops-display";
import { FilterSelect } from "./ui/filter-select";
import { useConfirmCommand } from "./use-confirm-command";

type ReportStatus = "pending" | "resolved";

export function DiningReportsPage({ search = {} }: { search?: DiningReportsSearch }) {
	const queryClient = useQueryClient();
	const navigate = useNavigate({ from: "/dining/reports" });
	const returnTo = useRouterState({ select: (state) => state.location.href });
	const { targetType = "", submissionId = "", status = "pending", cursor } = search;
	const [submissionInput, setSubmissionInput] = useState(submissionId);
	useEffect(() => setSubmissionInput(submissionId), [submissionId]);
	const previousCursors = decodeCursorHistory(search.history);
	const filters = {
		targetType: targetType || undefined,
		submissionId: submissionId || undefined,
		status,
	};
	const changeFilters = (next: DiningReportsSearch) =>
		void navigate({ search: { ...filters, ...next } });
	const reports = useQuery({
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
	const renderReportsPanel = (panelStatus: ReportStatus) =>
		reports.data ? (
			<ReportsPanel
				hasNextPage={Boolean(reports.data.nextCursor)}
				hasPreviousPage={previousCursors.length > 0}
				isFetching={reports.isFetching}
				onNextPage={() =>
					changeFilters({
						cursor: reports.data?.nextCursor ?? undefined,
						history: encodeCursorHistory([...previousCursors, cursor ?? ""]),
					})
				}
				onPreviousPage={() => {
					const previous = [...previousCursors];
					changeFilters({
						cursor: previous.pop() || undefined,
						history: encodeCursorHistory(previous),
					});
				}}
				onResolve={(input) => resolve.mutateAsync(input)}
				reports={reports.data}
				resolveError={resolve.error}
				isResolving={resolve.isPending}
				status={panelStatus}
				selection={{
					key: search.selected ?? null,
					onChange: (selected) => {
						resolve.reset();
						void navigate({
							search: { ...search, selected: selected ?? undefined },
							replace: true,
							resetScroll: false,
						});
					},
				}}
				returnTo={returnTo}
			/>
		) : reports.error ? (
			<ErrorState
				error={reports.error}
				onRetry={() => void reports.refetch()}
				title="举报读取失败"
			/>
		) : (
			<StateMessage role="status" description="正在读取举报..." />
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
						variant="ghost"
					>
						<RefreshCw className={`size-4 ${reports.isFetching ? "animate-spin" : ""}`} />
					</Button>
				}
				description="核对学生举报，并保留或隐藏相关投稿或评价。一次处理仅关闭同一目标的全部待处理举报。"
				title="举报处理"
			/>

			<form
				className="ops-filter-bar mb-4 grid gap-3 md:grid-cols-[12rem_minmax(12rem,24rem)_auto] md:justify-start md:items-end"
				onSubmit={(event) => {
					event.preventDefault();
					changeFilters({ submissionId: submissionInput.trim() || undefined });
				}}
			>
				<Field label="举报目标">
					<FilterSelect
						id="dining-report-target"
						value={targetType}
						onValueChange={(nextValue) => {
							changeFilters({
								targetType: (nextValue || undefined) as DiningReportsSearch["targetType"],
							});
						}}
						options={[
							{ value: "", label: "全部目标" },
							{ value: "submission", label: "用户投稿" },
							{ value: "review", label: "评价" },
						]}
					/>
				</Field>
				<Field label="投稿标识">
					<Input
						id="dining-report-submission"
						value={submissionInput}
						onChange={(event) => setSubmissionInput(event.target.value)}
						placeholder="可选：按投稿及其评价筛选"
					/>
				</Field>
				<Button type="submit" variant="primary">
					筛选投稿
				</Button>
			</form>
			{reports.error && reports.data ? (
				<InlineError error={reports.error} title="刷新失败，以下为上次结果" />
			) : null}
			<Tabs
				className="mt-5"
				onValueChange={(value) => changeFilters({ status: value as ReportStatus })}
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
	selection,
	returnTo,
}: {
	hasNextPage: boolean;
	hasPreviousPage: boolean;
	isFetching: boolean;
	isResolving: boolean;
	onNextPage: () => void;
	onPreviousPage: () => void;
	onResolve: (input: {
		resolution: "hide" | "keep";
		report: DiningOpsContentReportRecord;
	}) => Promise<unknown>;
	reports: Awaited<ReturnType<typeof fetchDiningReports>>;
	resolveError: unknown;
	status: ReportStatus;
	selection?: { key: string | null; onChange: (key: string | null) => void };
	returnTo?: string;
}) {
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const panelRef = useRef<HTMLElement | null>(null);
	const [localKey, setLocalKey] = useState<string | null>(null);
	const selectedKey = selection ? selection.key : localKey;
	const setSelectedKey = selection ? selection.onChange : setLocalKey;
	const selectedIndex = reports.items.findIndex((report) => reportKey(report) === selectedKey);
	const selected = reports.items[selectedIndex];
	useEffect(() => {
		if (selectedIndex >= 0) {
			triggerRef.current =
				panelRef.current?.querySelectorAll<HTMLButtonElement>("[data-report-trigger]")[
					selectedIndex
				] ?? null;
		}
	}, [selectedIndex]);

	const selectReport = (index: number) => {
		const report = reports.items[index];
		if (report) {
			triggerRef.current =
				panelRef.current?.querySelectorAll<HTMLButtonElement>("[data-report-trigger]")[index] ??
				null;
			setSelectedKey(reportKey(report));
		}
	};

	return (
		<section
			ref={panelRef}
			tabIndex={-1}
			className="min-w-0 focus:outline-none"
			aria-label="举报队列"
		>
			{resolveError ? (
				<div className="mb-4">
					<InlineError error={resolveError} title="举报处理失败" />
				</div>
			) : null}
			{reports.items.length === 0 ? (
				<StateMessage
					description={status === "pending" ? "当前没有待处理举报。" : "当前没有已处理举报。"}
				/>
			) : (
				<ul
					aria-label={status === "pending" ? "待处理举报" : "已处理举报"}
					className="divide-y divide-border rounded-lg border border-border bg-background"
				>
					{reports.items.map((report) => (
						<li key={`${report.target.kind}:${report.reportId}`} className="min-w-0">
							<Button
								variant="ghost"
								data-report-trigger
								type="button"
								className="grid h-auto w-full min-w-0 gap-2 whitespace-normal rounded-none px-4 py-4 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto]"
								onClick={(event) => {
									triggerRef.current = event.currentTarget;
									setSelectedKey(reportKey(report));
								}}
							>
								<div className="min-w-0 space-y-2">
									<div className="flex flex-wrap items-center gap-2">
										<Badge tone={reasonTone(report.reason)}>{reasonLabel(report.reason)}</Badge>
										<span className="text-xs text-muted-foreground">
											{report.target.kind === "submission" ? "用户投稿" : "评价"}
										</span>
										{report.resolution ? (
											<Badge tone="neutral">
												{report.resolution === "hide" ? "已隐藏" : "已保留"}
											</Badge>
										) : null}
									</div>
									<p className="line-clamp-2 break-words text-sm font-medium">
										{reportCurrentBody(report)}
									</p>
									<p className="line-clamp-1 break-words text-xs text-muted-foreground">
										{report.details || "无可用补充说明"}
									</p>
								</div>
								<div className="flex items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-col sm:items-end sm:justify-center">
									<time>{formatTimestamp(report.createdAt)}</time>
									<span className="text-link">查看举报详情</span>
								</div>
							</Button>
						</li>
					))}
				</ul>
			)}
			<Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedKey(null)}>
				<SheetContent
					className="flex w-full flex-col overflow-hidden p-0 sm:w-[min(42rem,90vw)]"
					closeLabel="关闭举报详情"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						(triggerRef.current?.isConnected ? triggerRef.current : panelRef.current)?.focus();
					}}
				>
					<SheetHeader className="shrink-0 border-b border-border p-5 pr-16">
						<SheetTitle>举报详情</SheetTitle>
						<SheetDescription>{selected ? reportTargetName(selected) : ""}</SheetDescription>
						{selected ? (
							<nav aria-label="逐条查看举报" className="flex flex-wrap items-center gap-2 pt-2">
								<Button
									size="sm"
									variant="ghost"
									disabled={selectedIndex <= 0 || isResolving}
									onClick={() => selectReport(selectedIndex - 1)}
								>
									上一条
								</Button>
								<span className="text-xs text-muted-foreground">
									本页 {selectedIndex + 1} / {reports.items.length}
								</span>
								<Button
									size="sm"
									variant="ghost"
									disabled={selectedIndex >= reports.items.length - 1 || isResolving}
									onClick={() => selectReport(selectedIndex + 1)}
								>
									下一条
								</Button>
							</nav>
						) : null}
					</SheetHeader>
					{selected ? (
						<>
							<div
								key={reportKey(selected)}
								className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5"
							>
								<ReportDescription report={selected} />
								<ReportAuthor report={selected} />
								<ReportContent report={selected} returnTo={returnTo} />
								{resolveError ? <InlineError error={resolveError} title="举报处理失败" /> : null}
							</div>
							<div className="shrink-0 border-t border-border bg-background p-4">
								<ReportActions
									key={`${selected.target.kind}:${selected.reportId}`}
									report={selected}
									isResolving={isResolving || isFetching}
									onResolve={async (input) => {
										await onResolve(input);
										setSelectedKey(null);
									}}
								/>
							</div>
						</>
					) : null}
				</SheetContent>
			</Sheet>
			<ActionGroup className="mt-4 justify-end">
				<Button disabled={!hasPreviousPage || isFetching} onClick={onPreviousPage} variant="ghost">
					上一页
				</Button>
				<Button disabled={!hasNextPage || isFetching} onClick={onNextPage} variant="ghost">
					下一页
				</Button>
			</ActionGroup>
		</section>
	);
}

function reportKey(report: DiningOpsContentReportRecord) {
	return `${report.target.kind}:${report.reportId}`;
}

function ReportDescription({ report }: { report: DiningOpsContentReportRecord }) {
	return (
		<div className="min-w-0">
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

function ReportContent({
	report,
	returnTo,
}: {
	report: DiningOpsContentReportRecord;
	returnTo?: string | undefined;
}) {
	const target = report.target;
	return (
		<div className="min-w-0 max-w-xl space-y-2">
			<p className="font-medium">{reportTargetName(report)}</p>
			<p className="whitespace-pre-wrap break-words">{reportCurrentBody(report)}</p>
			<Disclosure
				open={
					target.targetRevision === null || target.targetRevision !== target.current.contentRevision
				}
			>
				<DisclosureSummary>举报时内容</DisclosureSummary>
				<p className="whitespace-pre-wrap break-words py-3 text-sm text-muted-foreground">
					举报时：{reportOriginalBody(report)}
				</p>
				{target.kind === "submission" && target.reported.replayable && target.reported.photo ? (
					<SubmissionSnapshot snapshot={target.reported} label="举报时内容" />
				) : null}
			</Disclosure>
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
					<Link
						className="inline-flex min-h-11 items-center text-sm text-link hover:underline"
						to="/dining/submissions/$submissionId"
						params={{ submissionId: target.current.submissionId }}
						search={{ from: returnTo }}
					>
						查看投稿详情与历史
					</Link>
				</>
			) : target.current.targetKind === "submission" ? (
				<Link
					className="inline-flex min-h-11 items-center text-sm text-link hover:underline"
					to="/dining/submissions/$submissionId"
					params={{ submissionId: target.current.submissionId }}
					search={{ from: returnTo }}
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
	onResolve: (input: {
		report: DiningOpsContentReportRecord;
		resolution: "keep" | "hide";
	}) => Promise<unknown>;
}) {
	const confirmCommand = useConfirmCommand();

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
						<ConfirmDialog
							key={resolution}
							title={`${resolution === "keep" ? "保留" : "隐藏"}这条${target.kind === "review" ? "评价" : "投稿"}？`}
							confirmLabel={label}
							confirmVariant={resolution === "keep" ? "primary" : "destructive"}
							description={
								resolution === "keep"
									? "保持目标当前状态，并仅关闭这个目标的全部待处理举报。不会恢复内容或采纳为正式菜品。"
									: "从学生端隐藏这个目标，并仅关闭它的全部待处理举报。父稿与评价的举报分别处理。"
							}
							{...confirmCommand(resolution, () => onResolve({ resolution, report }))}
							trigger={
								<Button
									disabled={isResolving || purged || (resolution === "hide" && !canHide)}
									variant="secondary"
								>
									{resolution === "keep" ? (
										<ShieldCheck className="size-4" />
									) : (
										<EyeOff className="size-4" />
									)}
									{label}并处理举报
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
