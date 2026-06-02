// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	identityAccessSnapshots,
	identityAccounts,
	identityPreferenceSettings,
	identityProfiles,
	profileMemorySettings,
} from "../src/db/schema";
import type { IdentityPlatformOverview } from "../src/modules/identity-platform";
import { createPgIdentityPlatformStore } from "../src/modules/identity-platform";

function createOverview(): IdentityPlatformOverview {
	return {
		account: {
			accountId: "user_01HQ",
			displayName: "Jane Doe",
			email: "jane@muc.edu.cn",
			status: "active",
		},
		session: {
			credentialRuntime: "better_auth",
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
			state: "authenticated",
		},
		identity: {
			campusAttributes: {
				cohort: "2026",
				departments: ["computer_science"],
				major: "software_engineering",
				program: "undergraduate",
			},
			claimsVersion: "policy-v2",
			principalId: "user_01HQ",
			principalType: "student",
			verificationStatus: "unverified",
		},
		access: {
			availableApps: ["chat", "docs", "account"],
			entitlementGroups: ["campus_members", "students"],
			permissions: {
				chat: true,
				operator: false,
			},
			restrictedSurfacesReady: true,
		},
		preferences: {
			profileMemoryEnabled: false,
			profileMemoryItemCount: 2,
		},
		federation: {
			connectedClients: [],
			enabled: false,
		},
	};
}

function createInsertRecorder() {
	const writes: Array<{
		conflict: unknown;
		table: unknown;
		values: unknown;
	}> = [];
	const insert = vi.fn((table: unknown) => {
		const write = {
			conflict: null as unknown,
			table,
			values: null as unknown,
		};
		writes.push(write);
		return {
			values: vi.fn((values: unknown) => {
				write.values = values;
				return {
					onConflictDoUpdate: vi.fn((conflict: unknown) => {
						write.conflict = conflict;
						return Promise.resolve();
					}),
				};
			}),
		};
	});
	return { insert, writes };
}

describe("identity platform store", () => {
	it("materializes lifecycle projections without mutating profile memory settings", async () => {
		const { insert, writes } = createInsertRecorder();
		const transaction = vi.fn(
			async (callback: (tx: { insert: typeof insert }) => Promise<void>) => {
				await callback({ insert });
			},
		);
		const store = createPgIdentityPlatformStore({} as never, {
			getDb: () =>
				({
					transaction,
				}) as never,
		});

		await store.materializeIdentityProjection({
			observedAt: "2026-03-29T08:00:00.000Z",
			projection: createOverview(),
			snapshotId: "access_snapshot_01HQ",
		});

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(writes.map((write) => write.table)).toEqual([
			identityAccounts,
			identityProfiles,
			identityPreferenceSettings,
			identityAccessSnapshots,
		]);
		expect(writes[0].values).toMatchObject({
			accountId: "user_01HQ",
			displayName: "Jane Doe",
			primaryEmail: "jane@muc.edu.cn",
			status: "active",
		});
		expect(writes[2].values).toMatchObject({
			accountId: "user_01HQ",
			profileMemoryEnabled: false,
			uiPreferencesJson: {},
		});
	});

	it("materializes preference updates into profile and identity product tables", async () => {
		const { insert, writes } = createInsertRecorder();
		const transaction = vi.fn(
			async (callback: (tx: { insert: typeof insert }) => Promise<void>) => {
				await callback({ insert });
			},
		);
		const store = createPgIdentityPlatformStore({} as never, {
			getDb: () =>
				({
					transaction,
				}) as never,
		});

		await store.updatePreferencesAndMaterialize({
			observedAt: "2026-03-29T08:00:00.000Z",
			overview: createOverview(),
			snapshotId: "access_snapshot_01HQ",
		});

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(writes.map((write) => write.table)).toEqual([
			profileMemorySettings,
			identityAccounts,
			identityProfiles,
			identityPreferenceSettings,
			identityAccessSnapshots,
		]);
		expect(writes[0].values).toMatchObject({
			ownerUserId: "user_01HQ",
			profileMemoryEnabled: false,
			updatedAt: new Date("2026-03-29T08:00:00.000Z"),
		});
		expect(writes[1].values).toMatchObject({
			accountId: "user_01HQ",
			displayName: "Jane Doe",
			primaryEmail: "jane@muc.edu.cn",
			status: "active",
		});
		expect(writes[2].values).toMatchObject({
			accountId: "user_01HQ",
			campusAttributesJson: {
				cohort: "2026",
				departments: ["computer_science"],
				major: "software_engineering",
				program: "undergraduate",
			},
			claimsVersion: "policy-v2",
			principalId: "user_01HQ",
			principalType: "student",
			verificationStatus: "unverified",
			verifiedAt: null,
		});
		expect(writes[3].values).toMatchObject({
			accountId: "user_01HQ",
			profileMemoryEnabled: false,
			uiPreferencesJson: {},
		});
		expect(writes[4].values).toMatchObject({
			accountId: "user_01HQ",
			availableAppsJson: ["chat", "docs", "account"],
			entitlementGroupsJson: ["campus_members", "students"],
			permissionsJson: {
				chat: true,
				operator: false,
			},
			policyProjectionVersion: "policy-v2",
			principalId: "user_01HQ",
			restrictedSurfacesReady: true,
			snapshotId: "access_snapshot_01HQ",
		});
		expect(writes[4].conflict).toBeNull();
	});
});
