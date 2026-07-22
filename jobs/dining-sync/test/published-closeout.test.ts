import { createDevDiningSeed } from "@campus-agent/dining/domain";
import { describe, expect, it, vi } from "vitest";

import {
	PostgresDiningPublishedCloseoutVerifier,
	type DiningPublishedCloseoutPgClient,
} from "../src/published-closeout.ts";

function createClient(input: { missing?: boolean; reviewCount?: number; unsafeImage?: boolean } = {}) {
	const seed = createDevDiningSeed();
	const client: DiningPublishedCloseoutPgClient & { queries: string[] } = {
		connect: vi.fn(async () => undefined),
		end: vi.fn(async () => undefined),
		queries: [],
		query: vi.fn(async (sql: string) => {
			client.queries.push(sql);
			if (sql.includes('"dining"."publication"')) {
				return { rows: input.missing ? [] : [{
					payload_json: seed.snapshot,
					release_id: seed.release.releaseId,
					snapshot_hash: seed.release.snapshotHash,
					updated_at: new Date(seed.publication.updatedAt),
				}] };
			}
			if (sql.includes("count(*)")) return { rows: [{ review_count: input.reviewCount ?? 2 }] };
			if (sql.includes("images_json::text")) return { rows: input.unsafeImage ? [{ review_id: "bad" }] : [] };
			return { rows: [] };
		}),
	};
	return client;
}

describe("published dining closeout", () => {
	it("verifies the publication pointer, snapshot and public reviews without writes", async () => {
		const client = createClient({ reviewCount: 3 });
		const summary = await new PostgresDiningPublishedCloseoutVerifier({
			createClient: () => client,
		}).verify();
		expect(summary).toMatchObject({
			releaseId: "dining_release:dev_seed",
			reviewCount: 3,
			status: "published_snapshot_ready",
		});
		expect(client.queries.join("\n")).not.toMatch(/\b(insert|update|delete)\b/i);
		expect(client.end).toHaveBeenCalledOnce();
	});

	it("fails closed without a catalog publication", async () => {
		await expect(new PostgresDiningPublishedCloseoutVerifier({
			createClient: () => createClient({ missing: true }),
		}).verify()).rejects.toThrow(/latest published snapshot is missing/);
	});

	it("rejects source-provider tokens in public image projections", async () => {
		await expect(new PostgresDiningPublishedCloseoutVerifier({
			createClient: () => createClient({ unsafeImage: true }),
		}).verify()).rejects.toThrow(/source-provider tokens/);
	});
});
