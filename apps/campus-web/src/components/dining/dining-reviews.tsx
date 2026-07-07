import { motion } from "motion/react";
import type { DiningReview } from "@/features/dining/model";
import { Badge } from "../ui/badge";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../ui/dialog";
import { contentSwap } from "../ui/motion";

export interface DiningReviewGroup {
	reviews: DiningReview[];
	title: string | null;
}

export function DiningOfferingReviews({
	error,
	label,
	groups,
	reviews,
}: {
	error?: string | null;
	groups?: DiningReviewGroup[];
	label: string;
	reviews: DiningReview[];
}) {
	const reviewGroups = groups ?? (reviews.length > 0 ? [{ reviews, title: null }] : []);
	return (
		<motion.section
			aria-label={label}
			className="rounded-xl border bg-card text-card-foreground shadow"
			data-testid="dining-review-panel"
			layout
		>
			<div className="divide-y divide-border">
				{error ? (
					<motion.div
						className="px-3 py-4 text-destructive text-sm"
						key="review-error"
						layout
						role="status"
						{...contentSwap}
					>
						{error}
					</motion.div>
				) : reviewGroups.length > 0 ? (
					reviewGroups.map((group) => (
						<motion.div
							className="space-y-2 px-3 py-3"
							key={group.title ?? group.reviews.map((review) => review.reviewId).join(":")}
							layout
							{...contentSwap}
						>
							{group.title ? (
								<h3 className="text-sm font-medium text-[var(--sys-text-strong)]">{group.title}</h3>
							) : null}
							<div className="divide-y divide-border">
								{group.reviews.map((review) => (
									<article className="space-y-3 py-3 first:pt-0 last:pb-0" key={review.reviewId}>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												{review.contributorName ? (
													<p className="text-[var(--sys-text-muted)] text-xs">
														{review.contributorName}
													</p>
												) : null}
											</div>
											<div className="flex shrink-0 items-center gap-2">
												{review.rating === null ? null : (
													<Badge className="bg-muted text-muted-foreground" variant="secondary">
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
											<p className="text-[var(--sys-text-strong)] text-sm leading-6">
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
						</motion.div>
					))
				) : (
					<motion.div
						className="px-3 py-4 text-muted-foreground text-sm"
						key="empty-reviews"
						layout
						{...contentSwap}
					>
						暂无评价
					</motion.div>
				)}
			</div>
		</motion.section>
	);
}

function DiningReviewImagePreview({ image }: { image: DiningReview["images"][number] }) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					aria-label={`预览${image.alt}`}
					className="shrink-0 rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					type="button"
				>
					<img alt="" className="size-24 rounded-lg object-cover" loading="lazy" src={image.url} />
				</button>
			</DialogTrigger>
			<DialogContent className="max-w-3xl p-3">
				<DialogTitle className="sr-only">{image.alt}</DialogTitle>
				<img
					alt={image.alt}
					className="max-h-[80vh] w-full rounded-lg object-contain"
					src={image.url}
				/>
			</DialogContent>
		</Dialog>
	);
}
