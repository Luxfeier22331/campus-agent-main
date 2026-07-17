import { describe, expect, it, vi } from "vitest";
import { PostgresDiningReviewPublisher } from "../src/postgres-publisher";
import type { DiningSourceObservation } from "../src/catalog-source-types";

function reviewObservation(status: "accepted" | "blocked"): DiningSourceObservation {
	return {
		observationId: "feishu:review:rec-1",
		observedAt: "2026-07-16T00:00:00.000Z",
		payloadJson: {
			campus: "海淀校区",
			comment: "味道不错",
			contributorName: "张同学",
			dishName: "番茄牛腩饭",
			hallName: "海淀一食堂",
			images: [],
			offeringId: "offering:1",
			paidPriceLabel: "¥16",
			rating: 5,
			reviewId: "review:1",
			sourceRecordId: "rec-1",
			stallName: "川味窗口",
			submittedAt: "2026-07-15T12:00:00.000Z",
		},
		sourceType: "feishu_review",
		status,
		targetId: status === "accepted" ? "review:1" : null,
		targetKind: "review",
	};
}

function createClient(input: { afterDigest: string; overrideVisibility?: string }) {
	let digestCalls = 0;
	const insertCalls: Array<{ params: unknown[]; sql: string }> = [];
	const statements: string[] = [];
	const client = {
		connect: vi.fn(async () => undefined),
		end: vi.fn(async () => undefined),
		query: vi.fn(async (sql: string, params: unknown[] = []) => {
			statements.push(sql);
			if (sql.includes("SELECT COALESCE(jsonb_agg")) {
				digestCalls += 1;
				return { rows: [{ value: digestCalls === 1 ? "[]" : input.afterDigest }] };
			}
			if (sql.includes("FROM dining.review_overrides")) {
				return { rows: [{ offering_id: null, visibility: input.overrideVisibility ?? null }] };
			}
			if (sql.includes("FROM dining.menu_offerings AS offering")) {
				return {
					rows: [{
						hall_id: "hall:1",
						offering_id: "offering:1",
						stall_profile_id: "stall:1",
						window_id: "window:1",
					}],
				};
			}
			if (sql.includes("INSERT INTO dining.reviews")) {
				insertCalls.push({ params, sql });
				return { rows: [] };
			}
			if (sql.includes("SELECT review_revision")) return { rows: [{ review_revision: 7 }] };
			return { rows: [] };
		}),
	};
	return { client, insertCalls, statements };
}

describe("Postgres Dining review publisher", () => {
	it("never publishes blocked content even when an old override requested restore", async () => {
		const fixture = createClient({ afterDigest: "[]", overrideVisibility: "published" });
		const publisher = new PostgresDiningReviewPublisher("postgres://dining", () => fixture.client as never);

		await expect(publisher.publishReviewObservations([reviewObservation("blocked")])).resolves.toBe(7);
		expect(fixture.insertCalls[0]?.params[13]).toBe("hidden");
		expect(fixture.statements.some((sql) => sql.includes("review_revision=review_revision+1"))).toBe(false);
	});

	it("publishes an exactly bound safe review and increments the public revision", async () => {
		const fixture = createClient({ afterDigest: "[published]" });
		const publisher = new PostgresDiningReviewPublisher("postgres://dining", () => fixture.client as never);

		await expect(publisher.publishReviewObservations([reviewObservation("accepted")])).resolves.toBe(7);
		const insert = fixture.insertCalls[0];
		expect(insert?.params.slice(13, 18)).toEqual([
			"published",
			"hall:1",
			"stall:1",
			"window:1",
			"offering:1",
		]);
		expect(insert?.sql).not.toContain("comment = EXCLUDED.comment");
		expect(fixture.statements.some((sql) => sql.includes("review_revision = review_revision + 1"))).toBe(true);
	});
});
