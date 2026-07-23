import { createDevDiningSeed } from "@campus-agent/dining/domain";
import { describe, expect, it, vi } from "vitest";

import type { DiningSourceObservation } from "../src/catalog-source-types.ts";
import { PostgresDiningReviewPublisher } from "../src/postgres-publisher.ts";

const seed = createDevDiningSeed();
const offering = Object.values(seed.snapshot.floors)[0]?.menuOfferings[0];
if (!offering) {
	throw new Error("Dining dev seed must provide an offering for publisher tests.");
}

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
			offeringId: offering.offeringId,
			paidPriceLabel: "16 元",
			rating: 5,
			reviewId: "review:1",
			sourceHash: "sha256:source",
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
	const statements: Array<{ params: unknown[]; sql: string }> = [];
	const client = {
		connect: vi.fn(async () => undefined),
		end: vi.fn(async () => undefined),
		query: vi.fn(async (sql: string, params: unknown[] = []) => {
			statements.push({ params, sql });
			if (sql.includes("JOIN dining.releases")) {
				return {
					rows: [
						{
							catalog_release_id: seed.release.releaseId,
							payload_json: seed.snapshot,
							snapshot_hash: seed.release.snapshotHash,
						},
					],
				};
			}
			if (sql.includes("SELECT COALESCE(jsonb_agg")) {
				digestCalls += 1;
				return { rows: [{ value: digestCalls === 1 ? "[]" : input.afterDigest }] };
			}
			if (sql.includes("FROM dining.review_overrides")) {
				return { rows: [{ offering_id: null, visibility: input.overrideVisibility ?? null }] };
			}
			if (sql.includes("SELECT review_revision")) {
				return { rows: [{ review_revision: 7 }] };
			}
			return { rows: [] };
		}),
	};
	return { client, statements };
}

describe("Postgres Dining review publisher", () => {
	it("hides blocked content without honoring a stale restore override", async () => {
		const fixture = createClient({ afterDigest: "[]", overrideVisibility: "published" });
		const publisher = new PostgresDiningReviewPublisher(
			"postgres://dining",
			() => fixture.client as never,
		);

		await expect(
			publisher.publishReviewObservations([reviewObservation("blocked")], seed.release.releaseId),
		).resolves.toBe(7);
		const update = fixture.statements.find(({ sql }) =>
			sql.includes("UPDATE dining.reviews SET moderation_status='blocked'"),
		);
		expect(update?.params).toEqual(["review:1"]);
		expect(fixture.statements.some(({ sql }) => sql.includes("FROM dining.review_overrides"))).toBe(
			false,
		);
	});

	it("resolves accepted bindings only from the locked published snapshot", async () => {
		const fixture = createClient({ afterDigest: "[published]" });
		const publisher = new PostgresDiningReviewPublisher(
			"postgres://dining",
			() => fixture.client as never,
		);

		await expect(
			publisher.publishReviewObservations([reviewObservation("accepted")], seed.release.releaseId),
		).resolves.toBe(7);
		const insert = fixture.statements.find(({ sql }) => sql.includes("INSERT INTO dining.reviews"));
		expect(insert?.params.slice(13, 18)).toEqual([
			"published",
			expect.any(String),
			expect.any(String),
			expect.any(String),
			offering.offeringId,
		]);
		expect(fixture.statements.some(({ sql }) => sql.includes("FROM dining.menu_offerings"))).toBe(
			false,
		);
		expect(
			fixture.statements.some(({ sql }) => sql.includes("review_revision=review_revision+1")),
		).toBe(true);
	});

	it("rolls back when the publication changes after review processing", async () => {
		const fixture = createClient({ afterDigest: "[]" });
		fixture.client.query.mockImplementationOnce(async () => undefined as never);
		fixture.client.query.mockImplementationOnce(async () => ({
			rows: [
				{
					catalog_release_id: "dining_release:new",
					payload_json: seed.snapshot,
					snapshot_hash: seed.release.snapshotHash,
				},
			],
		}));
		const publisher = new PostgresDiningReviewPublisher(
			"postgres://dining",
			() => fixture.client as never,
		);

		await expect(
			publisher.publishReviewObservations([reviewObservation("accepted")], seed.release.releaseId),
		).rejects.toThrow(/catalog release changed/);
		expect(fixture.statements.at(-1)?.sql).toBe("ROLLBACK");
	});
});
