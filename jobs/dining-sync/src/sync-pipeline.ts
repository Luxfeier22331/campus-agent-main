import type {
	DiningSourceObservation,
	FeishuReviewSourceIdentity,
} from "./catalog-source-types.ts";
import { buildReviewObservations, reviewsFromObservations } from "./review-source.ts";
import type { DiningReviewResolution } from "./review-resolver.ts";
import type {
	DiningReviewImage,
	DiningReviewProjection,
	DiningSourceRecord,
	ModerationResult,
	SyncReport,
} from "./types.ts";

export interface DiningSyncDependencies {
	attachmentStore: {
		materialize(input: { record: DiningSourceRecord }): Promise<DiningReviewImage[]>;
		removeUnreferencedPublicImages?(referencedPublicUrls: string[]): Promise<void>;
	};
	reviewResolver: {
		resolve(input: {
			campus: string;
			dishName: string;
			hallName: string;
			stallName: string;
		}): DiningReviewResolution;
	};
	moderator: {
		check(input: {
			comment: string | null;
			contributorName: string | null;
			dishName: string;
			stallName: string;
		}): Promise<ModerationResult>;
	};
	observationStore: {
		listActiveFeishuReviewObservations(): Promise<DiningSourceObservation[]>;
		upsertFeishuReviewObservations(
			observations: DiningSourceObservation[],
			sourceIdentity?: FeishuReviewSourceIdentity,
		): Promise<SyncReport["observationSync"]>;
	};
	publisher: {
		publishReviewObservations(observations: DiningSourceObservation[]): Promise<number>;
	};
	records: DiningSourceRecord[];
	sourceIdentity: FeishuReviewSourceIdentity;
}

export async function runDiningSync(input: DiningSyncDependencies): Promise<SyncReport> {
	const observationInputs: Parameters<typeof buildReviewObservations>[0] = [];
	let blockedCount = 0;
	const blockedReasons: Record<string, number> = {};
	let attachmentCount = 0;
	for (const record of input.records) {
		if (!record.submittedAt) {
			blockedCount += 1;
			const blockReason = "submitted_at_missing";
			incrementBlockedReason(blockedReasons, blockReason);
			observationInputs.push({ blockReason, record });
			continue;
		}
		const moderation = await moderateRecord(input, record);
		if (moderation.status !== "safe") {
			blockedCount += 1;
			const blockReason = "content_moderation_blocked";
			incrementBlockedReason(blockedReasons, blockReason);
			observationInputs.push({ blockReason, record });
			continue;
		}
		const resolution = resolveReview(input, record);
		if (resolution.status === "blocked") {
			blockedCount += 1;
			const blockReason = resolution.reason;
			incrementBlockedReason(blockedReasons, blockReason);
			observationInputs.push({ blockReason, record });
			continue;
		}
		const images = await materializeAttachments(input, record);
		if (!images) {
			blockedCount += 1;
			const blockReason = "image_moderation_blocked";
			incrementBlockedReason(blockedReasons, blockReason);
			observationInputs.push({
				blockReason,
				hallId: resolution.hallId,
				hallName: resolution.hallName,
				offeringId: resolution.offeringId,
				record,
				stallProfileId: resolution.stallProfileId,
				windowId: resolution.windowId,
			});
			continue;
		}
		attachmentCount += images.length;
		observationInputs.push({
			blockReason: null,
			images,
			hallId: resolution.hallId,
			hallName: resolution.hallName,
			offeringId: resolution.offeringId,
			record,
			stallProfileId: resolution.stallProfileId,
			windowId: resolution.windowId,
		});
	}
	const observations = buildReviewObservations(observationInputs);
	const observationSync = await input.observationStore.upsertFeishuReviewObservations(
		observations,
		input.sourceIdentity,
	);
	const activeObservations = await input.observationStore.listActiveFeishuReviewObservations();
	const reviews = reviewsFromObservations(activeObservations);
	await input.publisher.publishReviewObservations(activeObservations);
	await input.attachmentStore.removeUnreferencedPublicImages?.(
		reviews.flatMap((review) => review.images.map((image) => image.url)),
	);
	return {
		attachmentCount,
		blockedCount,
		blockedReasons,
		observationSync,
		publishedCount: reviews.length,
		readCount: input.records.length,
		reviews,
		status: reviews.length > 0 ? "published" : "no_publishable_records",
	};
}

function incrementBlockedReason(blockedReasons: Record<string, number>, blockReason: string): void {
	blockedReasons[blockReason] = (blockedReasons[blockReason] ?? 0) + 1;
}

async function materializeAttachments(
	input: DiningSyncDependencies,
	record: DiningSourceRecord,
): Promise<DiningReviewImage[] | null> {
	try {
		return await input.attachmentStore.materialize({ record });
	} catch (error) {
		if (error instanceof Error && /moderation blocked/i.test(error.message)) {
			return null;
		}
		throw error;
	}
}

async function moderateRecord(
	input: DiningSyncDependencies,
	record: DiningSourceRecord,
): Promise<ModerationResult> {
	const moderation = await input.moderator.check({
		comment: record.comment,
		contributorName: record.contributorName,
		dishName: record.dishName,
		stallName: record.stallName,
	});
	if (moderation.status === "safe" || moderation.status === "blocked" || moderation.status === "uncertain") {
		return moderation;
	}
	return { status: "blocked" };
}

function resolveReview(
	input: DiningSyncDependencies,
	record: DiningSourceRecord,
): DiningReviewResolution {
	return input.reviewResolver.resolve({
		campus: record.campus,
		dishName: record.dishName,
		hallName: record.hallName,
		stallName: record.stallName,
	});
}
