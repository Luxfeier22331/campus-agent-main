import type { DiningOpsReportRecord, DiningReportReason } from "@campus-agent/dining/domain";
import { Badge, Button, cn } from "@campus-agent/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { DiningTaskNavigation } from "./dining-navigation";
import { formatTimestamp } from "./format";
import { fetchDiningReports, resolveDiningReports } from "./ops-api-client";
import { ErrorState, InlineError, PageHeader, PageShell } from "./ops-display";
import { ConfirmAction } from "./ui/alert-dialog";
import { DataTable } from "./ui/data-table";

type ReportStatus = "pending" | "resolved";

export function DiningReportsPage() {
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<ReportStatus>("pending");
	const [cursor, setCursor] = useState<string | undefined>();
	const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
	const reports = useQuery({
		placeholderData: keepPreviousData,
		queryFn: ({ signal }) => fetchDiningReports({ cursor, limit: 50, status }, { signal }),
		queryKey: ["dining", "reports", cursor, status],
	});
	const resolve = useMutation({
		mutationFn: (input: { resolution: "hide" | "keep"; reviewId: string }) =>
			resolveDiningReports(input.reviewId, input.resolution),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["dining", "reports"] }),
				queryClient.invalidateQueries({ queryKey: ["dining", "reviews"] }),
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
				description="核对学生举报，并保留或隐藏相关评价。一次处理会关闭该评价的全部待处理举报。"
				title="举报处理"
			/>

			<fieldset className="mb-4 inline-flex rounded-md border border-input bg-background p-1">
				<legend className="sr-only">举报状态</legend>
				{(["pending", "resolved"] as const).map((value) => (
					<Button
						aria-pressed={status === value}
						className={cn("min-h-9 border-0 px-3 py-1", status !== value && "bg-transparent")}
						key={value}
						onClick={() => changeStatus(value)}
						variant={status === value ? "primary" : "ghost"}
					>
						{value === "pending" ? "待处理" : "已处理"}
					</Button>
				))}
			</fieldset>

			{resolve.error ? (
				<div className="mb-4">
					<InlineError error={resolve.error} title="举报处理失败" />
				</div>
			) : null}

			{reports.data.items.length === 0 ? (
				<div className="border-border border-y py-10 text-center text-muted-foreground text-sm">
					{status === "pending" ? "当前没有待处理举报。" : "当前没有已处理举报。"}
				</div>
			) : (
				<DataTable
					caption={status === "pending" ? "待处理举报" : "已处理举报"}
					columns={[
						{
							cell: (report) => (
								<div className="max-w-sm">
									<Badge tone={reasonTone(report.reason)}>{reasonLabel(report.reason)}</Badge>
									<p className="mt-2 whitespace-pre-wrap text-foreground text-sm">
										{report.details || "未补充说明"}
									</p>
								</div>
							),
							header: "举报内容",
							rowHeader: true,
						},
						{
							cell: (report) => (
								<div className="max-w-xl">
									<p className="font-medium">{report.review.menuItemName}</p>
									<p className="mt-1 line-clamp-4 whitespace-pre-wrap text-foreground">
										{report.review.body}
									</p>
									<div className="mt-2 flex flex-wrap gap-2">
										{reviewState(report)}
										{report.review.editedAt ? <Badge tone="neutral">已编辑</Badge> : null}
									</div>
								</div>
							),
							header: "相关评价",
						},
						{
							cell: (report) => (
								<div>
									<p className="font-mono text-xs">{report.reporterUserId}</p>
									<p className="mt-1 text-muted-foreground text-xs">
										{formatTimestamp(report.createdAt)}
									</p>
								</div>
							),
							header: "举报人 / 时间",
						},
						{
							cell: (report) =>
								report.resolution ? (
									<div>
										<Badge tone={report.resolution === "hide" ? "warning" : "success"}>
											{report.resolution === "hide" ? "已隐藏" : "已保留"}
										</Badge>
										<p className="mt-2 text-muted-foreground text-xs">
											{report.resolvedAt ? formatTimestamp(report.resolvedAt) : ""}
										</p>
									</div>
								) : (
									<div className="flex flex-wrap justify-end gap-2">
										<ConfirmAction
											confirmLabel="保留评价"
											confirmVariant="primary"
											description="评价保持当前公开状态，并关闭该评价的全部待处理举报。"
											onConfirm={() =>
												resolve.mutate({ resolution: "keep", reviewId: report.review.reviewId })
											}
											title="保留这条评价？"
											trigger={
												<Button disabled={resolve.isPending} variant="outline">
													<ShieldCheck className="size-4" />
													保留
												</Button>
											}
										/>
										<ConfirmAction
											confirmLabel="隐藏评价"
											description="评价会从学生端隐藏，并关闭该评价的全部待处理举报。"
											onConfirm={() =>
												resolve.mutate({ resolution: "hide", reviewId: report.review.reviewId })
											}
											title="隐藏这条评价？"
											trigger={
												<Button disabled={resolve.isPending} variant="destructive">
													<EyeOff className="size-4" />
													隐藏
												</Button>
											}
										/>
									</div>
								),
							header: "处理",
						},
					]}
					data={reports.data.items}
					minWidth="1120px"
					rowKey={(report) => report.reportId}
					stickyFirstColumn
					stickyLastColumn
				/>
			)}

			<div className="mt-4 flex justify-end gap-2">
				<Button
					disabled={previousCursors.length === 0 || reports.isFetching}
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
					disabled={!reports.data.nextCursor || reports.isFetching}
					onClick={() => {
						setPreviousCursors((values) => [...values, cursor]);
						setCursor(reports.data?.nextCursor ?? undefined);
					}}
					variant="outline"
				>
					下一页
				</Button>
			</div>
		</section>
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

function reviewState(report: DiningOpsReportRecord) {
	if (report.review.deletedAt) {
		return <Badge tone="neutral">评价已删除</Badge>;
	}
	if (report.review.hiddenAt) {
		return <Badge tone="warning">评价已隐藏</Badge>;
	}
	return <Badge tone="success">评价公开</Badge>;
}
