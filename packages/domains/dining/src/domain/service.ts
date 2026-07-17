import { DiningDomainError } from "./error";
import {
	floorKey,
	searchPublishedDiningSnapshot,
	toPublicFloor,
	toPublicHallSummary,
} from "./projection";
import type { DiningPublication } from "./release-types";
import { createEmptyDiningDraft } from "./state-factory";
import type {
	DiningDraft,
	DiningPublicReadService,
	DiningPublicReadStore,
	DiningPublishedBootstrap,
	DiningPublishedReview,
	DiningPublishedSnapshot,
	DiningReview,
} from "./types";

export { createDevDiningSeed, DINING_DEV_SEED_RELEASE_ID } from "./dev-seed";
export {
	createDiningFloorplanScaffoldDraft,
	listDiningFloorScaffold,
	listDiningHallScaffold,
	listDiningWindowScaffold,
	resolveDiningFloorScaffold,
	resolveDiningHallScaffold,
} from "./floorplan-scaffold";
export { createEmptyDiningDraft, DINING_SYSTEM_SOURCE } from "./state-factory";

export function buildDiningPublicReadService(input: {
	store: DiningPublicReadStore;
}): DiningPublicReadService {
	return {
		getPublication: () => input.store.getPublication(),
		async getPublishedBootstrap(): Promise<DiningPublishedBootstrap> {
			const snapshot = await input.store.getPublishedSnapshot();
			if (!snapshot) {
				return { halls: [], initial: null };
			}
			const halls = snapshot.halls.map((hall) => toPublicHallSummary(hall, snapshot));
			if (halls.length === 0) {
				return { halls, initial: null };
			}
			const hall = snapshot.halls[0];
			const floorRef = hall?.floors[0];
			if (!(hall && floorRef)) {
				throwInvalidProjection("Published hall is missing its initial map.");
			}
			const floor = snapshot.floors[floorKey({ floorId: floorRef.floorId, hallId: hall.hallId })];
			if (!floor) {
				throwInvalidProjection("Published snapshot is missing its initial map.");
			}
			return { halls, initial: { floor: toPublicFloor(floor, snapshot.source) } };
		},
		async getPublishedFloor(floorInput) {
			const snapshot = await requirePublishedSnapshot(input.store);
			const floor = snapshot.floors[floorKey(floorInput)];
			if (!floor) {
				throw new DiningDomainError({
					code: "dining_floor_not_found",
					message: "Dining floor projection was not found.",
					retryable: false,
					status: 404,
				});
			}
			return toPublicFloor(floor, snapshot.source);
		},
		async getPublishedHalls() {
			const snapshot = await input.store.getPublishedSnapshot();
			return { halls: snapshot?.halls.map((hall) => toPublicHallSummary(hall, snapshot)) ?? [] };
		},
		async getPublishedOfferingReviews({ offeringId }) {
			const snapshot = await requirePublishedSnapshot(input.store);
			if (!snapshotContainsOffering(snapshot, offeringId)) {
				throw new DiningDomainError({
					code: "dining_offering_not_found",
					message: "Dining offering projection was not found.",
					retryable: false,
					status: 404,
				});
			}
			const reviews = await input.store.listPublishedReviewsByOffering({ offeringId });
			return {
				offeringId,
				reviews: reviews
					.map(toPublishedReview)
					.sort(
						(left, right) =>
							Date.parse(right.submittedAt) - Date.parse(left.submittedAt) ||
							left.reviewId.localeCompare(right.reviewId),
					),
			};
		},
		async searchPublishedDining(searchInput) {
			return searchPublishedDiningSnapshot(
				await requirePublishedSnapshot(input.store),
				searchInput,
			);
		},
	};
}

export function createInMemoryDiningPublicReadStore(
	input: {
		draft?: DiningDraft;
		publication?: DiningPublication;
		reviews?: DiningReview[];
		snapshot?: DiningPublishedSnapshot | null;
	} = {},
): DiningPublicReadStore {
	const publication = structuredClone(
		input.publication ?? {
			catalogReleaseId: null,
			reviewRevision: 0,
			updatedAt: createEmptyDiningDraft().updatedAt,
		},
	);
	const snapshot = structuredClone(input.snapshot ?? null);
	const reviews = structuredClone(input.reviews ?? []);
	return {
		async getPublication() {
			return structuredClone(publication);
		},
		async getPublishedSnapshot() {
			return structuredClone(snapshot);
		},
		async listPublishedReviewsByOffering({ offeringId }) {
			return structuredClone(reviews.filter((review) => review.offeringId === offeringId));
		},
	};
}

async function requirePublishedSnapshot(
	store: DiningPublicReadStore,
): Promise<DiningPublishedSnapshot> {
	const snapshot = await store.getPublishedSnapshot();
	if (!snapshot) {
		throw new DiningDomainError({
			code: "dining_release_not_published",
			message: "Published dining projection is not available.",
			retryable: false,
			status: 404,
		});
	}
	return snapshot;
}

function snapshotContainsOffering(snapshot: DiningPublishedSnapshot, offeringId: string): boolean {
	return Object.values(snapshot.floors).some((floor) =>
		floor.menuOfferings.some((offering) => offering.offeringId === offeringId),
	);
}

function toPublishedReview(review: DiningReview): DiningPublishedReview {
	return {
		comment: review.comment,
		contributorName: review.contributorName,
		images: review.images,
		paidPriceLabel: review.paidPriceLabel,
		rating: review.rating,
		reviewId: review.reviewId,
		submittedAt: review.submittedAt,
	};
}

function throwInvalidProjection(message: string): never {
	throw new DiningDomainError({
		code: "dining_published_projection_invalid",
		message,
		retryable: false,
		status: 500,
	});
}
