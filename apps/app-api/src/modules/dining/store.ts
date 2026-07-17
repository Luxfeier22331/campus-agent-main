import type {
	DiningPublication,
	DiningPublicReadStore,
	DiningPublishedSnapshot,
	DiningReview,
	DiningReviewImage,
} from "@campus-agent/dining/domain";
import { and, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDbGetter } from "../../db/runtime";
import { diningPublication, diningReleases, diningReviews } from "../../db/schema";
import { AppApiRouteError } from "../../http";

export function createPgDiningPublicReadStore(
	env: Env,
	input: { getDb?: RuntimeDbGetter } = {},
): DiningPublicReadStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env, { consistency: "fresh" });
	return {
		async getPublication(): Promise<DiningPublication> {
			const row = (
				await (
					await getDb()
				)
					.select()
					.from(diningPublication)
					.where(eq(diningPublication.scope, "global"))
					.limit(1)
			)[0];
			return row
				? {
						catalogReleaseId: row.catalogReleaseId,
						reviewRevision: row.reviewRevision,
						updatedAt: row.updatedAt.toISOString(),
					}
				: { catalogReleaseId: null, reviewRevision: 0, updatedAt: new Date(0).toISOString() };
		},
		async getPublishedSnapshot() {
			const db = await getDb();
			const rows = await db
				.select({
					catalogReleaseId: diningPublication.catalogReleaseId,
					payload: diningReleases.payloadJson,
					releaseId: diningReleases.releaseId,
				})
				.from(diningPublication)
				.leftJoin(diningReleases, eq(diningPublication.catalogReleaseId, diningReleases.releaseId))
				.where(eq(diningPublication.scope, "global"))
				.limit(1);
			const row = rows[0];
			if (!row?.catalogReleaseId) {
				return null;
			}
			if (!(row.releaseId && row.payload)) {
				invalidProjection("Publication references a missing release.");
			}
			const snapshot = parseSnapshot(row.payload);
			if (snapshot.source.releaseId !== row.catalogReleaseId) {
				invalidProjection("Publication and release payload identities do not match.");
			}
			return snapshot;
		},
		async listPublishedReviewsByOffering({ offeringId }) {
			const rows = await (await getDb())
				.select()
				.from(diningReviews)
				.where(
					and(
						eq(diningReviews.offeringId, offeringId),
						eq(diningReviews.visibility, "published"),
						eq(diningReviews.moderationStatus, "safe"),
					),
				);
			return rows.map(toReview);
		},
	};
}

function parseSnapshot(value: unknown): DiningPublishedSnapshot {
	if (
		!(
			isRecord(value) &&
			Array.isArray(value.halls) &&
			isRecord(value.floors) &&
			isRecord(value.source)
		)
	) {
		invalidProjection("Published Dining release payload is invalid.");
	}
	return value as unknown as DiningPublishedSnapshot;
}

function toReview(row: typeof diningReviews.$inferSelect): DiningReview {
	if (!(row.hallId && row.stallProfileId && row.windowId && row.offeringId)) {
		invalidProjection("Published review is missing its exact offering binding.");
	}
	return {
		campus: row.campus,
		comment: row.comment,
		contributorName: row.contributorName,
		dishName: row.dishName,
		hallId: row.hallId,
		hallName: row.hallName,
		images: parseImages(row.imagesJson),
		offeringId: row.offeringId,
		paidPriceLabel: row.paidPriceLabel,
		rating: row.rating,
		reviewId: row.reviewId,
		sourceRecordId: row.sourceRecordId,
		stallName: row.stallName,
		stallProfileId: row.stallProfileId,
		submittedAt: row.submittedAt.toISOString(),
		windowId: row.windowId,
	};
}

function parseImages(value: unknown): DiningReviewImage[] {
	if (!Array.isArray(value)) {
		invalidProjection("Published review images are invalid.");
	}
	return value.map((item) => {
		if (
			!isRecord(item) ||
			typeof item.alt !== "string" ||
			typeof item.imageId !== "string" ||
			typeof item.url !== "string"
		) {
			invalidProjection("Published review image is invalid.");
		}
		return { alt: item.alt, imageId: item.imageId, url: item.url };
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidProjection(message: string): never {
	throw new AppApiRouteError({
		code: "dining_published_projection_invalid",
		message,
		retryable: false,
		status: 500,
	});
}
