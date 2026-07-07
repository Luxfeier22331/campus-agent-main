import { createDevDiningOperationsState } from "@campus-agent/dining/domain";
import { describe, expect, it, vi } from "vitest";

import {
	PostgresDiningPublishedCloseoutVerifier,
	type DiningPublishedCloseoutPgClient,
} from "../src/published-closeout";

function createClient(input: {
	reviewCount?: number;
	snapshotPayload?: Record<string, unknown> | null;
	unsafeImage?: boolean;
}): DiningPublishedCloseoutPgClient & { queries: string[] } {
	const queries: string[] = [];
	return {
		connect: vi.fn(async () => undefined),
		end: vi.fn(async () => undefined),
		queries,
		query: vi.fn(async (sql: string) => {
			queries.push(sql);
			if (sql.includes('"dining"."release_latest_pointer"')) {
				return {
					rows: input.snapshotPayload
						? [
								{
									payload_json: input.snapshotPayload,
									release_id: "dining_release:test",
									updated_at: new Date("2026-07-02T00:00:00.000Z"),
								},
							]
						: [],
				};
			}
			if (sql.includes('"dining"."review_projections"') && sql.includes("count(*)")) {
				return { rows: [{ review_count: input.reviewCount ?? 0 }] };
			}
			if (sql.includes("images_json::text")) {
				return { rows: input.unsafeImage ? [{ review_id: "review_leak" }] : [] };
			}
			return { rows: [] };
		}),
	};
}

describe("published dining closeout", () => {
	it("verifies a published snapshot and review projection without writing data", async () => {
		const state = createDevDiningOperationsState();
		const client = createClient({
			reviewCount: 2,
			snapshotPayload: state.publishedSnapshot as unknown as Record<string, unknown>,
		});

		const summary = await new PostgresDiningPublishedCloseoutVerifier({
			createClient: () => client,
		}).verify();

		expect(summary).toMatchObject({
			releaseId: "dining_release:test",
			reviewCount: 2,
			status: "published_snapshot_ready",
			totalFloorCount: 7,
		});
		expect(summary.halls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ hallId: "haidian-canteen-2", placeholderFloorCount: 0 }),
				expect.objectContaining({ hallId: "fengtai-juya-canteen", placeholderFloorCount: 0 }),
			]),
		);
		expect(client.queries.join("\n")).not.toMatch(/\b(insert|update|delete)\b/i);
	});

	it("fails closed when the latest published snapshot is missing", async () => {
		await expect(
			new PostgresDiningPublishedCloseoutVerifier({
				createClient: () => createClient({ snapshotPayload: null }),
			}).verify(),
		).rejects.toThrow(/latest published snapshot is missing/);
	});

	it("fails closed when review image projections expose source provider tokens", async () => {
		const state = createDevDiningOperationsState();

		await expect(
			new PostgresDiningPublishedCloseoutVerifier({
				createClient: () =>
					createClient({
						snapshotPayload: state.publishedSnapshot as unknown as Record<string, unknown>,
						unsafeImage: true,
					}),
			}).verify(),
		).rejects.toThrow(/source-provider tokens/);
	});
});
