import { boolean, index, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

const identity = pgSchema("identity");

export const identityAccounts = identity.table(
	"accounts",
	{
		accountId: text("account_id").primaryKey(),
		primaryEmail: text("primary_email").notNull(),
		displayName: text("display_name").notNull(),
		status: text("status").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		emailIndex: index("identity_accounts_primary_email_idx").on(table.primaryEmail),
		statusIndex: index("identity_accounts_status_idx").on(table.status),
	}),
);

export const identityProfiles = identity.table(
	"identity_profiles",
	{
		accountId: text("account_id").primaryKey(),
		principalId: text("principal_id").notNull(),
		principalType: text("principal_type").notNull(),
		verificationStatus: text("verification_status").notNull(),
		claimsVersion: text("claims_version").notNull(),
		campusAttributesJson: jsonb("campus_attributes_json").notNull().default({}),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		principalIndex: index("identity_profiles_principal_idx").on(table.principalId),
		verificationStatusIndex: index("identity_profiles_verification_status_idx").on(
			table.verificationStatus,
		),
	}),
);

export const identityAccessSnapshots = identity.table(
	"access_snapshots",
	{
		snapshotId: text("snapshot_id").primaryKey(),
		accountId: text("account_id").notNull(),
		principalId: text("principal_id").notNull(),
		entitlementGroupsJson: jsonb("entitlement_groups_json").notNull().default([]),
		availableAppsJson: jsonb("available_apps_json").notNull().default([]),
		permissionsJson: jsonb("permissions_json").notNull().default({}),
		restrictedSurfacesReady: boolean("restricted_surfaces_ready").notNull().default(false),
		policyProjectionVersion: text("policy_projection_version").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
	},
	(table) => ({
		accountCreatedAtIndex: index("identity_access_snapshots_account_created_at_idx").on(
			table.accountId,
			table.createdAt,
		),
		principalIndex: index("identity_access_snapshots_principal_idx").on(table.principalId),
	}),
);

export const identityPreferenceSettings = identity.table("preference_settings", {
	accountId: text("account_id").primaryKey(),
	profileMemoryEnabled: boolean("profile_memory_enabled").notNull().default(true),
	uiPreferencesJson: jsonb("ui_preferences_json").notNull().default({}),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const identityFederationClients = identity.table(
	"federation_clients",
	{
		clientId: text("client_id").primaryKey(),
		clientType: text("client_type").notNull(),
		clientName: text("client_name").notNull(),
		redirectUrisJson: jsonb("redirect_uris_json").notNull().default([]),
		postLogoutRedirectUrisJson: jsonb("post_logout_redirect_uris_json").notNull().default([]),
		allowedScopesJson: jsonb("allowed_scopes_json").notNull().default([]),
		claimsPolicyId: text("claims_policy_id").notNull(),
		consentPolicy: text("consent_policy").notNull(),
		enabled: boolean("enabled").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		enabledIndex: index("identity_federation_clients_enabled_idx").on(table.enabled),
		claimsPolicyIndex: index("identity_federation_clients_claims_policy_idx").on(
			table.claimsPolicyId,
		),
	}),
);

export const identityFederationClaimsPolicies = identity.table("federation_claims_policies", {
	claimsPolicyId: text("claims_policy_id").primaryKey(),
	allowedScopesJson: jsonb("allowed_scopes_json").notNull().default([]),
	allowedClaimsJson: jsonb("allowed_claims_json").notNull().default([]),
	campusClaimNamespaceJson: jsonb("campus_claim_namespace_json").notNull().default({}),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const identityFederationUserGrants = identity.table(
	"federation_user_grants",
	{
		grantId: text("grant_id").primaryKey(),
		accountId: text("account_id").notNull(),
		clientId: text("client_id").notNull(),
		grantedScopesJson: jsonb("granted_scopes_json").notNull().default([]),
		grantState: text("grant_state").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(table) => ({
		accountClientIndex: index("identity_federation_user_grants_account_client_idx").on(
			table.accountId,
			table.clientId,
		),
		clientIndex: index("identity_federation_user_grants_client_idx").on(table.clientId),
	}),
);
