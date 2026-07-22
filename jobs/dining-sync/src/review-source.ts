import type { DiningSourceObservation } from "./catalog-source-types.ts";
import type { DiningReviewImage, DiningReviewProjection, DiningSourceRecord } from "./types.ts";

export interface DiningReviewObservationInput {
	blockReason: string | null;
	hallId?: string;
	hallName?: string;
	images?: DiningReviewImage[];
	offeringId?: string;
	record: DiningSourceRecord;
	stallProfileId?: string;
	windowId?: string;
}

export function buildReviewObservations(
	inputs: DiningReviewObservationInput[],
	now = new Date(),
): DiningSourceObservation[] {
	const observedAt = now.toISOString();
	return inputs.map((input) => {
		const reviewId = `dining-review:${input.record.sourceRecordId}`;
		const accepted = input.blockReason === null;
		if (accepted) {
			requireString(input.hallId, "hallId");
			requireString(input.hallName, "hallName");
			requireString(input.offeringId, "offeringId");
			requireString(input.stallProfileId, "stallProfileId");
			requireString(input.windowId, "windowId");
			requireString(input.record.submittedAt, "submittedAt");
		}
		return {
			observationId: `feishu:review:${input.record.sourceRecordId}`,
			observedAt,
			payloadJson: {
				blockReason: input.blockReason,
				campus: input.record.campus,
				comment: input.record.comment,
				contributorName: input.record.contributorName,
				dishName: input.record.dishName,
				hallId: input.hallId ?? null,
				hallName: input.hallName ?? null,
				images: input.images ?? [],
				offeringId: input.offeringId ?? null,
				paidPriceLabel: input.record.paidPriceLabel,
				rating: input.record.rating,
				reviewId,
				sourceRecordId: input.record.sourceRecordId,
				stallName: input.record.stallName,
				stallProfileId: input.stallProfileId ?? null,
				submittedAt: input.record.submittedAt,
				windowId: input.windowId ?? null,
			},
			sourceType: "feishu_review",
			status: accepted ? "accepted" : "blocked",
			targetId: accepted ? reviewId : null,
			targetKind: "review",
		};
	});
}

export function reviewsFromObservations(
	observations: DiningSourceObservation[],
): DiningReviewProjection[] {
	return observations
		.filter((observation) => observation.sourceType === "feishu_review" && observation.status === "accepted")
		.map((observation) => {
			const payload = observation.payloadJson;
			return {
				campus: requireString(payload.campus, "campus"),
				comment: optionalString(payload.comment, "comment"),
				contributorName: optionalString(payload.contributorName, "contributorName"),
				dishName: requireString(payload.dishName, "dishName"),
				hallId: requireString(payload.hallId, "hallId"),
				hallName: requireString(payload.hallName, "hallName"),
				images: imageArray(payload.images),
				offeringId: requireString(payload.offeringId, "offeringId"),
				paidPriceLabel: optionalString(payload.paidPriceLabel, "paidPriceLabel"),
				rating: optionalNumber(payload.rating, "rating"),
				reviewId: requireString(payload.reviewId, "reviewId"),
				sourceRecordId: requireString(payload.sourceRecordId, "sourceRecordId"),
				stallName: requireString(payload.stallName, "stallName"),
				stallProfileId: requireString(payload.stallProfileId, "stallProfileId"),
				submittedAt: requireIsoTimestamp(payload.submittedAt, "submittedAt"),
				windowId: requireString(payload.windowId, "windowId"),
			};
		});
}

function requireString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Invalid dining review observation ${fieldName}.`);
	}
	return value;
}

function optionalString(value: unknown, fieldName: string): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "string") {
		throw new Error(`Invalid dining review observation ${fieldName}.`);
	}
	return value;
}

function optionalNumber(value: unknown, fieldName: string): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Invalid dining review observation ${fieldName}.`);
	}
	return value;
}

function requireIsoTimestamp(value: unknown, fieldName: string): string {
	const text = requireString(value, fieldName);
	const timestamp = Date.parse(text);
	if (!Number.isFinite(timestamp)) {
		throw new Error(`Invalid dining review observation ${fieldName}.`);
	}
	return new Date(timestamp).toISOString();
}

function imageArray(value: unknown): DiningReviewImage[] {
	if (!Array.isArray(value)) {
		throw new Error("Invalid dining review observation images.");
	}
	return value.map((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new Error("Invalid dining review observation image.");
		}
		const image = item as Record<string, unknown>;
		return {
			alt: requireString(image.alt, "image.alt"),
			imageId: requireString(image.imageId, "image.imageId"),
			url: requireString(image.url, "image.url"),
		};
	});
}
