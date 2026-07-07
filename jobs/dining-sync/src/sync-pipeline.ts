import type {
	DiningSourceObservation,
	FeishuReviewSourceIdentity,
} from "./catalog-source-types";
import { buildReviewObservations, reviewsFromObservations } from "./review-source";
import type {
	DiningReviewImage,
	DiningReviewProjection,
	DiningSourceRecord,
	ModerationResult,
	SyncReport,
} from "./types";

interface DiningHallResolution {
	hallId: string;
	hallName: string;
	stallProfileId: string;
	windowId: string;
}

export interface DiningSyncDependencies {
	attachmentStore: {
		materialize(input: { record: DiningSourceRecord }): Promise<DiningReviewImage[]>;
		removeUnreferencedPublicImages?(referencedPublicUrls: string[]): Promise<void>;
	};
	hallResolver: {
		resolve(input: {
			campus: string;
			hallName: string;
			stallName: string;
		}): DiningHallResolution | null;
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
		publishReviews(reviews: DiningReviewProjection[]): Promise<void>;
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
		const moderation = await moderateRecord(input, record);
		if (moderation.status !== "safe") {
			blockedCount += 1;
			const blockReason = "content_moderation_blocked";
			incrementBlockedReason(blockedReasons, blockReason);
			observationInputs.push({ blockReason, record });
			continue;
		}
		const hall = resolveHall(input, record);
		if (!hall) {
			blockedCount += 1;
			const blockReason = "hall_or_stall_not_found";
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
				hallId: hall.hallId,
				hallName: hall.hallName,
				record,
				stallProfileId: hall.stallProfileId,
				windowId: hall.windowId,
			});
			continue;
		}
		attachmentCount += images.length;
		observationInputs.push({
			blockReason: null,
			images,
			hallId: hall.hallId,
			hallName: hall.hallName,
			record,
			stallProfileId: hall.stallProfileId,
			windowId: hall.windowId,
		});
	}
	const observations = buildReviewObservations(observationInputs);
	const observationSync = await input.observationStore.upsertFeishuReviewObservations(
		observations,
		input.sourceIdentity,
	);
	const reviews = reviewsFromObservations(
		await input.observationStore.listActiveFeishuReviewObservations(),
	);
	await input.publisher.publishReviews(reviews);
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

function resolveHall(
	input: DiningSyncDependencies,
	record: DiningSourceRecord,
): DiningHallResolution | null {
	return input.hallResolver.resolve({
		campus: record.campus,
		hallName: record.hallName,
		stallName: record.stallName,
	});
}
