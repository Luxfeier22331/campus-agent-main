import { and, asc, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { RuntimeDbGetter } from "../../db/runtime";
import { diningSubmissionPhotos, diningSubmissions } from "../../db/schema";
import type { DiningSubmissionObjects } from "./submission-media";
import type { SubmissionPhotoRow, SubmissionRow } from "./submission-store";

// A crashed worker can leave a claim behind. The next invocation resumes that
// same row after the existing five-minute upload/cleanup lease has elapsed.
export const DINING_PHOTO_CLEANUP_LEASE_MS = 5 * 60 * 1000;
// Each storage operation is capped at 30 seconds, so this batch fits the
// account owner's five-minute lease, including database work.
const CLEANUP_BATCH_SIZE = 8;

export function createDiningMediaCleanup(input: {
	getDb: RuntimeDbGetter;
	now: () => Date;
	objects: () => DiningSubmissionObjects;
}) {
	async function claim(photoId: string, immediateOrphan: boolean) {
		const db = await input.getDb();
		return db.transaction(async (tx) => {
			const [candidate] = await tx
				.select({ submissionId: diningSubmissionPhotos.submissionId })
				.from(diningSubmissionPhotos)
				.where(eq(diningSubmissionPhotos.photoId, photoId));
			if (!candidate || (immediateOrphan && candidate.submissionId)) {
				return null;
			}
			// Mutations and Ops recovery use the same parent-before-photo order.
			const [parent] = candidate.submissionId
				? await tx
						.select()
						.from(diningSubmissions)
						.where(eq(diningSubmissions.submissionId, candidate.submissionId))
						.for("update")
				: [];
			const [photo] = await tx
				.select()
				.from(diningSubmissionPhotos)
				.where(eq(diningSubmissionPhotos.photoId, photoId))
				.for("update");
			const now = input.now();
			if (
				!photo ||
				photo.submissionId !== candidate.submissionId ||
				!eligiblePhoto(photo, parent, now, immediateOrphan)
			) {
				return null;
			}
			const [claimed] = await tx
				.update(diningSubmissionPhotos)
				.set({
					accountDeletionRequestId:
						parent?.accountDeletionRequestId ?? photo.accountDeletionRequestId,
					current: false,
					expiresAt: photo.expiresAt && photo.expiresAt <= now ? photo.expiresAt : now,
					cleanupStatus: "running",
					cleanupStartedAt: now,
					cleanupAttempts: sql`${diningSubmissionPhotos.cleanupAttempts} + 1`,
					cleanupLastError: null,
				})
				.where(eq(diningSubmissionPhotos.photoId, photoId))
				.returning();
			return claimed ?? null;
		});
	}

	async function clean(photoId: string, immediateOrphan = false) {
		const claimed = await claim(photoId, immediateOrphan);
		if (!claimed) {
			return "skipped" as const;
		}
		const db = await input.getDb();
		const ownsClaim = and(
			eq(diningSubmissionPhotos.photoId, photoId),
			eq(diningSubmissionPhotos.cleanupStatus, "running"),
			eq(diningSubmissionPhotos.cleanupAttempts, claimed.cleanupAttempts),
		);
		try {
			// Never hold database locks over object storage calls. This adapter only
			// resolves after every version/delete marker and the current key are gone.
			await input.objects().deleteAllVersions(claimed.objectKey);
			// Absence is completion; expired history stores photo IDs without a FK
			// and already renders missing media as unavailable. Keep no object ledger.
			const deleted = await db
				.delete(diningSubmissionPhotos)
				.where(ownsClaim)
				.returning({ photoId: diningSubmissionPhotos.photoId });
			return deleted.length > 0 ? ("deleted" as const) : ("skipped" as const);
		} catch {
			await db
				.update(diningSubmissionPhotos)
				.set({
					cleanupStatus: "failed",
					cleanupLastError: "dining_submission_storage_unavailable",
				})
				.where(ownsClaim);
			return "failed" as const;
		}
	}

	return {
		async discardOrphan(photoId: string): Promise<void> {
			try {
				await clean(photoId, true);
			} catch {
				// Preserve the reservation if the transaction's result is unknown.
			}
		},
		async sweep(options: { accountDeletionRequestId?: string | undefined; limit?: number } = {}) {
			const db = await input.getDb();
			const now = input.now();
			const candidates = await db
				.select({ photoId: diningSubmissionPhotos.photoId })
				.from(diningSubmissionPhotos)
				.leftJoin(
					diningSubmissions,
					eq(diningSubmissionPhotos.submissionId, diningSubmissions.submissionId),
				)
				.where(
					and(
						ne(diningSubmissionPhotos.cleanupStatus, "completed"),
						or(
							ne(diningSubmissionPhotos.cleanupStatus, "running"),
							isNull(diningSubmissionPhotos.cleanupStartedAt),
							lte(
								diningSubmissionPhotos.cleanupStartedAt,
								new Date(now.getTime() - DINING_PHOTO_CLEANUP_LEASE_MS),
							),
						),
						options.accountDeletionRequestId
							? or(
									eq(
										diningSubmissionPhotos.accountDeletionRequestId,
										options.accountDeletionRequestId,
									),
									eq(diningSubmissions.accountDeletionRequestId, options.accountDeletionRequestId),
								)
							: undefined,
						or(
							and(
								eq(diningSubmissionPhotos.current, false),
								lte(diningSubmissionPhotos.expiresAt, now),
							),
							isNotNull(diningSubmissions.accountDeletingAt),
							isNotNull(diningSubmissions.purgedAt),
							and(
								or(
									eq(diningSubmissions.status, "deleted"),
									eq(diningSubmissions.status, "expired"),
								),
								lte(diningSubmissions.expiresAt, now),
							),
						),
					),
				)
				.orderBy(
					sql`${diningSubmissionPhotos.cleanupStartedAt} asc nulls first`,
					asc(diningSubmissionPhotos.photoId),
				)
				.limit(Math.max(1, Math.min(options.limit ?? CLEANUP_BATCH_SIZE, CLEANUP_BATCH_SIZE)));
			const result = { completed: 0, pending: 0, failed: 0 };
			for (const candidate of candidates) {
				try {
					const outcome = await clean(candidate.photoId);
					if (outcome !== "skipped") {
						result[outcome === "deleted" ? "completed" : "failed"] += 1;
					}
				} catch {
					// A single failed DB claim must not prevent other objects progressing.
					result.failed += 1;
				}
			}
			const [remaining] = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(diningSubmissionPhotos)
				.leftJoin(
					diningSubmissions,
					eq(diningSubmissionPhotos.submissionId, diningSubmissions.submissionId),
				)
				.where(
					options.accountDeletionRequestId
						? or(
								eq(
									diningSubmissionPhotos.accountDeletionRequestId,
									options.accountDeletionRequestId,
								),
								eq(diningSubmissions.accountDeletionRequestId, options.accountDeletionRequestId),
							)
						: or(
								and(
									eq(diningSubmissionPhotos.current, false),
									lte(diningSubmissionPhotos.expiresAt, now),
								),
								isNotNull(diningSubmissions.accountDeletingAt),
								isNotNull(diningSubmissions.purgedAt),
								and(
									or(
										eq(diningSubmissions.status, "deleted"),
										eq(diningSubmissions.status, "expired"),
									),
									lte(diningSubmissions.expiresAt, now),
								),
							),
				);
			result.pending = remaining?.count ?? 0;
			return result;
		},
	};
}

function eligiblePhoto(
	photo: SubmissionPhotoRow,
	parent: SubmissionRow | undefined,
	now: Date,
	immediateOrphan: boolean,
) {
	if (
		photo.cleanupStatus === "completed" ||
		(photo.cleanupStatus === "running" &&
			photo.cleanupStartedAt &&
			photo.cleanupStartedAt.getTime() > now.getTime() - DINING_PHOTO_CLEANUP_LEASE_MS)
	) {
		return false;
	}
	if (!photo.submissionId) {
		return (
			!photo.current && (immediateOrphan || Boolean(photo.expiresAt && photo.expiresAt <= now))
		);
	}
	if (immediateOrphan || !parent) {
		return false;
	}
	if (
		parent.accountDeletingAt ||
		parent.purgedAt ||
		(["deleted", "expired"].includes(parent.status) && parent.expiresAt && parent.expiresAt <= now)
	) {
		return true;
	}
	return !photo.current && Boolean(photo.expiresAt && photo.expiresAt <= now);
}
