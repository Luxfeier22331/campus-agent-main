import type { DiningMenuItem, DiningReportReason } from "@campus-agent/dining/domain";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	Textarea,
} from "@campus-agent/ui";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, LoaderCircle, MessageSquareText, Send, Trash2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { createDiningReview, deleteDiningReview, reportDiningReview } from "@/features/dining/api";
import { diningQueryKeys, diningReviewsInfiniteQueryOptions } from "@/features/dining/queries";
import { createIdempotencyKey } from "@/platform/api/client";
import { campusAuthClient } from "@/platform/auth/client";

const AuthDialog = lazy(() =>
	import("../auth/auth-dialog").then((module) => ({ default: module.AuthDialog })),
);

export function DiningReviewSheet(props: {
	item: DiningMenuItem | null;
	onOpenChange(open: boolean): void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const session = campusAuthClient.useSession();
	const [authOpen, setAuthOpen] = useState(false);
	const [anonymous, setAnonymous] = useState(true);
	const [body, setBody] = useState("");
	const [reportReviewId, setReportReviewId] = useState<string | null>(null);
	const [reportReason, setReportReason] = useState<DiningReportReason>("spam");
	const [reportDetails, setReportDetails] = useState("");
	const reviewIdempotencyKey = useRef<{ key: string; menuItemId: string } | null>(null);
	const menuItemId = props.item?.menuItemId ?? "";
	const reviews = useInfiniteQuery(
		diningReviewsInfiniteQueryOptions(
			menuItemId,
			session.data?.user?.id ?? null,
			props.open && Boolean(menuItemId),
		),
	);

	useEffect(() => {
		if (props.open && menuItemId) {
			void queryClient.invalidateQueries({ queryKey: diningQueryKeys.reviews(menuItemId) });
		}
	}, [menuItemId, props.open, queryClient]);

	const create = useMutation({
		mutationFn: createDiningReview,
		onSuccess: async () => {
			setBody("");
			reviewIdempotencyKey.current = null;
			await queryClient.invalidateQueries({ queryKey: diningQueryKeys.reviews(menuItemId) });
		},
	});
	const remove = useMutation({
		mutationFn: deleteDiningReview,
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: diningQueryKeys.reviews(menuItemId) }),
	});
	const report = useMutation({
		mutationFn: reportDiningReview,
		onSuccess: async () => {
			setReportReviewId(null);
			setReportDetails("");
			await queryClient.invalidateQueries({ queryKey: diningQueryKeys.reviews(menuItemId) });
		},
	});
	const items = reviews.data?.pages.flatMap((page) => page.items) ?? [];
	const mutationError = create.error ?? remove.error ?? report.error;

	return (
		<>
			<Sheet onOpenChange={props.onOpenChange} open={props.open && Boolean(props.item)}>
				<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg" side="right">
					<SheetHeader className="border-border border-b px-5 py-5 pr-12 text-left">
						<SheetTitle>{props.item?.name ?? "菜品评价"}</SheetTitle>
						<SheetDescription>{props.item?.priceText ?? "价格暂未提供"}</SheetDescription>
					</SheetHeader>
					<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
						<section
							aria-labelledby="dining-review-compose"
							className="border-border border-b pb-5"
						>
							<h3 className="text-sm font-semibold" id="dining-review-compose">
								发表评价
							</h3>
							{session.isPending ? (
								<div className="mt-3 h-9 animate-pulse rounded-md bg-surface-muted" />
							) : session.data ? (
								<form
									className="mt-3 space-y-3"
									onSubmit={(event) => {
										event.preventDefault();
										if (props.item && body.trim()) {
											if (reviewIdempotencyKey.current?.menuItemId !== props.item.menuItemId) {
												reviewIdempotencyKey.current = {
													key: createIdempotencyKey(),
													menuItemId: props.item.menuItemId,
												};
											}
											create.mutate({
												anonymous,
												body: body.trim(),
												idempotencyKey: reviewIdempotencyKey.current.key,
												menuItemId: props.item.menuItemId,
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
											className="flex min-h-9 items-center gap-2 text-sm text-[var(--sys-text-muted)]"
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
											<span className="text-xs text-[var(--sys-text-subtle)]">
												{body.length}/500
											</span>
											<Button disabled={!body.trim() || create.isPending} type="submit">
												{create.isPending ? <LoaderCircle className="animate-spin" /> : <Send />}
												提交
											</Button>
										</div>
									</div>
								</form>
							) : (
								<Button className="mt-3" onClick={() => setAuthOpen(true)} variant="outline">
									登录后发表
								</Button>
							)}
							{mutationError ? (
								<p className="mt-3 text-destructive text-sm" role="alert">
									{mutationError.message}
								</p>
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
													<p className="font-medium text-sm">
														{review.authorName ?? "匿名校园用户"}
													</p>
													<p className="mt-0.5 text-[var(--sys-text-subtle)] text-xs">
														{formatReviewDate(review.createdAt)}
														{review.edited ? " · 已编辑" : ""}
													</p>
												</div>
												<ReviewActions
													authenticated={Boolean(session.data)}
													onDelete={() => remove.mutate(review.reviewId)}
													onLogin={() => setAuthOpen(true)}
													onReport={() => setReportReviewId(review.reviewId)}
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
				</SheetContent>
			</Sheet>

			<Dialog
				onOpenChange={(open) => !open && setReportReviewId(null)}
				open={Boolean(reportReviewId)}
			>
				<DialogContent className="w-[calc(100%-2rem)] rounded-lg">
					<DialogHeader>
						<DialogTitle>举报评价</DialogTitle>
						<DialogDescription>选择最符合的原因。</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="dining-report-reason">原因</Label>
							<Select
								onValueChange={(value) => setReportReason(value as DiningReportReason)}
								value={reportReason}
							>
								<SelectTrigger id="dining-report-reason">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="spam">垃圾信息</SelectItem>
									<SelectItem value="inappropriate">不当内容</SelectItem>
									<SelectItem value="privacy">隐私泄露</SelectItem>
									<SelectItem value="other">其他</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="dining-report-details">补充说明</Label>
							<Textarea
								id="dining-report-details"
								maxLength={300}
								onChange={(event) => setReportDetails(event.target.value)}
								value={reportDetails}
							/>
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
			{authOpen ? (
				<Suspense fallback={null}>
					<AuthDialog onOpenChange={setAuthOpen} open />
				</Suspense>
			) : null}
		</>
	);
}

function ReviewActions(props: {
	authenticated: boolean;
	onDelete(): void;
	onLogin(): void;
	onReport(): void;
	review: {
		canDelete: boolean;
		canReport: boolean;
		hasReported: boolean;
	};
}) {
	if (props.review.canDelete) {
		return (
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<Button aria-label="删除评价" size="icon" variant="ghost">
						<Trash2 />
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>删除这条评价？</AlertDialogTitle>
						<AlertDialogDescription>
							评价将不再公开展示，并继续计入今天的提交数量。
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>取消</AlertDialogCancel>
						<AlertDialogAction onClick={props.onDelete}>删除</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	}
	if (props.review.hasReported) {
		return <span className="py-2 text-[var(--sys-text-subtle)] text-xs">已举报</span>;
	}
	if (props.review.canReport || !props.authenticated) {
		return (
			<Button
				aria-label="举报评价"
				onClick={props.authenticated ? props.onReport : props.onLogin}
				size="icon"
				variant="ghost"
			>
				<Flag />
			</Button>
		);
	}
	return null;
}

function formatReviewDate(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
		new Date(value),
	);
}
