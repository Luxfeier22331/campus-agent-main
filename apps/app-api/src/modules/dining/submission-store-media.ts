import { and, eq, isNull } from "drizzle-orm";
import type { RuntimeDbGetter } from "../../db/runtime";
import { diningSubmissionPhotos } from "../../db/schema";
import { AppApiRouteError } from "../../http";
import { createDiningMediaCleanup } from "./lifecycle-media";
import type {
	DiningImageProcessor,
	DiningNormalizedPhoto,
	DiningSubmissionObjects,
} from "./submission-media";
import {
	lockSubmissionActor,
	type SubmissionPhotoRow,
	type SubmissionTransaction,
	submissionError,
} from "./submission-store";

const UPLOAD_LEASE_MS = 5 * 60 * 1000;

export function createSubmissionMediaStore(input: {
	getDb: RuntimeDbGetter;
	now: () => Date;
	images: () => DiningImageProcessor;
	objects: () => DiningSubmissionObjects;
}) {
	const { discardOrphan } = createDiningMediaCleanup(input);

	return {
		discardOrphan,
		async upload(bytes: Uint8Array, ownerUserId: string): Promise<SubmissionPhotoRow> {
			let normalized: DiningNormalizedPhoto;
			try {
				normalized = await input.images().normalize(bytes);
			} catch (error) {
				if (error instanceof AppApiRouteError) {
					throw error;
				}
				throw submissionError("dining_submission_image_unavailable", 503, "图片处理暂不可用。");
			}
			const photoId = crypto.randomUUID();
			const objectKey = `dining/submissions/${photoId}.webp`;
			const db = await input.getDb();
			// Reserve before PUT, so a process exit at any subsequent step leaves a
			// bounded orphan that the existing scheduled cleanup owner can discover.
			await db.transaction(async (tx) => {
				await lockSubmissionActor(tx, ownerUserId);
				await tx.insert(diningSubmissionPhotos).values({
					uploadOwnerId: ownerUserId,
					photoId,
					objectKey,
					current: false,
					cleanupStatus: "pending",
					height: normalized.height,
					width: normalized.width,
					expiresAt: new Date(input.now().getTime() + UPLOAD_LEASE_MS),
				});
			});
			let putAcknowledged = false;
			try {
				const stored = await input.objects().put(objectKey, normalized);
				putAcknowledged = true;
				const [row] = await db
					.update(diningSubmissionPhotos)
					.set({ objectVersionId: stored.versionId })
					.where(
						and(
							eq(diningSubmissionPhotos.photoId, photoId),
							eq(diningSubmissionPhotos.cleanupStatus, "pending"),
							isNull(diningSubmissionPhotos.cleanupStartedAt),
						),
					)
					.returning();
				if (!row) {
					throw submissionError(
						"dining_submission_storage_unavailable",
						503,
						"照片保存未完成，请核实投稿状态。",
					);
				}
				return row;
			} catch (error) {
				if (putAcknowledged) {
					await discardOrphan(photoId);
				} else {
					// A timeout/abort cannot prove that the remote PUT stopped. Retain
					// its reservation until expiry so a late object remains discoverable.
					try {
						await db
							.update(diningSubmissionPhotos)
							.set({
								cleanupStatus: "failed",
								cleanupLastError: "dining_submission_storage_unavailable",
							})
							.where(
								and(
									eq(diningSubmissionPhotos.photoId, photoId),
									isNull(diningSubmissionPhotos.submissionId),
									eq(diningSubmissionPhotos.cleanupStatus, "pending"),
								),
							);
					} catch {
						// The original pending reservation still carries its cleanup expiry.
					}
				}
				if (error instanceof AppApiRouteError) {
					throw error;
				}
				throw submissionError("dining_submission_storage_unavailable", 503, "照片保存暂不可用。");
			}
		},
	};
}

export async function bindSubmissionPhoto(
	tx: SubmissionTransaction,
	photo: SubmissionPhotoRow,
	submissionId: string,
	now: Date,
) {
	const [row] = await tx
		.select()
		.from(diningSubmissionPhotos)
		.where(eq(diningSubmissionPhotos.photoId, photo.photoId))
		.for("update");
	if (
		!row ||
		row.current ||
		row.submissionId ||
		row.cleanupStatus !== "pending" ||
		row.cleanupStartedAt ||
		!row.expiresAt ||
		row.expiresAt <= now
	) {
		throw submissionError(
			"dining_submission_storage_unavailable",
			503,
			"照片保存未完成，请重新读取投稿状态。",
		);
	}
	await tx
		.update(diningSubmissionPhotos)
		.set({ submissionId, current: true, expiresAt: null, uploadOwnerId: null })
		.where(eq(diningSubmissionPhotos.photoId, photo.photoId));
}
