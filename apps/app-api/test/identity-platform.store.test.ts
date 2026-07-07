// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	session as authSessions,
	identityAccessSnapshots,
	identityAccounts,
	identityFederationUserGrants,
	identityPreferenceSettings,
	identityProfiles,
	oauthAccessToken,
	oauthConsent,
	oauthRefreshToken,
	profileMemorySettings,
} from "../src/db/schema";
import type { IdentityPlatformOverview } from "../src/modules/identity-platform";
import { createPgIdentityPlatformStore } from "../src/modules/identity-platform";

function createOverview(): IdentityPlatformOverview {
	return {
		account: {
			accountId: "user_01HQ",
			displayName: "Jane Doe",
			email: "jane@example.edu",
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
			primaryEmail: "jane@example.edu",
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
			primaryEmail: "jane@example.edu",
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

	it("revokes only owned auth sessions through the session table", async () => {
		const deleteCalls: unknown[] = [];
		const returning = vi.fn().mockResolvedValue([{ sessionId: "sess_other" }]);
		const where = vi.fn(() => ({ returning }));
		const deleteMock = vi.fn((table: unknown) => {
			deleteCalls.push(table);
			return { where };
		});
		const store = createPgIdentityPlatformStore({} as never, {
			getDb: () =>
				({
					delete: deleteMock,
				}) as never,
		});

		const revoked = await store.revokeSecuritySession({
			accountId: "user_01HQ",
			sessionId: "sess_other",
		});

		expect(revoked).toBe(true);
		expect(deleteCalls).toEqual([authSessions]);
		expect(where).toHaveBeenCalledTimes(1);
		expect(returning).toHaveBeenCalledWith({ sessionId: authSessions.id });
	});

	it("revokes authorized app grants and clears auth token material transactionally", async () => {
		const writes: Array<{ table: unknown; values?: unknown }> = [];
		const deletes: unknown[] = [];
		const update = vi.fn((table: unknown) => ({
			set: vi.fn((values: unknown) => {
				writes.push({ table, values });
				return {
					where: vi.fn(() => ({
						returning: vi.fn().mockResolvedValue([{ grantId: "grant_01HQ" }]),
					})),
				};
			}),
		}));
		const deleteMock = vi.fn((table: unknown) => {
			deletes.push(table);
			return {
				where: vi.fn().mockResolvedValue([]),
			};
		});
		const transaction = vi.fn(
			async (
				callback: (tx: { delete: typeof deleteMock; update: typeof update }) => Promise<boolean>,
			) => callback({ delete: deleteMock, update }),
		);
		const store = createPgIdentityPlatformStore({} as never, {
			getDb: () =>
				({
					transaction,
				}) as never,
		});

		const revoked = await store.revokeAuthorizedApp({
			accountId: "user_01HQ",
			clientId: "muc-wiki",
			revokedAt: "2026-03-29T08:00:00.000Z",
		});

		expect(revoked).toBe(true);
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(writes).toEqual([
			{
				table: identityFederationUserGrants,
				values: {
					grantState: "revoked",
					revokedAt: new Date("2026-03-29T08:00:00.000Z"),
				},
			},
			{
				table: oauthRefreshToken,
				values: {
					revoked: new Date("2026-03-29T08:00:00.000Z"),
				},
			},
		]);
		expect(deletes).toEqual([oauthConsent, oauthAccessToken]);
	});
});
