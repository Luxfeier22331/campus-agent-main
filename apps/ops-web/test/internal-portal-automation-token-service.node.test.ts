// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	createInternalPortalAutomationTokenService,
	hashAutomationToken,
} from "../src/server/internal-portal-automation-token-service.ts";
import type {
	InternalPortalAutomationTokenMetadata,
	InternalPortalAutomationTokenRecord,
	InternalPortalAutomationTokenStore,
} from "../src/server/internal-portal-automation-token-store.ts";

const TOKEN_ID = "11111111-1111-4111-8111-111111111111";

describe("internal portal automation token service", () => {
	it("hashes presented tokens, lists metadata, and supports repeated reveal", async () => {
		const records = new Map<string, InternalPortalAutomationTokenRecord>();
		const store = createMemoryStore(records);
		const service = createInternalPortalAutomationTokenService({
			now: () => new Date("2026-08-06T01:00:00.000Z"),
			randomId: () => TOKEN_ID,
			randomToken: () => "ops_secret",
			store,
		});

		const created = await service.create("  开发同步程序  ");
		expect(created).toMatchObject({
			name: "开发同步程序",
			tokenId: TOKEN_ID,
			tokenValue: "ops_secret",
		});
		expect(records.get(TOKEN_ID)?.tokenHash).toBe(hashAutomationToken("ops_secret"));
		expect(await service.authenticate("  ops_secret ")).toMatchObject({ tokenId: TOKEN_ID });
		expect(await service.authenticate("ops_secret with-space")).toBeNull();
		expect(await service.list()).toEqual([
			{
				createdAt: "2026-08-06T01:00:00.000Z",
				name: "开发同步程序",
				revokedAt: null,
				tokenId: TOKEN_ID,
			},
		]);
		expect(await service.reveal(TOKEN_ID)).toEqual(created);
		expect(await service.reveal(TOKEN_ID)).toEqual(created);
	});

	it("stops authentication after revocation without deleting the record", async () => {
		const records = new Map<string, InternalPortalAutomationTokenRecord>();
		const store = createMemoryStore(records);
		const service = createInternalPortalAutomationTokenService({
			now: () => new Date("2026-08-06T02:00:00.000Z"),
			randomId: () => TOKEN_ID,
			randomToken: () => "ops_secret",
			store,
		});

		await service.create("开发同步程序");
		const revoked = await service.revoke(TOKEN_ID);

		expect(revoked.revokedAt).toBe("2026-08-06T02:00:00.000Z");
		expect(await service.authenticate("ops_secret")).toBeNull();
		expect(await service.reveal(TOKEN_ID)).toMatchObject({ tokenValue: "ops_secret" });
	});
});

function createMemoryStore(
	records: Map<string, InternalPortalAutomationTokenRecord>,
): InternalPortalAutomationTokenStore {
	return {
		async authenticate(tokenHash) {
			const record = [...records.values()].find(
				(candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null,
			);
			return record ? toMetadata(record) : null;
		},
		async create(input) {
			const record: InternalPortalAutomationTokenRecord = {
				createdAt: input.createdAt.toISOString(),
				name: input.name,
				revokedAt: null,
				tokenHash: input.tokenHash,
				tokenId: input.tokenId,
				tokenValue: input.tokenValue,
			};
			records.set(record.tokenId, record);
			return record;
		},
		async get(tokenId) {
			return records.get(tokenId) ?? null;
		},
		async list() {
			return [...records.values()].map(toMetadata);
		},
		async revoke(tokenId, revokedAt) {
			const record = records.get(tokenId);
			if (!record) {
				throw new Error("missing token");
			}
			record.revokedAt ??= revokedAt.toISOString();
			return record;
		},
	};
}

function toMetadata(
	record: InternalPortalAutomationTokenRecord,
): InternalPortalAutomationTokenMetadata {
	return {
		createdAt: record.createdAt,
		name: record.name,
		revokedAt: record.revokedAt,
		tokenId: record.tokenId,
	};
}
