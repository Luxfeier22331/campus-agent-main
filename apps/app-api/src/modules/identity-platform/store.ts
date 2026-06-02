import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import {
	identityAccessSnapshots,
	identityAccounts,
	identityPreferenceSettings,
	identityProfiles,
	profileMemorySettings,
} from "../../db/schema";
import type { IdentityPlatformOverview } from "./model";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface IdentityPlatformStore {
	updatePreferencesAndMaterialize(input: {
		observedAt: string;
		overview: IdentityPlatformOverview;
		snapshotId: string;
	}): Promise<void>;
}

export function createPgIdentityPlatformStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): IdentityPlatformStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async updatePreferencesAndMaterialize(input) {
			const db = await getDb();
			const observedAt = new Date(input.observedAt);
			const accountId = input.overview.account.accountId;

			await db.transaction(async (tx) => {
				await tx
					.insert(profileMemorySettings)
					.values({
						ownerUserId: accountId,
						profileMemoryEnabled: input.overview.preferences.profileMemoryEnabled,
						updatedAt: observedAt,
					})
					.onConflictDoUpdate({
						set: {
							profileMemoryEnabled: input.overview.preferences.profileMemoryEnabled,
							updatedAt: observedAt,
						},
						target: profileMemorySettings.ownerUserId,
					});

				await tx
					.insert(identityAccounts)
					.values({
						accountId,
						createdAt: observedAt,
						displayName: input.overview.account.displayName,
						primaryEmail: input.overview.account.email,
						status: input.overview.account.status,
						updatedAt: observedAt,
					})
					.onConflictDoUpdate({
						set: {
							displayName: input.overview.account.displayName,
							primaryEmail: input.overview.account.email,
							status: input.overview.account.status,
							updatedAt: observedAt,
						},
						target: identityAccounts.accountId,
					});

				await tx
					.insert(identityProfiles)
					.values({
						accountId,
						campusAttributesJson: input.overview.identity.campusAttributes ?? {},
						claimsVersion: input.overview.identity.claimsVersion,
						expiresAt: null,
						principalId: input.overview.identity.principalId,
						principalType: input.overview.identity.principalType,
						updatedAt: observedAt,
						verificationStatus: input.overview.identity.verificationStatus,
						verifiedAt:
							input.overview.identity.verificationStatus === "verified" ? observedAt : null,
					})
					.onConflictDoUpdate({
						set: {
							campusAttributesJson: input.overview.identity.campusAttributes ?? {},
							claimsVersion: input.overview.identity.claimsVersion,
							expiresAt: null,
							principalId: input.overview.identity.principalId,
							principalType: input.overview.identity.principalType,
							updatedAt: observedAt,
							verificationStatus: input.overview.identity.verificationStatus,
							verifiedAt:
								input.overview.identity.verificationStatus === "verified" ? observedAt : null,
						},
						target: identityProfiles.accountId,
					});

				await tx
					.insert(identityPreferenceSettings)
					.values({
						accountId,
						profileMemoryEnabled: input.overview.preferences.profileMemoryEnabled,
						uiPreferencesJson: {},
						updatedAt: observedAt,
					})
					.onConflictDoUpdate({
						set: {
							profileMemoryEnabled: input.overview.preferences.profileMemoryEnabled,
							uiPreferencesJson: {},
							updatedAt: observedAt,
						},
						target: identityPreferenceSettings.accountId,
					});

				await tx.insert(identityAccessSnapshots).values({
					accountId,
					availableAppsJson: input.overview.access.availableApps,
					createdAt: observedAt,
					entitlementGroupsJson: input.overview.access.entitlementGroups,
					expiresAt: null,
					permissionsJson: input.overview.access.permissions,
					policyProjectionVersion: input.overview.identity.claimsVersion,
					principalId: input.overview.identity.principalId,
					restrictedSurfacesReady: input.overview.access.restrictedSurfacesReady,
					snapshotId: input.snapshotId,
				});
			});
		},
	};
}
