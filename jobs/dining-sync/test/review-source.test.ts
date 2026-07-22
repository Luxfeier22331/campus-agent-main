import { describe, expect, it } from "vitest";

import { buildReviewObservations, reviewsFromObservations } from "../src/review-source.ts";
import { PostgresDiningSourceObservationStore } from "../src/source-observation-store.ts";
import type { DiningSourceRecord } from "../src/types.ts";

const REVIEW_RECORD: DiningSourceRecord = {
	attachments: [],
	campus: "丰台校区",
	comment: "清淡，适合晚上吃",
	contributorName: "小明",
	dishName: "番茄鸡蛋面",
	hallName: "聚雅食堂",
	paidPriceLabel: "12 元",
	rating: 4,
	sourceRecordId: "rec-review-1",
	stallName: "简餐窗口",
	submittedAt: "2026-06-30T12:00:00.000Z",
};

describe("dining review source observations", () => {
	it("builds accepted Feishu review observations with stable dining bindings", () => {
		const observations = buildReviewObservations(
			[
				{
					blockReason: null,
					hallId: "fengtai-juya-canteen",
					hallName: "聚雅食堂",
				offeringId: "offering:tomato-noodle",
					record: REVIEW_RECORD,
					stallProfileId: "stall:rec-stall-simple",
					windowId: "window:fengtai-juya-canteen:1f:01",
				},
			],
			new Date("2026-07-01T00:00:00.000Z"),
		);

		expect(observations).toEqual([
			expect.objectContaining({
				observationId: "feishu:review:rec-review-1",
				payloadJson: expect.objectContaining({
					blockReason: null,
					dishName: "番茄鸡蛋面",
						hallId: "fengtai-juya-canteen",
						offeringId: "offering:tomato-noodle",
						stallProfileId: "stall:rec-stall-simple",
						submittedAt: "2026-06-30T12:00:00.000Z",
					windowId: "window:fengtai-juya-canteen:1f:01",
				}),
				sourceType: "feishu_review",
				status: "accepted",
				targetId: "dining-review:rec-review-1",
				targetKind: "review",
			}),
		]);
	});

	it("projects accepted review observations without exposing source attachment tokens", () => {
		const observations = buildReviewObservations(
			[
				{
					blockReason: null,
				hallId: "fengtai-juya-canteen",
				hallName: "聚雅食堂",
					images: [
						{
							alt: "番茄鸡蛋面评价图片",
							imageId: "dining-review-image:rec-review-1:1",
							url: "https://assets.example.test/dining/reviews/rec-review-1-1.jpg",
						},
					],
					record: {
						...REVIEW_RECORD,
						attachments: [{ fileToken: "lark-token", name: "meal.jpg", size: 12 }],
					},
					offeringId: "offering:tomato-noodle",
					stallProfileId: "stall:rec-stall-simple",
					windowId: "window:fengtai-juya-canteen:1f:01",
				},
			],
			new Date("2026-07-01T00:00:00.000Z"),
		);

		const reviews = reviewsFromObservations(observations);

		expect(reviews).toEqual([
			expect.objectContaining({
				hallId: "fengtai-juya-canteen",
				images: [
					{
						alt: "番茄鸡蛋面评价图片",
						imageId: "dining-review-image:rec-review-1:1",
						url: "https://assets.example.test/dining/reviews/rec-review-1-1.jpg",
					},
				],
				offeringId: "offering:tomato-noodle",
				reviewId: "dining-review:rec-review-1",
				stallProfileId: "stall:rec-stall-simple",
				windowId: "window:fengtai-juya-canteen:1f:01",
			}),
		]);
		expect(JSON.stringify(reviews)).not.toContain("lark-token");
	});

	it("rejects accepted observations without a complete offering binding", () => {
		for (const binding of [
			{ offeringId: "", stallProfileId: "stall:only", windowId: "window:only" },
			{ offeringId: "offering:only", stallProfileId: "", windowId: "" },
		]) {
			expect(() =>
				buildReviewObservations([
					{
						blockReason: null,
						hallId: "fengtai-juya-canteen",
						hallName: "聚雅食堂",
						record: REVIEW_RECORD,
						...binding,
					},
				]),
			).toThrow(/Invalid dining review observation/);
		}
	});

	it("keeps blocked review observations diagnostic without synthetic dining bindings", () => {
		const observations = buildReviewObservations(
			[
				{
						blockReason: "hall_not_found",
					record: REVIEW_RECORD,
				},
			],
			new Date("2026-07-01T00:00:00.000Z"),
		);

		expect(observations).toEqual([
			expect.objectContaining({
				payloadJson: expect.objectContaining({
					blockReason: "hall_not_found",
						hallId: null,
						offeringId: null,
					stallProfileId: null,
					windowId: null,
				}),
				status: "blocked",
				targetId: null,
			}),
		]);
		expect(reviewsFromObservations(observations)).toEqual([]);
	});

	it("upserts Feishu review observations without touching catalog or review projection tables", async () => {
		const queries: Array<{ sql: string; values?: unknown[] }> = [];
		const store = new PostgresDiningSourceObservationStore({
			createClient: () => ({
				connect: async () => undefined,
				end: async () => undefined,
				query: async (sql: string, values?: unknown[]) => {
					queries.push({ sql, values });
					return { rows: [] };
				},
			}),
		});

		await store.upsertFeishuReviewObservations(
			buildReviewObservations(
				[
					{
						blockReason: null,
						hallId: "fengtai-juya-canteen",
						hallName: "聚雅食堂",
						offeringId: "offering:tomato-noodle",
						record: REVIEW_RECORD,
						stallProfileId: "stall:rec-stall-simple",
						windowId: "window:fengtai-juya-canteen:1f:01",
					},
				],
				new Date("2026-07-01T00:00:00.000Z"),
			),
			{ baseToken: "base", reviewTableId: "tbl_review" },
		);

		const sql = queries.map((query) => query.sql).join("\n");
		expect(sql).toContain('"dining"."source_observations"');
		expect(queries.flatMap((query) => query.values ?? [])).toContain("feishu_review");
		expect(sql).toContain("ON CONFLICT");
		expect(sql).not.toContain("review_projections");
		expect(sql).not.toContain("menu_offerings");
	});
});
