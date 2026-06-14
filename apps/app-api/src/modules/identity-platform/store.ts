import { and, desc, eq, isNull } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDatabase } from "../../db/runtime";
import {
	session as authSessions,
	identityAccessSnapshots,
	identityAccounts,
	identityFederationClients,
	identityFederationUserGrants,
	identityPreferenceSettings,
	identityProfiles,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
	profileMemorySettings,
} from "../../db/schema";
import type {
	IdentityPlatformAuthorizedApp,
	IdentityPlatformMaterializationProjection,
	IdentityPlatformOverview,
} from "./model";

type RuntimeDbGetter = () => Promise<RuntimeDatabase> | RuntimeDatabase;

export interface IdentityPlatformStore {
	listAuthorizedApps(input: { accountId: string }): Promise<IdentityPlatformAuthorizedApp[]>;
	listSecuritySessions(input: { accountId: string }): Promise<IdentityPlatformSessionRecord[]>;
	materializeIdentityProjection(input: {
		observedAt: string;
		projection: IdentityPlatformMaterializationProjection;
		snapshotId: string;
	}): Promise<void>;
	revokeAuthorizedApp(input: {
		accountId: string;
		clientId: string;
		revokedAt: string;
	}): Promise<boolean>;
	revokeSecuritySession(input: { accountId: string; sessionId: string }): Promise<boolean>;
	updatePreferencesAndMaterialize(input: {
		observedAt: string;
		overview: IdentityPlatformOverview;
		snapshotId: string;
	}): Promise<void>;
}

export interface IdentityPlatformSessionRecord {
	createdAt: string;
	expiresAt: string;
	lastActiveAt: string;
	sessionId: string;
	userAgent: null | string;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function toIsoString(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function materializeIdentityRows(input: {
	db: RuntimeDatabase;
	includeProfileMemorySettings: boolean;
	observedAt: Date;
	projection: IdentityPlatformMaterializationProjection;
	snapshotId: string;
}) {
	const accountId = input.projection.account.accountId;

	await input.db.transaction(async (tx) => {
		if (input.includeProfileMemorySettings) {
			await tx
				.insert(profileMemorySettings)
				.values({
					ownerUserId: accountId,
					profileMemoryEnabled: input.projection.preferences.profileMemoryEnabled,
					updatedAt: input.observedAt,
				})
				.onConflictDoUpdate({
					set: {
						profileMemoryEnabled: input.projection.preferences.profileMemoryEnabled,
						updatedAt: input.observedAt,
					},
					target: profileMemorySettings.ownerUserId,
				});
		}

		await tx
			.insert(identityAccounts)
			.values({
				accountId,
				createdAt: input.observedAt,
				displayName: input.projection.account.displayName,
				primaryEmail: input.projection.account.email,
				status: input.projection.account.status,
				updatedAt: input.observedAt,
			})
			.onConflictDoUpdate({
				set: {
					displayName: input.projection.account.displayName,
					primaryEmail: input.projection.account.email,
					status: input.projection.account.status,
					updatedAt: input.observedAt,
				},
				target: identityAccounts.accountId,
			});

		await tx
			.insert(identityProfiles)
			.values({
				accountId,
				campusAttributesJson: input.projection.identity.campusAttributes ?? {},
				claimsVersion: input.projection.identity.claimsVersion,
				expiresAt: null,
				principalId: input.projection.identity.principalId,
				principalType: input.projection.identity.principalType,
				updatedAt: input.observedAt,
				verificationStatus: input.projection.identity.verificationStatus,
				verifiedAt:
					input.projection.identity.verificationStatus === "verified" ? input.observedAt : null,
			})
			.onConflictDoUpdate({
				set: {
					campusAttributesJson: input.projection.identity.campusAttributes ?? {},
					claimsVersion: input.projection.identity.claimsVersion,
					expiresAt: null,
					principalId: input.projection.identity.principalId,
					principalType: input.projection.identity.principalType,
					updatedAt: input.observedAt,
					verificationStatus: input.projection.identity.verificationStatus,
					verifiedAt:
						input.projection.identity.verificationStatus === "verified" ? input.observedAt : null,
				},
				target: identityProfiles.accountId,
			});

		await tx
			.insert(identityPreferenceSettings)
			.values({
				accountId,
				profileMemoryEnabled: input.projection.preferences.profileMemoryEnabled,
				uiPreferencesJson: {},
				updatedAt: input.observedAt,
			})
			.onConflictDoUpdate({
				set: {
					profileMemoryEnabled: input.projection.preferences.profileMemoryEnabled,
					uiPreferencesJson: {},
					updatedAt: input.observedAt,
				},
				target: identityPreferenceSettings.accountId,
			});

		await tx.insert(identityAccessSnapshots).values({
			accountId,
			availableAppsJson: input.projection.access.availableApps,
			createdAt: input.observedAt,
			entitlementGroupsJson: input.projection.access.entitlementGroups,
			expiresAt: null,
			permissionsJson: input.projection.access.permissions,
			policyProjectionVersion: input.projection.identity.claimsVersion,
			principalId: input.projection.identity.principalId,
			restrictedSurfacesReady: input.projection.access.restrictedSurfacesReady,
			snapshotId: input.snapshotId,
		});
	});
}

export function createPgIdentityPlatformStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): IdentityPlatformStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async listAuthorizedApps(input) {
			const db = await getDb();
			const rows = await db
				.select({
					authorizedAt: identityFederationUserGrants.createdAt,
					clientId: identityFederationUserGrants.clientId,
					displayName: identityFederationClients.clientName,
					grantedScopes: identityFederationUserGrants.grantedScopesJson,
					homeUrl: oauthClient.uri,
				})
				.from(identityFederationUserGrants)
				.innerJoin(
					identityFederationClients,
					eq(identityFederationClients.clientId, identityFederationUserGrants.clientId),
				)
				.leftJoin(oauthClient, eq(oauthClient.clientId, identityFederationUserGrants.clientId))
				.where(
					and(
						eq(identityFederationUserGrants.accountId, input.accountId),
						eq(identityFederationUserGrants.grantState, "active"),
						isNull(identityFederationUserGrants.revokedAt),
						eq(identityFederationClients.enabled, true),
					),
				)
				.orderBy(desc(identityFederationUserGrants.createdAt));

			return rows.map((row) => ({
				authorizedAt: toIsoString(row.authorizedAt),
				clientId: row.clientId,
				displayName: row.displayName,
				grantedScopes: asStringArray(row.grantedScopes),
				homeUrl: row.homeUrl?.trim() || null,
				lastUsedAt: null,
				status: "active" as const,
			}));
		},

		async listSecuritySessions(input) {
			const db = await getDb();
			const rows = await db
				.select({
					createdAt: authSessions.createdAt,
					expiresAt: authSessions.expiresAt,
					lastActiveAt: authSessions.updatedAt,
					sessionId: authSessions.id,
					userAgent: authSessions.userAgent,
				})
				.from(authSessions)
				.where(eq(authSessions.userId, input.accountId))
				.orderBy(desc(authSessions.updatedAt));

			return rows.map((row) => ({
				createdAt: toIsoString(row.createdAt),
				expiresAt: toIsoString(row.expiresAt),
				lastActiveAt: toIsoString(row.lastActiveAt),
				sessionId: row.sessionId,
				userAgent: row.userAgent,
			}));
		},

		async materializeIdentityProjection(input) {
			const db = await getDb();
			await materializeIdentityRows({
				db,
				includeProfileMemorySettings: false,
				observedAt: new Date(input.observedAt),
				projection: input.projection,
				snapshotId: input.snapshotId,
			});
		},

		async revokeAuthorizedApp(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const revokedAt = new Date(input.revokedAt);
				const grants = await tx
					.update(identityFederationUserGrants)
					.set({
						grantState: "revoked",
						revokedAt,
					})
					.where(
						and(
							eq(identityFederationUserGrants.accountId, input.accountId),
							eq(identityFederationUserGrants.clientId, input.clientId),
							eq(identityFederationUserGrants.grantState, "active"),
							isNull(identityFederationUserGrants.revokedAt),
						),
					)
					.returning({ grantId: identityFederationUserGrants.grantId });
				if (grants.length === 0) {
					return false;
				}

				await tx
					.delete(oauthConsent)
					.where(
						and(
							eq(oauthConsent.userId, input.accountId),
							eq(oauthConsent.clientId, input.clientId),
						),
					);
				await tx
					.delete(oauthAccessToken)
					.where(
						and(
							eq(oauthAccessToken.userId, input.accountId),
							eq(oauthAccessToken.clientId, input.clientId),
						),
					);
				await tx
					.update(oauthRefreshToken)
					.set({ revoked: revokedAt })
					.where(
						and(
							eq(oauthRefreshToken.userId, input.accountId),
							eq(oauthRefreshToken.clientId, input.clientId),
							isNull(oauthRefreshToken.revoked),
						),
					);
				return true;
			});
		},

		async revokeSecuritySession(input) {
			const db = await getDb();
			const rows = await db
				.delete(authSessions)
				.where(and(eq(authSessions.id, input.sessionId), eq(authSessions.userId, input.accountId)))
				.returning({ sessionId: authSessions.id });
			return rows.length > 0;
		},

		async updatePreferencesAndMaterialize(input) {
			const db = await getDb();
			await materializeIdentityRows({
				db,
				includeProfileMemorySettings: true,
				observedAt: new Date(input.observedAt),
				projection: input.overview,
				snapshotId: input.snapshotId,
			});
		},
	};
}
