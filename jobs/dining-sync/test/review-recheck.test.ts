import { describe, expect, it, vi } from "vitest";

import { processDiningReviewRechecks } from "../src/review-recheck.ts";

interface FixtureOptions {
	attemptCount?: number;
	images?: Array<{ alt: string; imageId: string; url: string }>;
	publishedChanges?: boolean;
}

function createClient(options: FixtureOptions = {}) {
	let digestCalls = 0;
	const statements: Array<{ params: unknown[]; sql: string }> = [];
	const client = {
		connect: vi.fn(async () => undefined),
		end: vi.fn(async () => undefined),
		query: vi.fn(async (sql: string, params: unknown[] = []) => {
			statements.push({ params, sql });
			if (sql.includes("SELECT c.request_id")) {
				return {
					rows: [
						{
							attempt_count: options.attemptCount ?? 1,
							comment: "原评价",
							contributor_name: "李同学",
							dish_name: "麻辣香锅",
							images_json: options.images ?? [],
							request_id: "request:1",
							review_id: "review:1",
							stall_name: "川味窗口",
						},
					],
				};
			}
			if (sql.includes("SELECT COALESCE(jsonb_agg")) {
				digestCalls += 1;
				return {
					rows: [
						{
							value: digestCalls === 1 || options.publishedChanges !== true ? "[published]" : "[]",
						},
					],
				};
			}
			if (sql.includes("SELECT visibility FROM dining.review_overrides")) {
				return { rows: [{ visibility: "published" }] };
			}
			if (sql.includes("SELECT hall_id,stall_profile_id")) {
				return {
					rows: [
						{
							hall_id: "hall:1",
							offering_id: "offering:1",
							stall_profile_id: "stall:1",
							window_id: "window:1",
						},
					],
				};
			}
			return { rows: [] };
		}),
	};
	return { client, statements };
}

describe("Dining review rechecks", () => {
	it("rechecks text and every published image before hiding blocked content", async () => {
		const images = [
			{ alt: "图一", imageId: "image:1", url: "https://assets.example.test/1.webp" },
			{ alt: "图二", imageId: "image:2", url: "https://assets.example.test/2.webp" },
		];
		const fixture = createClient({ images, publishedChanges: true });
		const checkImage = vi
			.fn()
			.mockResolvedValueOnce({ status: "safe" })
			.mockResolvedValueOnce({ status: "blocked" });

		await expect(
			processDiningReviewRechecks({
				createClient: () => fixture.client as never,
				databaseUrl: "postgres://dining",
				moderator: {
					check: vi.fn(async () => ({ status: "safe" as const })),
					checkImage,
				},
			}),
		).resolves.toEqual({ processed: 1, publishedChanged: true, retried: 0 });
		expect(checkImage).toHaveBeenNthCalledWith(1, { url: images[0]?.url });
		expect(checkImage).toHaveBeenNthCalledWith(2, { url: images[1]?.url });
		const update = fixture.statements.find(({ sql }) =>
			sql.includes("UPDATE dining.reviews SET moderation_status"),
		);
		expect(update?.params).toEqual(["blocked", "hidden", "review:1"]);
		expect(
			fixture.statements.some(({ sql }) => sql.includes("review_revision=review_revision+1")),
		).toBe(true);
	});

	it("returns failed moderation requests to the bounded retry queue", async () => {
		const fixture = createClient({ attemptCount: 2 });

		await expect(
			processDiningReviewRechecks({
				createClient: () => fixture.client as never,
				databaseUrl: "postgres://dining",
				moderator: {
					check: vi.fn(async () => {
						throw new Error("provider unavailable");
					}),
					checkImage: vi.fn(async () => ({ status: "safe" as const })),
				},
			}),
		).resolves.toEqual({ processed: 0, publishedChanged: false, retried: 1 });
		const retry = fixture.statements.find(({ sql }) => sql.includes("available_at=now()+"));
		expect(retry?.params).toEqual(["request:1", 2, "provider unavailable"]);
	});

	it("marks the third failed attempt terminal", async () => {
		const fixture = createClient({ attemptCount: 3 });

		await expect(
			processDiningReviewRechecks({
				createClient: () => fixture.client as never,
				databaseUrl: "postgres://dining",
				moderator: {
					check: vi.fn(async () => {
						throw new Error("provider unavailable");
					}),
					checkImage: vi.fn(async () => ({ status: "safe" as const })),
				},
			}),
		).resolves.toEqual({ processed: 1, publishedChanged: false, retried: 0 });
		expect(
			fixture.statements.some(({ sql }) => sql.includes("status='failed',completed_at=now()")),
		).toBe(true);
	});
});
