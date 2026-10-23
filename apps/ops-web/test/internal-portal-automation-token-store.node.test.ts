// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	createPgInternalPortalAutomationTokenStore,
	type InternalPortalAutomationTokenRecord,
} from "../src/server/internal-portal-automation-token-store.ts";

const createdAt = new Date("2026-08-06T01:00:00.000Z");

describe("internal portal automation token PostgreSQL store", () => {
	it("does not select token plaintext for authentication or ordinary lists", async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce({
				rows: [
					{
						createdAt,
						name: "同步程序",
						revokedAt: null,
						tokenId: "11111111-1111-4111-8111-111111111111",
					},
				],
			})
			.mockResolvedValueOnce({ rows: [] });
		const store = createPgInternalPortalAutomationTokenStore({ query });

		await expect(store.authenticate("a".repeat(64))).resolves.toMatchObject({
			tokenId: "11111111-1111-4111-8111-111111111111",
		});
		await expect(store.list()).resolves.toEqual([]);

		const selects = query.mock.calls.map(([sql]) => String(sql));
		for (const sql of selects) {
			const selectClause = sql.slice(0, sql.toLowerCase().indexOf("from"));
			expect(selectClause).not.toContain("token_value");
			expect(selectClause).not.toContain("token_hash");
		}
		expect(selects[0]).toContain("where token_hash = $1");
	});

	it("maps created and revoked rows without exposing database errors", async () => {
		const record: InternalPortalAutomationTokenRecord = {
			createdAt: createdAt.toISOString(),
			name: "同步程序",
			revokedAt: null,
			tokenHash: "a".repeat(64),
			tokenId: "11111111-1111-4111-8111-111111111111",
			tokenValue: "ops_secret",
		};
		const query = vi
			.fn()
			.mockResolvedValueOnce({ rows: [toRow(record)] })
			.mockResolvedValueOnce({ rows: [toRow({ ...record, revokedAt: createdAt.toISOString() })] });
		const store = createPgInternalPortalAutomationTokenStore({ query });

		await expect(
			store.create({
				createdAt,
				name: record.name,
				tokenHash: record.tokenHash,
				tokenId: record.tokenId,
				tokenValue: record.tokenValue,
			}),
		).resolves.toEqual(record);
		await expect(store.revoke(record.tokenId, createdAt)).resolves.toEqual({
			...record,
			revokedAt: createdAt.toISOString(),
		});
	});
});

function toRow(record: InternalPortalAutomationTokenRecord) {
	return {
		createdAt,
		name: record.name,
		revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
		tokenHash: record.tokenHash,
		tokenId: record.tokenId,
		tokenValue: record.tokenValue,
	};
}
