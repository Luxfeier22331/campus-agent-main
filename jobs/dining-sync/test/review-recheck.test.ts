import { describe, expect, it, vi } from "vitest";
import { processDiningReviewRechecks } from "../src/review-recheck.ts";

describe("Dining review rechecks", () => {
	it("hides newly blocked content despite a previous restore override", async () => {
		let digestCalls = 0;
		const reviewUpdates: unknown[][] = [];
		const statements: string[] = [];
		const client = {
			connect: vi.fn(async () => undefined),
			end: vi.fn(async () => undefined),
			query: vi.fn(async (sql: string, params: unknown[] = []) => {
				statements.push(sql);
				if (sql.includes("SELECT COALESCE(jsonb_agg")) {
					digestCalls += 1;
					return { rows: [{ value: digestCalls === 1 ? "[published]" : "[]" }] };
				}
				if (sql.includes("FROM dining.review_recheck_requests")) {
					return { rows: [{
						comment: "原评价",
						contributor_name: "李同学",
						dish_name: "麻辣香锅",
						hall_id: "hall:1",
						offering_id: "offering:1",
						request_id: "request:1",
						review_id: "review:1",
						stall_name: "川味窗口",
						stall_profile_id: "stall:1",
						visibility: "published",
						window_id: "window:1",
					}] };
				}
				if (sql.includes("SELECT visibility FROM dining.review_overrides")) {
					return { rows: [{ visibility: "published" }] };
				}
				if (sql.includes("UPDATE dining.reviews SET moderation_status")) {
					reviewUpdates.push(params);
				}
				return { rows: [] };
			}),
		};

		await expect(processDiningReviewRechecks({
			createClient: () => client as never,
			databaseUrl: "postgres://dining",
			moderator: { check: vi.fn(async () => ({ status: "blocked" as const })) },
		})).resolves.toEqual({ processed: 1, publishedChanged: true });
		expect(reviewUpdates[0]?.slice(0, 3)).toEqual(["blocked", "hidden", "review:1"]);
		expect(statements.some((sql) => sql.includes("review_revision=review_revision+1"))).toBe(true);
	});
});
