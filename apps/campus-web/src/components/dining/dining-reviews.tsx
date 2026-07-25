import { Badge, Button, Skeleton } from "@campus-agent/ui";
import { lazy, type Ref, Suspense, useState } from "react";
import type { DiningReview } from "@/features/dining/model";

const loadDiningReviewImageDialog = () => import("./dining-review-image-dialog");
const DiningReviewImageDialog = lazy(() =>
	loadDiningReviewImageDialog().then((module) => ({
		default: module.DiningReviewImageDialog,
	})),
);

export type DiningReviewsState =
	| { status: "idle" }
	| { showSkeleton: boolean; status: "pending" }
	| { message: string; status: "error" }
	| { reviews: DiningReview[]; status: "ready" };

export function DiningReviews({
	onRetry,
	ref,
	state,
}: {
	onRetry?: () => void;
	ref?: Ref<HTMLElement>;
	state: DiningReviewsState;
}) {
	return (
		<section aria-label="评价" className="scroll-mt-20" data-testid="dining-review-panel" ref={ref}>
			<h2 className="text-lg font-semibold text-[var(--sys-text-strong)]">评价</h2>
			<div className="mt-3 min-h-28 border-t border-border">
				{state.status === "pending" ? (
					<div
						aria-busy="true"
						aria-label="正在读取评价"
						className="min-h-28 space-y-3 py-5"
						role="status"
					>
						<span className="sr-only">正在读取评价</span>
						{state.showSkeleton ? (
							<>
								<Skeleton className="h-4 w-28 motion-reduce:animate-none" />
								<Skeleton className="h-4 w-full max-w-2xl motion-reduce:animate-none" />
								<Skeleton className="h-4 w-2/3 max-w-xl motion-reduce:animate-none" />
							</>
						) : null}
					</div>
				) : state.status === "error" ? (
					<div
						className="flex min-h-28 flex-wrap items-center justify-between gap-3 py-4 text-destructive text-sm"
						role="status"
					>
						<span>{state.message}</span>
						{onRetry ? (
							<Button onClick={onRetry} size="sm" type="button" variant="outline">
								重试
							</Button>
						) : null}
					</div>
				) : state.status === "ready" ? (
					<div className="motion-safe:fade-in-0 motion-safe:animate-in motion-safe:duration-150">
						{state.reviews.length > 0 ? (
							<div className="divide-y divide-border">
								{state.reviews.map((review) => (
									<article className="min-w-0 space-y-3 py-5" key={review.reviewId}>
										<div className="flex min-w-0 items-start justify-between gap-3">
											<div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
												{review.contributorName ? (
													<p className="break-words text-sm font-medium text-[var(--sys-text-strong)]">
														{review.contributorName}
													</p>
												) : null}
												<time
													className="text-xs text-[var(--sys-text-subtle)]"
													dateTime={review.submittedAt}
												>
													{formatReviewDate(review.submittedAt)}
												</time>
											</div>
											<div className="flex shrink-0 items-center gap-2">
												{review.rating === null ? null : (
													<Badge className="bg-surface-muted text-muted-foreground" tone="neutral">
														{review.rating} 分
													</Badge>
												)}
												{review.paidPriceLabel ? (
													<span className="text-primary text-sm font-semibold">
														{review.paidPriceLabel}
													</span>
												) : null}
											</div>
										</div>
										{review.comment ? (
											<p className="max-w-3xl break-words text-sm leading-6 text-[var(--sys-text-default)]">
												{review.comment}
											</p>
										) : null}
										{review.images.length > 0 ? (
											<div className="flex gap-2 overflow-x-auto pb-1">
												{review.images.map((image) => (
													<DiningReviewImagePreview image={image} key={image.imageId} />
												))}
											</div>
										) : null}
									</article>
								))}
							</div>
						) : (
							<p className="flex min-h-28 items-center py-4 text-sm text-[var(--sys-text-muted)]">
								暂无评价
							</p>
						)}
					</div>
				) : (
					<p className="flex min-h-28 items-center py-5 text-sm text-[var(--sys-text-muted)]">
						选择菜品查看评价
					</p>
				)}
			</div>
		</section>
	);
}

function formatReviewDate(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(value));
}

function DiningReviewImagePreview({ image }: { image: DiningReview["images"][number] }) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button
				aria-label={`预览${image.alt}`}
				className="shrink-0 rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				onClick={() => setOpen(true)}
				onFocus={() => void loadDiningReviewImageDialog()}
				onPointerEnter={() => void loadDiningReviewImageDialog()}
				type="button"
			>
				<img
					alt=""
					className="size-24 rounded-lg object-cover"
					decoding="async"
					loading="lazy"
					src={image.url}
				/>
			</button>
			{open ? (
				<Suspense fallback={null}>
					<DiningReviewImageDialog alt={image.alt} onOpenChange={setOpen} open src={image.url} />
				</Suspense>
			) : null}
		</>
	);
}
