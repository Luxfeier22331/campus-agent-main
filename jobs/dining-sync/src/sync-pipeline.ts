import { sha256Tag, stableJson } from "@campus-agent/dining/domain";

import { DiningAttachmentRejectedError } from "./attachment-store.ts";
import type {
	DiningSourceObservation,
	FeishuReviewSourceIdentity,
} from "./catalog-source-types.ts";
import { DINING_MODERATION_POLICY_VERSION } from "./moderation.ts";
import { buildReviewObservations, reviewsFromObservations } from "./review-source.ts";
import type { DiningObservationState, DiningSyncRun } from "./source-observation-store.ts";
import type {
	DiningReviewImage,
	DiningSourceRecord,
	ModerationResult,
	SyncReport,
} from "./types.ts";

export interface DiningSyncDependencies {
	attachmentStore: {
		materialize(input: { record: DiningSourceRecord; runId: string }): Promise<DiningReviewImage[]>;
	};
	catalogReleaseId: string;
	moderator: {
		check(input: {
			comment: string | null;
			contributorName: string | null;
			dishName: string;
			stallName: string;
		}): Promise<ModerationResult>;
	};
	observationStore: {
		completeReviewRun(input: {
			observations: DiningSourceObservation[];
			processingHashes: ReadonlyMap<string, string>;
			run: DiningSyncRun;
			sourceIdentity: FeishuReviewSourceIdentity;
		}): Promise<SyncReport["observationSync"]>;
		listActiveReviewObservations(): Promise<DiningSourceObservation[]>;
		loadActiveReviewStates(): Promise<Map<string, DiningObservationState>>;
		succeedRun(run: DiningSyncRun): Promise<void>;
	};
	publisher: {
		publishReviewObservations(
			observations: DiningSourceObservation[],
			expectedCatalogReleaseId: string,
		): Promise<number>;
	};
	records: DiningSourceRecord[];
	reviewResolver: {
		resolve(input: { campus: string; dishName: string; hallName: string; stallName: string }):
			| {
					hallId: string;
					hallName: string;
					offeringId: string;
					stallProfileId: string;
					status: "resolved";
					windowId: string;
			  }
			| { reason: string; status: "blocked" };
	};
	run: DiningSyncRun;
	sourceIdentity: FeishuReviewSourceIdentity;
}

export async function runDiningSync(input: DiningSyncDependencies): Promise<SyncReport> {
	const existing = await input.observationStore.loadActiveReviewStates();
	const observationInputs: Parameters<typeof buildReviewObservations>[0] = [];
	const processingHashes = new Map<string, string>();
	const now = new Date();
	let blockedCount = 0;
	const blockedReasons: Record<string, number> = {};
	let attachmentCount = 0;
	let reusedCount = 0;

	for (const record of input.records) {
		const observationId = `feishu:review:${record.sourceRecordId}`;
		const processingHash = reviewProcessingHash(record, input.catalogReleaseId);
		processingHashes.set(observationId, processingHash);
		const previous = existing.get(observationId);
		if (previous?.processingHash === processingHash) {
			const blockReason = optionalString(previous.observation.payloadJson.blockReason);
			if (blockReason) {
				blockedCount += 1;
				incrementBlockedReason(blockedReasons, blockReason);
			}
			observationInputs.push(inputFromReusedObservation(record, previous.observation));
			reusedCount += 1;
			continue;
		}
		const sourceBlockReason = record.sourceBlockReason;
		if (sourceBlockReason) {
			blockedCount += 1;
			incrementBlockedReason(blockedReasons, sourceBlockReason);
			observationInputs.push({ blockReason: sourceBlockReason, record });
			continue;
		}
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
		const resolution = input.reviewResolver.resolve({
			campus: record.campus,
			dishName: record.dishName,
			hallName: record.hallName,
			stallName: record.stallName,
		});
		if (resolution.status === "blocked") {
			blockedCount += 1;
			incrementBlockedReason(blockedReasons, resolution.reason);
			observationInputs.push({ blockReason: resolution.reason, record });
			continue;
		}
		try {
			const images = await input.attachmentStore.materialize({ record, runId: input.run.runId });
			attachmentCount += images.length;
			observationInputs.push({
				blockReason: null,
				hallId: resolution.hallId,
				hallName: resolution.hallName,
				images,
				offeringId: resolution.offeringId,
				record,
				stallProfileId: resolution.stallProfileId,
				windowId: resolution.windowId,
			});
		} catch (error) {
			if (!(error instanceof DiningAttachmentRejectedError)) {
				throw error;
			}
			blockedCount += 1;
			incrementBlockedReason(blockedReasons, error.reason);
			observationInputs.push({
				blockReason: error.reason,
				hallId: resolution.hallId,
				hallName: resolution.hallName,
				offeringId: resolution.offeringId,
				record,
				stallProfileId: resolution.stallProfileId,
				windowId: resolution.windowId,
			});
		}
	}

	const observations = buildReviewObservations(observationInputs, now).map((observation) => ({
		...observation,
		payloadJson: {
			...observation.payloadJson,
			sourceHash: processingHashes.get(observation.observationId),
		},
	}));
	const observationSync = await input.observationStore.completeReviewRun({
		observations,
		processingHashes,
		run: input.run,
		sourceIdentity: input.sourceIdentity,
	});
	const activeObservations = await input.observationStore.listActiveReviewObservations();
	const reviews = reviewsFromObservations(activeObservations);
	await input.publisher.publishReviewObservations(activeObservations, input.catalogReleaseId);
	await input.observationStore.succeedRun(input.run);
	return {
		attachmentCount,
		blockedCount,
		blockedReasons,
		observationSync,
		publishedCount: reviews.length,
		readCount: input.records.length,
		reusedCount,
		reviews,
		status: reviews.length > 0 ? "published" : "no_publishable_records",
	};
}

function reviewProcessingHash(record: DiningSourceRecord, catalogReleaseId: string): string {
	return sha256Tag(
		stableJson({
			catalogReleaseId,
			policy: DINING_MODERATION_POLICY_VERSION,
			record: {
				...record,
				attachments: record.attachments.map(({ fileToken, name, size }) => ({
					fileToken,
					name,
					size,
				})),
			},
		}),
	);
}

function inputFromReusedObservation(
	record: DiningSourceRecord,
	observation: DiningSourceObservation,
): Parameters<typeof buildReviewObservations>[0][number] {
	const payload = observation.payloadJson;
	return {
		blockReason: optionalString(payload.blockReason),
		hallId: optionalString(payload.hallId) ?? undefined,
		hallName: optionalString(payload.hallName) ?? undefined,
		images: Array.isArray(payload.images) ? (payload.images as DiningReviewImage[]) : [],
		offeringId: optionalString(payload.offeringId) ?? undefined,
		record,
		stallProfileId: optionalString(payload.stallProfileId) ?? undefined,
		windowId: optionalString(payload.windowId) ?? undefined,
	};
}

function incrementBlockedReason(blockedReasons: Record<string, number>, blockReason: string): void {
	blockedReasons[blockReason] = (blockedReasons[blockReason] ?? 0) + 1;
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
	return moderation.status === "safe" ||
		moderation.status === "blocked" ||
		moderation.status === "uncertain"
		? moderation
		: { status: "blocked" };
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}
