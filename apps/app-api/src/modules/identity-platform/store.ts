import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDatabase } from "../../db/runtime";
import {
	identityAccessSnapshots,
	identityAccounts,
	identityPreferenceSettings,
	identityProfiles,
	profileMemorySettings,
} from "../../db/schema";
import type { IdentityPlatformMaterializationProjection, IdentityPlatformOverview } from "./model";

type RuntimeDbGetter = () => Promise<RuntimeDatabase> | RuntimeDatabase;

export interface IdentityPlatformStore {
	materializeIdentityProjection(input: {
		observedAt: string;
		projection: IdentityPlatformMaterializationProjection;
		snapshotId: string;
	}): Promise<void>;
	updatePreferencesAndMaterialize(input: {
		observedAt: string;
		overview: IdentityPlatformOverview;
		snapshotId: string;
	}): Promise<void>;
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
