import type {
	DiningMenuItem,
	DiningReportReason,
	DiningReview,
	DiningSubmission,
	DiningSubmissionReview,
} from "@campus-agent/dining/domain";
import {
	Button,
	Checkbox,
	ConfirmDialog,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	StateMessage,
	Textarea,
} from "@campus-agent/ui";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, LoaderCircle, MessageSquareText, Send, Trash2 } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { AuthDialog } from "@/components/auth/auth-dialog";
import { createDiningReview, deleteDiningReview, reportDiningReview } from "@/features/dining/api";
import { diningQueryKeys, diningReviewsInfiniteQueryOptions } from "@/features/dining/queries";
import { createDiningSubmissionReview } from "@/features/dining/submission-api";
import {
	diningSubmissionQueryKeys,
	diningSubmissionReviewsInfiniteQueryOptions,
} from "@/features/dining/submission-queries";
import { formatTimestamp } from "@/lib/date-time";
import { createIdempotencyKey } from "@/platform/api/client";
import { useCampusSession } from "@/platform/auth/session";
import { AdaptiveSelect } from "./dining-adaptive-select";
import { AdaptiveSheetSurface } from "./dining-overlay-surface";

interface DiningReviewSheetProps {
	item: DiningMenuItem | DiningSubmission | null;
	onOpenChange(open: boolean): void;
	open: boolean;
	returnFocusRef?: RefObject<HTMLElement | null>;
}

export function DiningReviewSheet(props: DiningReviewSheetProps) {
	const session = useCampusSession();
	const target = props.item
		? "submissionId" in props.item
			? `submission:${props.item.submissionId}`
			: `menu:${props.item.menuItemId}`
		: "none";
	return (
		<DiningReviewSheetContent
			key={`${target}:${session.data?.user.id ?? "anonymous"}`}
			{...props}
		/>
	);
}

function DiningReviewSheetContent(props: DiningReviewSheetProps) {
	const queryClient = useQueryClient();
	const session = useCampusSession();
	const [authOpen, setAuthOpen] = useState(false);
	const [anonymous, setAnonymous] = useState(true);
	const [body, setBody] = useState("");
	const [reportReviewId, setReportReviewId] = useState<string | null>(null);
	const [reportReason, setReportReason] = useState<DiningReportReason>("spam");
	const [reportDetails, setReportDetails] = useState("");
	const titleRef = useRef<HTMLHeadingElement>(null);
	const reportTriggerRef = useRef<HTMLButtonElement | null>(null);
	const reviewIdempotencyKey = useRef<string | null>(null);
	const isSubmission = Boolean(props.item && "submissionId" in props.item);
	const targetId = props.item
		? "submissionId" in props.item
			? props.item.submissionId
			: props.item.menuItemId
		: "";
	const menuItemId = isSubmission ? "" : targetId;
	const viewerId = session.data?.user.id ?? null;
	const queryKey = useMemo(
		() =>
			isSubmission
				? diningSubmissionQueryKeys.reviews(targetId)
				: diningQueryKeys.reviews(targetId),
		[isSubmission, targetId],
	);
	const submissionReviews = useInfiniteQuery(
		diningSubmissionReviewsInfiniteQueryOptions(targetId, viewerId, props.open && isSubmission),
	);
	const menuReviews = useInfiniteQuery(
		diningReviewsInfiniteQueryOptions(menuItemId, viewerId, props.open && Boolean(menuItemId)),
	);

	const reviews = isSubmission ? submissionReviews : menuReviews;
	useEffect(() => {
		if (props.open && targetId) {
			void queryClient.invalidateQueries({ queryKey });
		}
	}, [targetId, props.open, queryClient, queryKey]);

	const create = useMutation({
		mutationFn: async (input: { anonymous: boolean; body: string; idempotencyKey: string }) => {
			await (isSubmission
				? createDiningSubmissionReview({ ...input, submissionId: targetId })
				: createDiningReview({ ...input, menuItemId: targetId }));
		},
		onSuccess: async () => {
			setBody("");
			reviewIdempotencyKey.current = null;
			await queryClient.invalidateQueries({ queryKey });
		},
	});
	const remove = useMutation({
		mutationFn: deleteDiningReview,
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});
	const report = useMutation({
		mutationFn: reportDiningReview,
		onSuccess: async () => {
			setReportReviewId(null);
			setReportDetails("");
			await queryClient.invalidateQueries({ queryKey });
		},
	});
	const items =
		reviews.data?.pages.flatMap<DiningReview | DiningSubmissionReview>((page) => page.items) ?? [];
	const mutationError = create.error ?? remove.error ?? report.error;

	return (
		<>
			<AdaptiveSheetSurface
				desktopClassName="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
				mobileClassName="gap-0"
				open={props.open && Boolean(props.item)}
				onOpenChange={props.onOpenChange}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					titleRef.current?.focus({ preventScroll: true });
				}}
				onCloseAutoFocus={(event) => {
					if (props.returnFocusRef?.current?.isConnected) {
						event.preventDefault();
						props.returnFocusRef.current.focus();
					}
				}}
			>
				<SheetHeader className="border-border border-b px-5 py-5 pr-12 text-left">
					<SheetTitle ref={titleRef} tabIndex={-1}>
						{props.item?.name ?? "菜品评价"}
					</SheetTitle>
					<SheetDescription>
						{isSubmission ? "用户投稿 · " : "正式菜单 · "}
						{props.item?.priceText ?? "价格暂未提供"}
					</SheetDescription>
				</SheetHeader>
				<div
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5"
					data-vaul-no-drag=""
				>
					<section aria-labelledby="dining-review-compose" className="border-border border-b pb-5">
						<h3 className="text-sm font-semibold" id="dining-review-compose">
							发表评价
						</h3>
						{session.status === "loading" ? (
							<div className="mt-3 h-9 animate-pulse rounded-md bg-surface-muted" />
						) : session.status === "authenticated" ? (
							<form
								className="mt-3 space-y-3"
								onSubmit={(event) => {
									event.preventDefault();
									if (props.item && body.trim()) {
										reviewIdempotencyKey.current ??= createIdempotencyKey();
										create.mutate({
											anonymous,
											body: body.trim(),
											idempotencyKey: reviewIdempotencyKey.current,
										});
									}
								}}
							>
								<Textarea
									aria-label="评价内容"
									className="min-h-24 resize-y"
									maxLength={500}
									onChange={(event) => {
										setBody(event.target.value);
										reviewIdempotencyKey.current = null;
										create.reset();
									}}
									placeholder="写下你的用餐体验"
									value={body}
								/>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<label
										className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-[var(--sys-text-muted)]"
										htmlFor="dining-review-anonymous"
									>
										<Checkbox
											checked={anonymous}
											id="dining-review-anonymous"
											onCheckedChange={(checked) => {
												setAnonymous(checked === true);
												reviewIdempotencyKey.current = null;
												create.reset();
											}}
										/>
										匿名公开
									</label>
									<div className="flex items-center gap-3">
										<span className="text-xs text-[var(--sys-text-subtle)]">{body.length}/500</span>
										<Button disabled={!body.trim() || create.isPending} type="submit">
											{create.isPending ? <LoaderCircle className="animate-spin" /> : <Send />}
											提交
										</Button>
									</div>
								</div>
							</form>
						) : session.status === "unavailable" ? (
							<div className="mt-3">
								<p className="text-[var(--sys-text-muted)] text-sm">暂时无法确认登录状态。</p>
								<Button
									aria-busy={session.isRefreshing || undefined}
									className="mt-2"
									disabled={session.isRefreshing}
									onClick={() => void session.refresh()}
									variant="outline"
								>
									{session.isRefreshing ? "正在重试" : "重试"}
								</Button>
							</div>
						) : (
							<Button className="mt-3" onClick={() => setAuthOpen(true)} variant="outline">
								登录后发表
							</Button>
						)}
						{mutationError ? (
							<StateMessage
								layout="inline"
								role="alert"
								tone="danger"
								className="mt-3"
								description={mutationError.message}
							/>
						) : null}
					</section>

					<section aria-labelledby="dining-review-list" className="pt-5">
						<div className="flex items-center gap-2">
							<MessageSquareText className="size-4 text-[var(--sys-text-muted)]" />
							<h3 className="text-sm font-semibold" id="dining-review-list">
								评价
							</h3>
						</div>
						{reviews.isPending ? (
							<div className="grid min-h-32 place-content-center text-[var(--sys-text-muted)] text-sm">
								<LoaderCircle className="mx-auto mb-2 animate-spin" />
								正在读取评价
							</div>
						) : reviews.isError ? (
							<div className="py-8 text-center">
								<p className="text-destructive text-sm">评价暂时无法读取。</p>
								<Button
									className="mt-3"
									onClick={() => void reviews.refetch()}
									size="sm"
									variant="outline"
								>
									重试
								</Button>
							</div>
						) : items.length === 0 ? (
							<p className="py-8 text-center text-[var(--sys-text-muted)] text-sm">暂无评价</p>
						) : (
							<ul className="divide-y divide-border">
								{items.map((review) => (
									<li className="py-4" key={review.reviewId}>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="font-medium text-sm">{review.authorName ?? "匿名校园用户"}</p>
												<p className="mt-0.5 text-[var(--sys-text-subtle)] text-xs">
													{formatTimestamp(review.createdAt)}
													{review.edited ? " · 已编辑" : ""}
												</p>
											</div>
											<ReviewActions
												fallbackFocusRef={titleRef}
												authenticated={session.status === "authenticated"}
												onDelete={() => remove.mutateAsync(review.reviewId)}
												pending={remove.isPending && remove.variables === review.reviewId}
												error={remove.variables === review.reviewId ? remove.error : null}
												onLogin={() => setAuthOpen(true)}
												onReport={(trigger) => {
													reportTriggerRef.current = trigger;
													setReportReviewId(review.reviewId);
												}}
												review={review}
											/>
										</div>
										<p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
											{review.body}
										</p>
									</li>
								))}
							</ul>
						)}
						{reviews.hasNextPage ? (
							<Button
								className="mt-4 w-full"
								disabled={reviews.isFetchingNextPage}
								onClick={() => void reviews.fetchNextPage()}
								variant="outline"
							>
								{reviews.isFetchingNextPage ? "读取中" : "加载更多"}
							</Button>
						) : null}
					</section>
				</div>
			</AdaptiveSheetSurface>

			<Dialog
				onOpenChange={(open) => !open && setReportReviewId(null)}
				open={Boolean(reportReviewId)}
			>
				<DialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						const trigger = reportTriggerRef.current;
						if (trigger?.isConnected) {
							trigger.focus();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>举报评价</DialogTitle>
						<DialogDescription>选择最符合的原因。</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Field label={<> 原因 </>} id="dining-report-reason">
								<AdaptiveSelect
									id="dining-report-reason"
									onValueChange={(value) => setReportReason(value as DiningReportReason)}
									options={[
										{ label: "垃圾信息", value: "spam" },
										{ label: "不当内容", value: "inappropriate" },
										{ label: "隐私泄露", value: "privacy" },
										{ label: "其他", value: "other" },
									]}
									value={reportReason}
								/>
							</Field>
						</div>
						<div className="space-y-2">
							<Field label={<> 补充说明 </>} id="dining-report-details">
								<Textarea
									id="dining-report-details"
									maxLength={300}
									onChange={(event) => setReportDetails(event.target.value)}
									value={reportDetails}
								/>
							</Field>
						</div>
					</div>
					<DialogFooter>
						<Button onClick={() => setReportReviewId(null)} variant="outline">
							取消
						</Button>
						<Button
							disabled={report.isPending}
							onClick={() => {
								if (reportReviewId) {
									report.mutate({
										details: reportDetails.trim() || null,
										reason: reportReason,
										reviewId: reportReviewId,
									});
								}
							}}
						>
							<Flag />
							提交举报
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{authOpen ? <AuthDialog onOpenChange={setAuthOpen} open /> : null}
		</>
	);
}

function ReviewActions(props: {
	fallbackFocusRef: import("react").RefObject<HTMLElement | null>;
	authenticated: boolean;
	onDelete(): Promise<unknown>;
	pending: boolean;
	error: unknown;
	onLogin(): void;
	onReport(trigger: HTMLButtonElement): void;
	review: {
		canDelete: boolean;
		canReport: boolean;
		hasReported: boolean;
	};
}) {
	const [deleting, setDeleting] = useState(false);
	if (props.review.canDelete) {
		return (
			<ConfirmDialog
				fallbackFocusRef={props.fallbackFocusRef}
				open={deleting}
				onOpenChange={setDeleting}
				title="删除这条评价？"
				description="评价将不再公开展示，并继续计入今天的提交数量。"
				confirmLabel="删除"
				pending={props.pending}
				error={
					props.error ? (props.error instanceof Error ? props.error.message : "删除未完成。") : null
				}
				onConfirm={() => {
					void props.onDelete().then(
						() => setDeleting(false),
						() => {
							/* Mutation error remains visible in the confirmation. */
						},
					);
				}}
				trigger={
					<Button aria-label="删除评价" size="icon" variant="ghost">
						<Trash2 />
					</Button>
				}
			/>
		);
	}
	if (props.review.hasReported) {
		return <span className="py-2 text-[var(--sys-text-subtle)] text-xs">已举报</span>;
	}
	if (props.review.canReport || !props.authenticated) {
		return (
			<Button
				aria-label="举报评价"
				onClick={(event) =>
					props.authenticated ? props.onReport(event.currentTarget) : props.onLogin()
				}
				size="icon"
				variant="ghost"
			>
				<Flag />
			</Button>
		);
	}
	return null;
}
