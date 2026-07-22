import { describe, expect, it, vi } from "vitest";

import type {
	DiningSourceObservation,
	FeishuReviewSourceIdentity,
} from "../src/catalog-source-types.ts";
import { runDiningSync } from "../src/sync-pipeline.ts";
import type { DiningSourceRecord } from "../src/types.ts";

const SAFE_RECORD: DiningSourceRecord = {
		attachments: [
			{
				fileToken: "placeholder",
				name: "meal.jpg",
				size: 100,
		},
	],
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

const SOURCE_IDENTITY = {
	baseToken: "base",
	reviewTableId: "tbl_review",
} satisfies FeishuReviewSourceIdentity;

function defaultReviewResolver() {
	return {
		resolve: vi.fn(() => ({
			hallId: "haidian-canteen-1",
			hallName: "海淀一食堂",
			offeringId: "offering:fish-noodle",
			stallProfileId: "stall:fish-noodle",
			status: "resolved" as const,
			windowId: "window:haidian-canteen-1:01",
		})),
	};
}

function createInMemoryReviewObservationStore(initial: DiningSourceObservation[] = []) {
	let activeObservations = [...initial];
	return {
		listActiveFeishuReviewObservations: vi.fn(async () => activeObservations),
		upsertFeishuReviewObservations: vi.fn(
			async (observations: DiningSourceObservation[]) => {
				activeObservations = observations;
				return {
					acceptedCount: observations.filter((observation) => observation.status === "accepted")
						.length,
					blockedCount: observations.filter((observation) => observation.status === "blocked")
						.length,
					runId: "dining_feishu_review_sync:test",
					staleCount: 0,
					totalCount: observations.length,
				};
			},
		),
	};
}

describe("dining sync pipeline", () => {
	it("publishes safe records with materialized attachment URLs and no Lark tokens", async () => {
		const report = await runDiningSync({
			attachmentStore: {
				materialize: vi.fn(async ({ record }) => [
					{
						alt: `${record.dishName}评价图片`,
						imageId: `dining-review-image:${record.sourceRecordId}:1`,
						url: `/assets/dining/reviews/${record.sourceRecordId}.jpg`,
					},
				]),
			},
			reviewResolver: defaultReviewResolver(),
			moderator: {
				check: vi.fn(async () => ({ status: "safe" as const })),
			},
			observationStore: createInMemoryReviewObservationStore(),
			publisher: {
				publishReviewObservations: vi.fn(async () => 1),
			},
			records: [SAFE_RECORD],
			sourceIdentity: SOURCE_IDENTITY,
		});

		expect(report).toMatchObject({
			attachmentCount: 1,
			blockedCount: 0,
			blockedReasons: {},
			observationSync: {
				acceptedCount: 1,
				blockedCount: 0,
				runId: "dining_feishu_review_sync:test",
				staleCount: 0,
				totalCount: 1,
			},
			publishedCount: 1,
			readCount: 1,
			status: "published",
		});
		expect(report.reviews).toEqual([
			expect.objectContaining({
				images: [
					{
						alt: "金汤鱼粉评价图片",
						imageId: "dining-review-image:rec-safe:1",
						url: "/assets/dining/reviews/rec-safe.jpg",
					},
				],
				sourceRecordId: "rec-safe",
				stallProfileId: "stall:fish-noodle",
				windowId: "window:haidian-canteen-1:01",
			}),
		]);
		expect(JSON.stringify(report)).not.toContain("fileToken");
		expect(JSON.stringify(report)).not.toContain("placeholder");
	});

	it("blocks reviews whose submitted stall is not in the published catalog", async () => {
		const report = await runDiningSync({
			attachmentStore: {
				materialize: vi.fn(async () => []),
			},
			reviewResolver: {
				resolve: vi.fn(() => ({
					reason: "stall_not_found" as const,
					status: "blocked" as const,
				})),
			},
			moderator: {
				check: vi.fn(async () => ({ status: "safe" as const })),
			},
			observationStore: createInMemoryReviewObservationStore(),
			publisher: {
				publishReviewObservations: vi.fn(async () => 1),
			},
			records: [{ ...SAFE_RECORD, stallName: "进门就是" }],
			sourceIdentity: SOURCE_IDENTITY,
		});

		expect(report).toMatchObject({
			blockedCount: 1,
			blockedReasons: { stall_not_found: 1 },
			publishedCount: 0,
			status: "no_publishable_records",
		});
		expect(report.reviews).toEqual([]);
	});

	it("skips inconsistent hall records without blocking later valid reviews", async () => {
		const report = await runDiningSync({
			attachmentStore: {
				materialize: vi.fn(async () => []),
			},
			reviewResolver: {
				resolve: vi.fn((input: { hallName: string }) =>
					input.hallName === "聚雅一层"
						? { reason: "hall_not_found" as const, status: "blocked" as const }
						: {
								hallId: "haidian-canteen-1",
								hallName: "海淀一食堂",
								offeringId: "offering:fish-noodle",
								stallProfileId: "stall:fish-noodle",
								status: "resolved" as const,
								windowId: "window:fish-noodle",
							},
				),
			},
			moderator: {
				check: vi.fn(async () => ({ status: "safe" as const })),
			},
			observationStore: createInMemoryReviewObservationStore(),
			publisher: {
				publishReviewObservations: vi.fn(async () => 1),
			},
			records: [
				{
					...SAFE_RECORD,
					hallName: "聚雅一层",
					sourceRecordId: "rec-inconsistent-hall",
				},
				{ ...SAFE_RECORD, sourceRecordId: "rec-valid-after-inconsistent" },
			],
			sourceIdentity: SOURCE_IDENTITY,
		});

		expect(report).toMatchObject({
			blockedCount: 1,
			blockedReasons: { hall_not_found: 1 },
			publishedCount: 1,
			readCount: 2,
			status: "published",
		});
		expect(report.reviews).toEqual([
			expect.objectContaining({ sourceRecordId: "rec-valid-after-inconsistent" }),
		]);
	});

	it("lands review observations before publishing active review projections", async () => {
		const publishReviewObservations = vi.fn(async () => 1);
		const upsertFeishuReviewObservations = vi.fn(async () => ({
			acceptedCount: 1,
			blockedCount: 0,
			runId: "dining_feishu_review_sync:test",
			staleCount: 0,
			totalCount: 1,
		}));
		const listActiveFeishuReviewObservations = vi.fn(async () => [
			{
				observationId: "feishu:review:rec-safe",
				observedAt: "2026-07-01T00:00:00.000Z",
				payloadJson: {
					blockReason: null,
					campus: "海淀校区",
					comment: "清淡，分量合适",
					contributorName: "果小生",
					dishName: "金汤鱼粉",
					hallId: "haidian-canteen-1",
					hallName: "海淀一食堂",
					images: [],
					offeringId: "offering:fish-noodle",
					paidPriceLabel: "12 元",
					rating: 4,
					reviewId: "dining-review:rec-safe",
					sourceRecordId: "rec-safe",
					stallName: "鱼粉",
					stallProfileId: "stall:fish-noodle",
					submittedAt: "2026-07-01T08:00:00.000Z",
					windowId: "window:haidian-canteen-1:01",
				},
				sourceType: "feishu_review" as const,
				status: "accepted" as const,
				targetId: "dining-review:rec-safe",
				targetKind: "review" as const,
			},
		]);

		await runDiningSync({
			attachmentStore: {
				materialize: vi.fn(async () => []),
			},
			reviewResolver: defaultReviewResolver(),
			moderator: {
				check: vi.fn(async () => ({ status: "safe" as const })),
			},
			observationStore: {
				listActiveFeishuReviewObservations,
				upsertFeishuReviewObservations,
			},
			publisher: { publishReviewObservations },
			records: [SAFE_RECORD],
			sourceIdentity: { baseToken: "base", reviewTableId: "tbl_review" },
		});

		expect(upsertFeishuReviewObservations).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					sourceType: "feishu_review",
					targetKind: "review",
				}),
			],
			{ baseToken: "base", reviewTableId: "tbl_review" },
		);
		expect(listActiveFeishuReviewObservations).toHaveBeenCalled();
		expect(publishReviewObservations).toHaveBeenCalledWith([
			expect.objectContaining({
				payloadJson: expect.objectContaining({
					offeringId: "offering:fish-noodle",
					reviewId: "dining-review:rec-safe",
					stallProfileId: "stall:fish-noodle",
					windowId: "window:haidian-canteen-1:01",
				}),
				status: "accepted",
			}),
		]);
	});

	it("fails closed when the moderation provider errors", async () => {
		const publishReviewObservations = vi.fn(async () => 1);

		await expect(
			runDiningSync({
				attachmentStore: {
					materialize: vi.fn(async () => []),
				},
			reviewResolver: defaultReviewResolver(),
				moderator: {
					check: vi.fn(async () => {
						throw new Error("moderation unavailable");
					}),
				},
				publisher: { publishReviewObservations },
				records: [SAFE_RECORD],
				observationStore: createInMemoryReviewObservationStore(),
				sourceIdentity: SOURCE_IDENTITY,
			}),
		).rejects.toThrow(/moderation unavailable/);

		expect(publishReviewObservations).not.toHaveBeenCalled();
	});

	it("fails closed when attachment materialization errors", async () => {
		const publishReviewObservations = vi.fn(async () => 1);

		await expect(
			runDiningSync({
				attachmentStore: {
					materialize: vi.fn(async () => {
						throw new Error("object store unavailable");
					}),
				},
			reviewResolver: defaultReviewResolver(),
				moderator: {
					check: vi.fn(async () => ({ status: "safe" as const })),
				},
				publisher: { publishReviewObservations },
				records: [SAFE_RECORD],
				observationStore: createInMemoryReviewObservationStore(),
				sourceIdentity: SOURCE_IDENTITY,
			}),
		).rejects.toThrow(/object store unavailable/);

		expect(publishReviewObservations).not.toHaveBeenCalled();
	});

	it("publishes an empty projection when no records are publishable", async () => {
		const publishReviewObservations = vi.fn(async () => 1);
		const report = await runDiningSync({
			attachmentStore: {
				materialize: vi.fn(async () => {
					throw new Error("should not materialize blocked records");
				}),
			},
			reviewResolver: defaultReviewResolver(),
			moderator: {
				check: vi
					.fn()
					.mockResolvedValueOnce({ status: "blocked" })
					.mockResolvedValueOnce({ status: "uncertain" }),
			},
			publisher: { publishReviewObservations },
			records: [
				{ ...SAFE_RECORD, sourceRecordId: "rec-blocked" },
				{ ...SAFE_RECORD, sourceRecordId: "rec-uncertain" },
			],
			observationStore: createInMemoryReviewObservationStore(),
			sourceIdentity: SOURCE_IDENTITY,
		});

		expect(report).toMatchObject({
			blockedCount: 2,
			blockedReasons: {
				content_moderation_blocked: 2,
			},
			publishedCount: 0,
			readCount: 2,
			status: "no_publishable_records",
		});
		expect(report.reviews).toEqual([]);
		expect(publishReviewObservations).toHaveBeenCalledWith([
			expect.objectContaining({ status: "blocked" }),
			expect.objectContaining({ status: "blocked" }),
		]);
	});

	it("publishes an empty projection when the source has no records", async () => {
		const publishReviewObservations = vi.fn(async () => 1);
		const report = await runDiningSync({
			attachmentStore: {
				materialize: vi.fn(async () => {
					throw new Error("should not materialize empty source records");
				}),
			},
			reviewResolver: defaultReviewResolver(),
			moderator: {
				check: vi.fn(async () => ({ status: "safe" as const })),
			},
			observationStore: createInMemoryReviewObservationStore(),
			publisher: { publishReviewObservations },
			records: [],
			sourceIdentity: SOURCE_IDENTITY,
		});

		expect(report).toMatchObject({
			blockedCount: 0,
			publishedCount: 0,
			readCount: 0,
			status: "no_publishable_records",
		});
		expect(report.reviews).toEqual([]);
		expect(publishReviewObservations).toHaveBeenCalledWith([]);
	});

	it("blocks records whose image moderation rejects and continues later records", async () => {
		const publishReviewObservations = vi.fn(async () => 1);
		const report = await runDiningSync({
			attachmentStore: {
				materialize: vi
					.fn()
					.mockRejectedValueOnce(new Error("Dining review image moderation blocked publication."))
					.mockResolvedValueOnce([]),
			},
			reviewResolver: defaultReviewResolver(),
			moderator: {
				check: vi.fn(async () => ({ status: "safe" as const })),
			},
			observationStore: createInMemoryReviewObservationStore(),
			publisher: { publishReviewObservations },
			records: [
				{ ...SAFE_RECORD, sourceRecordId: "rec-image-blocked" },
				{ ...SAFE_RECORD, sourceRecordId: "rec-safe-after-image-block" },
			],
			sourceIdentity: SOURCE_IDENTITY,
		});

		expect(report).toMatchObject({
			attachmentCount: 0,
			blockedCount: 1,
			blockedReasons: {
				image_moderation_blocked: 1,
			},
			publishedCount: 1,
			readCount: 2,
			status: "published",
		});
		expect(report.reviews).toEqual([
			expect.objectContaining({ sourceRecordId: "rec-safe-after-image-block" }),
		]);
		expect(publishReviewObservations).toHaveBeenCalledWith([
			expect.objectContaining({
				payloadJson: expect.objectContaining({ sourceRecordId: "rec-image-blocked" }),
				status: "blocked",
			}),
			expect.objectContaining({
				payloadJson: expect.objectContaining({ sourceRecordId: "rec-safe-after-image-block" }),
				status: "accepted",
			}),
		]);
	});
});
