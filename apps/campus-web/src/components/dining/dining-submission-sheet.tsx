import type {
	DiningMySubmission,
	DiningReportReason,
	DiningSubmission,
} from "@campus-agent/dining/domain";
import {
	ActionGroup,
	Button,
	ConfirmDialog,
	Field,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	StateMessage,
	Textarea,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { deleteDiningSubmission, reportDiningSubmission } from "@/features/dining/submission-api";
import { submissionErrorMessage } from "@/features/dining/submission-error";
import {
	diningSubmissionQueryOptions,
	invalidateDiningSubmissions,
	myDiningSubmissionQueryOptions,
} from "@/features/dining/submission-queries";
import { ApiRequestError } from "@/platform/api/client";
import { useCampusSession } from "@/platform/auth/session";
import { AdaptiveSelect } from "./dining-adaptive-select";
import { AdaptiveSheetSurface } from "./dining-overlay-surface";
import { DiningSubmissionForm } from "./dining-submission-form";
import { DiningSubmissionPhoto } from "./dining-submission-photo";
import { DiningSubmissionShare } from "./dining-submission-share";
import { DiningSubmissionSkeleton } from "./dining-submission-skeleton";

const DiningReviewSheet = lazy(() =>
	import("./dining-review-sheet").then((module) => ({ default: module.DiningReviewSheet })),
);

export function DiningSubmissionSheet(props: {
	submissionId: string;
	own: boolean;
	onClose(): void;
	windowName(windowId: string): string;
}) {
	const session = useCampusSession();
	const [authOpen, setAuthOpen] = useState(false);
	const [resumeReport, setResumeReport] = useState(false);
	const consumeReport = () => setResumeReport(false);
	return (
		<>
			<DiningSubmissionSheetContent
				key={`${props.own}:${props.submissionId}:${session.data?.user.id ?? "guest"}`}
				{...props}
				onRequestReportLogin={() => setAuthOpen(true)}
				resumeReport={resumeReport}
				onReportResumed={consumeReport}
			/>
			{authOpen ? (
				<AuthDialog open onOpenChange={setAuthOpen} onAuthenticated={() => setResumeReport(true)} />
			) : null}
		</>
	);
}

function DiningSubmissionSheetContent(props: {
	onRequestReportLogin(): void;
	resumeReport: boolean;
	onReportResumed(): void;
	submissionId: string;
	own: boolean;
	onClose(): void;
	windowName(windowId: string): string;
}) {
	const session = useCampusSession();
	const publicQuery = useQuery(
		diningSubmissionQueryOptions(props.submissionId, session.data?.user.id ?? null, !props.own),
	);
	const ownQuery = useQuery(
		myDiningSubmissionQueryOptions(
			props.submissionId,
			session.data?.user.id ?? null,
			props.own && session.status === "authenticated",
		),
	);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const query = props.own ? ownQuery : publicQuery;
	const [authOpen, setAuthOpen] = useState(false);
	const error = query.error;
	const noAccess = error instanceof ApiRequestError && [401, 403, 404].includes(error.status);
	const blockedOwn = props.own && session.status !== "authenticated";
	return (
		<>
			<AdaptiveSheetSurface
				desktopClassName="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
				mobileClassName="gap-0"
				open
				onOpenChange={(open) => {
					if (!open) {
						props.onClose();
					}
				}}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					titleRef.current?.focus({ preventScroll: true });
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					const trigger = Array.from(
						document.querySelectorAll<HTMLElement>("[data-submission-id]"),
					).find((element) => element.dataset.submissionId === props.submissionId);
					(trigger ?? document.querySelector<HTMLElement>("[data-dining-home]"))?.focus({
						preventScroll: true,
					});
				}}
			>
				<SheetHeader className="border-b border-border p-5 pr-12 text-left">
					<SheetTitle ref={titleRef} tabIndex={-1}>
						{props.own ? "我的投稿" : "用户投稿"}
					</SheetTitle>
					<SheetDescription>
						{props.own ? "查看当前状态，管理自己的投稿。" : "由同学提供，供你参考。"}
					</SheetDescription>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5" data-vaul-no-drag="">
					{!blockedOwn && query.isError && query.data && !noAccess ? (
						<div className="mb-4 space-y-2" role="alert">
							<p className="text-sm text-destructive">刷新失败，当前显示上次读取的投稿。</p>
							<Button variant="outline" onClick={() => void query.refetch()}>
								重试
							</Button>
						</div>
					) : null}
					{blockedOwn ? (
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground">
								{session.status === "loading"
									? "正在确认登录状态"
									: session.status === "unavailable"
										? "暂时无法确认登录状态。"
										: "登录后查看自己的投稿。"}
							</p>
							{session.status === "anonymous" ? (
								<Button onClick={() => setAuthOpen(true)}>登录</Button>
							) : session.status === "unavailable" ? (
								<Button variant="outline" onClick={() => void session.refresh()}>
									重试登录状态
								</Button>
							) : null}
						</div>
					) : query.isPending ? (
						<DiningSubmissionSkeleton label="正在读取投稿" detail />
					) : query.isError && (!query.data || noAccess) ? (
						<div className="space-y-3" role="alert">
							<p>{noAccess ? "该投稿不存在或当前不可查看。" : "投稿暂时无法读取。"}</p>
							{noAccess ? null : (
								<Button variant="outline" onClick={() => void query.refetch()}>
									重试
								</Button>
							)}
							<Button variant="outline" onClick={props.onClose}>
								返回列表
							</Button>
						</div>
					) : props.own && ownQuery.data ? (
						<OwnSubmissionContent
							fallbackFocusRef={titleRef}
							submission={ownQuery.data.submission}
							windowName={props.windowName(ownQuery.data.submission.windowId)}
							onRefresh={() => ownQuery.refetch()}
						/>
					) : publicQuery.data ? (
						<PublicSubmissionContent
							key={publicQuery.data.submission.submissionId}
							onRequestReportLogin={props.onRequestReportLogin}
							resumeReport={props.resumeReport && publicQuery.isSuccess && !publicQuery.isFetching}
							onReportResumed={props.onReportResumed}
							submission={publicQuery.data.submission}
							windowName={props.windowName(publicQuery.data.submission.windowId)}
						/>
					) : null}
				</div>
			</AdaptiveSheetSurface>
			{authOpen ? <AuthDialog open onOpenChange={setAuthOpen} /> : null}
		</>
	);
}

function PublicSubmissionContent({
	onRequestReportLogin,
	resumeReport,
	onReportResumed,
	submission,
	windowName,
}: {
	onRequestReportLogin(): void;
	resumeReport: boolean;
	onReportResumed(): void;
	submission: DiningSubmission;
	windowName: string;
}) {
	const session = useCampusSession();
	const client = useQueryClient();
	const [reviewsOpen, setReviewsOpen] = useState(false);
	const reviewTrigger = useRef<HTMLButtonElement>(null);
	const [reportOpen, setReportOpen] = useState(false);

	const [reason, setReason] = useState<DiningReportReason>("spam");
	const [details, setDetails] = useState("");
	const [resumeMessage, setResumeMessage] = useState<string | null>(null);
	useEffect(() => {
		if (!resumeReport || session.status !== "authenticated") {
			return;
		}
		setReportOpen(submission.canReport && !submission.hasReported);
		setResumeMessage(
			submission.hasReported
				? "你已经举报过这条投稿。"
				: submission.canReport
					? null
					: "当前不能举报这条投稿。",
		);
		onReportResumed();
	}, [resumeReport, session.status, submission.canReport, submission.hasReported, onReportResumed]);
	const report = useMutation({
		mutationFn: reportDiningSubmission,
		onSuccess: async () => {
			setReportOpen(false);
			await invalidateDiningSubmissions(client);
		},
	});
	return (
		<div className="space-y-5">
			<div>
				<h2 className="break-words text-xl font-semibold">{submission.name}</h2>
				<p className="mt-2 break-words text-sm text-muted-foreground">
					用户投稿 · {submission.authorName}
				</p>
				<p className="mt-1 text-sm text-muted-foreground">
					{windowName} · {submission.priceText ?? "价格暂未提供"}
				</p>
			</div>
			{submission.photo ? (
				<DiningSubmissionPhoto
					key={submission.photo.url}
					photo={submission.photo}
					name={submission.name}
				/>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button ref={reviewTrigger} onClick={() => setReviewsOpen(true)}>
					查看与发表评价
				</Button>
				<DiningSubmissionShare
					key={submission.submissionId}
					submissionId={submission.submissionId}
				/>
				{submission.hasReported ? (
					<span className="self-center text-sm text-muted-foreground">已举报</span>
				) : submission.canReport ? (
					<Button variant="outline" onClick={() => setReportOpen(!reportOpen)}>
						举报投稿
					</Button>
				) : session.status === "anonymous" ? (
					<Button variant="outline" onClick={onRequestReportLogin}>
						登录后举报
					</Button>
				) : null}
			</div>
			{resumeMessage ? (
				<StateMessage layout="inline" role="status" description={resumeMessage} />
			) : null}
			{report.isSuccess ? (
				<StateMessage layout="inline" role="status" description={<>举报已提交。</>} />
			) : null}
			{reportOpen ? (
				<form
					className="space-y-3 border-t border-border pt-4"
					onSubmit={(event) => {
						event.preventDefault();
						report.mutate({
							submissionId: submission.submissionId,
							reason,
							details: details.trim() || null,
						});
					}}
				>
					<h3 className="text-sm font-semibold">举报投稿</h3>
					<Field label={<> 原因 </>} id="submission-report-reason">
						<AdaptiveSelect
							id="submission-report-reason"
							onValueChange={(value) => setReason(value as DiningReportReason)}
							options={[
								{ label: "垃圾信息", value: "spam" },
								{ label: "不当内容", value: "inappropriate" },
								{ label: "隐私泄露", value: "privacy" },
								{ label: "其他", value: "other" },
							]}
							value={reason}
						/>
					</Field>
					<Field label={<> 补充说明 </>} id="submission-report-details">
						<Textarea
							id="submission-report-details"
							maxLength={300}
							value={details}
							onChange={(event) => setDetails(event.target.value)}
						/>
					</Field>
					{report.isError ? (
						<StateMessage
							layout="inline"
							role="alert"
							tone="danger"
							description={submissionErrorMessage(report.error)}
						/>
					) : null}
					<ActionGroup>
						<Button disabled={report.isPending} type="submit">
							{report.isPending ? "提交中" : "提交举报"}
						</Button>
						<Button type="button" variant="outline" onClick={() => setReportOpen(false)}>
							取消
						</Button>
					</ActionGroup>
				</form>
			) : null}
			{reviewsOpen ? (
				<Suspense
					fallback={
						<StateMessage layout="inline" role="status" description={<> 正在打开评价 </>} />
					}
				>
					<DiningReviewSheet
						item={submission}
						open
						onOpenChange={setReviewsOpen}
						returnFocusRef={reviewTrigger}
					/>
				</Suspense>
			) : null}
		</div>
	);
}

function OwnSubmissionContent({
	fallbackFocusRef,
	submission,
	windowName,
	onRefresh,
}: {
	fallbackFocusRef: import("react").RefObject<HTMLElement | null>;
	submission: DiningMySubmission;
	windowName: string;
	onRefresh(): Promise<unknown>;
}) {
	const routeSearch = useSearch({ from: "/dining" });
	const client = useQueryClient();
	const [editing, setEditing] = useState<DiningMySubmission | null>(null);
	const [deleting, setDeleting] = useState(false);
	const current =
		submission.status === "public" || submission.status === "hidden" ? submission : null;
	const remove = useMutation({
		mutationFn: deleteDiningSubmission,
		onSuccess: async () => {
			setDeleting(false);
			await invalidateDiningSubmissions(client);
		},
	});
	const conflict = remove.error instanceof ApiRequestError && remove.error.status === 412;
	const status =
		submission.status === "public"
			? submission.windowAvailable
				? "公开"
				: "窗口已下线，停止公开"
			: submission.status === "hidden"
				? "已隐藏，停止公开"
				: submission.status === "deleted"
					? "已删除"
					: "已到期";
	if (editing) {
		return (
			<DiningSubmissionForm
				windowId={editing.windowId}
				windowName={windowName}
				submission={editing}
				onCancel={() => setEditing(null)}
				onSaved={async () => {
					setEditing(null);
					await onRefresh();
				}}
			/>
		);
	}
	return (
		<div className="space-y-4">
			<h2 className="break-words text-xl font-semibold">{current?.name ?? "用户投稿"}</h2>
			<p className="text-sm text-muted-foreground">用户投稿 · {status}</p>
			{current ? (
				<>
					<p className="text-sm text-muted-foreground">
						{windowName} · {current.priceText ?? "价格暂未提供"}
					</p>
					{current.photo ? (
						<DiningSubmissionPhoto
							key={current.photo.url}
							photo={current.photo}
							name={current.name}
						/>
					) : null}
				</>
			) : null}
			{submission.status === "hidden" ? (
				<p className="text-sm text-muted-foreground">编辑不会恢复公开。恢复由内容维护人员处理。</p>
			) : null}
			{submission.expiresAt ? (
				<p className="text-sm text-muted-foreground">
					{submission.status === "expired" || new Date(submission.expiresAt).getTime() <= Date.now()
						? "保留期限已到，不可恢复。"
						: `保留至 ${new Date(submission.expiresAt).toLocaleString("zh-CN")}。仅内容维护人员可在到期前且未开始清理时恢复。`}
				</p>
			) : null}
			<div className="flex flex-wrap gap-2">
				{submission.canEdit ? (
					<Button onClick={() => setEditing(submission)}>编辑投稿</Button>
				) : null}
				{submission.canDelete ? (
					<ConfirmDialog
						fallbackFocusRef={fallbackFocusRef}
						open={deleting}
						onOpenChange={(open) => {
							setDeleting(open);
							if (open) {
								remove.reset();
							}
						}}
						title="删除这条投稿？"
						description="投稿及其评价将停止公开，仍计入今日新增数量。保留 30 天，期间仅内容维护人员可以恢复；到期后清理。"
						confirmLabel="确认删除"
						pendingLabel="正在删除"
						pending={remove.isPending}
						confirmDisabled={conflict}
						trigger={
							<Button variant="outline" disabled={remove.isPending}>
								删除投稿
							</Button>
						}
						onConfirm={() =>
							remove.mutate({
								submissionId: submission.submissionId,
								revision: submission.revision,
							})
						}
						error={
							remove.isError
								? conflict
									? "投稿已发生变化，请重新读取当前状态后确认。"
									: submissionErrorMessage(remove.error)
								: null
						}
					>
						{conflict ? (
							<Button
								variant="outline"
								onClick={() => {
									setDeleting(false);
									remove.reset();
									void onRefresh();
								}}
							>
								重新读取当前状态
							</Button>
						) : null}
					</ConfirmDialog>
				) : null}
				{current?.status === "public" && current.windowAvailable ? (
					<Button asChild variant="outline">
						<Link
							to="/dining"
							replace
							resetScroll={false}
							search={{ ...routeSearch, mine: undefined, submission: current.submissionId }}
						>
							查看公开投稿
						</Link>
					</Button>
				) : null}
			</div>
			{remove.isError && !deleting ? (
				<div className="space-y-2" role="alert">
					<p className="text-sm text-destructive">{submissionErrorMessage(remove.error)}</p>
					<Button
						variant="outline"
						onClick={() => {
							remove.reset();
							void onRefresh();
						}}
					>
						重新读取当前状态
					</Button>
				</div>
			) : null}
		</div>
	);
}
