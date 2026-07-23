import { describe, expect, it, vi } from "vitest";

import { DiningAttachmentRejectedError } from "../src/attachment-store.ts";
import type { DiningSourceObservation } from "../src/catalog-source-types.ts";
import type { DiningObservationState, DiningSyncRun } from "../src/source-observation-store.ts";
import { type DiningSyncDependencies, runDiningSync } from "../src/sync-pipeline.ts";
import type { DiningSourceRecord } from "../src/types.ts";

const SAFE_RECORD: DiningSourceRecord = {
	attachments: [{ fileToken: "placeholder", name: "meal.jpg", size: 100 }],
	campus: "海淀校区",
	comment: "清淡，分量合适",
	contributorName: "果小生",
	dishName: "金汤鱼粉",
	hallName: "第一食堂",
	paidPriceLabel: "12 元",
	rating: 4,
	sourceRecordId: "rec-safe",
	stallName: "鱼粉",
	submittedAt: "2026-07-01T08:00:00.000Z",
};

const RUN: DiningSyncRun = {
	runId: "dining_feishu_review_sync:test",
	sourceType: "feishu_review",
	startedAt: new Date("2026-07-01T09:00:00.000Z"),
};

function createObservationStore(events: string[] = []) {
	let active: DiningSourceObservation[] = [];
	let states = new Map<string, DiningObservationState>();
	const store: DiningSyncDependencies["observationStore"] = {
		completeReviewRun: vi.fn(
			async (
				input: Parameters<DiningSyncDependencies["observationStore"]["completeReviewRun"]>[0],
			) => {
				const { observations, processingHashes, run } = input;
				events.push("complete");
				active = observations;
				states = new Map(
					observations.map((observation) => [
						observation.observationId,
						{
							observation,
							processingHash: processingHashes.get(observation.observationId) ?? "missing",
						},
					]),
				);
				return {
					acceptedCount: observations.filter(({ status }) => status === "accepted").length,
					blockedCount: observations.filter(({ status }) => status === "blocked").length,
					runId: run.runId,
					staleCount: 0,
					totalCount: observations.length,
				};
			},
		),
		listActiveReviewObservations: vi.fn(async () => {
			events.push("list");
			return active;
		}),
		loadActiveReviewStates: vi.fn(async () => states),
		succeedRun: vi.fn(async () => {
			events.push("succeed");
		}),
	};
	return store;
}

function createDependencies(
	overrides: Partial<DiningSyncDependencies> = {},
): DiningSyncDependencies {
	return {
		attachmentStore: {
			materialize: vi.fn(async ({ record }) => [
				{
					alt: `${record.dishName}评价图片`,
					imageId: "dining-review-image:sha256:digest",
					url: "https://assets.example.test/campus-dining-media/public/reviews/sha256/digest.webp",
				},
			]),
		},
		catalogReleaseId: "dining_release:catalog-1",
		moderator: { check: vi.fn(async () => ({ status: "safe" as const })) },
		observationStore: createObservationStore(),
		publisher: { publishReviewObservations: vi.fn(async () => 1) },
		records: [SAFE_RECORD],
		reviewResolver: {
			resolve: vi.fn(() => ({
				hallId: "haidian-canteen-1",
				hallName: "海淀一食堂",
				offeringId: "offering:fish-noodle",
				stallProfileId: "stall:fish-noodle",
				status: "resolved" as const,
				windowId: "window:haidian-canteen-1:01",
			})),
		},
		run: RUN,
		sourceIdentity: { baseToken: "base", reviewTableId: "tbl_review" },
		...overrides,
	};
}

describe("dining sync pipeline", () => {
	it("publishes a complete safe snapshot before marking the run successful", async () => {
		const events: string[] = [];
		const observationStore = createObservationStore(events);
		const publishReviewObservations = vi.fn(async () => {
			events.push("publish");
			return 1;
		});
		const input = createDependencies({
			observationStore,
			publisher: { publishReviewObservations },
		});

		const report = await runDiningSync(input);

		expect(report).toMatchObject({
			attachmentCount: 1,
			blockedCount: 0,
			publishedCount: 1,
			readCount: 1,
			reusedCount: 0,
			status: "published",
		});
		expect(input.attachmentStore.materialize).toHaveBeenCalledWith({
			record: SAFE_RECORD,
			runId: RUN.runId,
		});
		expect(publishReviewObservations).toHaveBeenCalledWith(
			[expect.objectContaining({ status: "accepted", targetKind: "review" })],
			"dining_release:catalog-1",
		);
		expect(events).toEqual(["complete", "list", "publish", "succeed"]);
		expect(JSON.stringify(report)).not.toContain("placeholder");
	});

	it("reuses unchanged processed observations without moderation or attachment work", async () => {
		const observationStore = createObservationStore();
		const moderator = { check: vi.fn(async () => ({ status: "safe" as const })) };
		const attachmentStore = { materialize: vi.fn(async () => []) };
		const reviewResolver = createDependencies().reviewResolver;
		const input = createDependencies({
			attachmentStore,
			moderator,
			observationStore,
			reviewResolver,
		});

		await runDiningSync(input);
		const second = await runDiningSync({ ...input, run: { ...RUN, runId: `${RUN.runId}:2` } });

		expect(second.reusedCount).toBe(1);
		expect(moderator.check).toHaveBeenCalledTimes(1);
		expect(attachmentStore.materialize).toHaveBeenCalledTimes(1);
		expect(reviewResolver.resolve).toHaveBeenCalledTimes(1);
	});

	it("reprocesses unchanged source records after a catalog release changes", async () => {
		const observationStore = createObservationStore();
		const moderator = { check: vi.fn(async () => ({ status: "safe" as const })) };
		const input = createDependencies({ moderator, observationStore });

		await runDiningSync(input);
		const second = await runDiningSync({
			...input,
			catalogReleaseId: "dining_release:catalog-2",
			run: { ...RUN, runId: `${RUN.runId}:2` },
		});

		expect(second.reusedCount).toBe(0);
		expect(moderator.check).toHaveBeenCalledTimes(2);
	});

	it("records blocked source, text, resolution, and image outcomes while continuing the snapshot", async () => {
		const records = [
			{ ...SAFE_RECORD, sourceBlockReason: "source_record_invalid", sourceRecordId: "source" },
			{ ...SAFE_RECORD, sourceRecordId: "text" },
			{ ...SAFE_RECORD, sourceRecordId: "binding" },
			{ ...SAFE_RECORD, sourceRecordId: "image" },
			{ ...SAFE_RECORD, sourceRecordId: "safe" },
		];
		const moderator = {
			check: vi
				.fn()
				.mockResolvedValueOnce({ status: "blocked" })
				.mockResolvedValue({ status: "safe" }),
		};
		const reviewResolver = {
			resolve: vi
				.fn()
				.mockReturnValueOnce({ reason: "stall_not_found", status: "blocked" })
				.mockReturnValue({
					hallId: "hall:1",
					hallName: "海淀一食堂",
					offeringId: "offering:1",
					stallProfileId: "stall:1",
					status: "resolved",
					windowId: "window:1",
				}),
		};
		const attachmentStore = {
			materialize: vi
				.fn()
				.mockRejectedValueOnce(
					new DiningAttachmentRejectedError("image_moderation_blocked", "blocked"),
				)
				.mockResolvedValueOnce([]),
		};

		const report = await runDiningSync(
			createDependencies({ attachmentStore, moderator, records, reviewResolver }),
		);

		expect(report).toMatchObject({
			blockedCount: 4,
			blockedReasons: {
				content_moderation_blocked: 1,
				image_moderation_blocked: 1,
				source_record_invalid: 1,
				stall_not_found: 1,
			},
			publishedCount: 1,
			readCount: 5,
		});
	});

	it("does not land or publish a partial snapshot after an infrastructure failure", async () => {
		const observationStore = createObservationStore();
		const publisher = { publishReviewObservations: vi.fn(async () => 1) };
		const input = createDependencies({
			moderator: {
				check: vi.fn(async () => {
					throw new Error("moderation unavailable");
				}),
			},
			observationStore,
			publisher,
		});

		await expect(runDiningSync(input)).rejects.toThrow(/moderation unavailable/);
		expect(observationStore.completeReviewRun).not.toHaveBeenCalled();
		expect(publisher.publishReviewObservations).not.toHaveBeenCalled();
		expect(observationStore.succeedRun).not.toHaveBeenCalled();
	});
});
