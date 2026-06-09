import type { AppPermissions, AppPrincipalType, ResolvedAppPrincipal } from "../auth";

export type AccountStatus = "active" | "deleted" | "pending_recovery" | "suspended";
export type CredentialRuntime = "better_auth";
export type IdentityVerificationStatus = "expired" | "manual_review" | "unverified" | "verified";

export interface IdentityCampusAttributes {
	cohort?: string;
	departments?: string[];
	major?: string;
	program?: string;
}

export interface IdentityPlatformOverview {
	account: {
		accountId: string;
		displayName: string;
		email: string;
		status: AccountStatus;
	};
	session: {
		credentialRuntime: CredentialRuntime;
		expiresAt: string;
		sessionId: string;
		state: "authenticated";
	};
	identity: {
		campusAttributes?: IdentityCampusAttributes;
		claimsVersion: string;
		principalId: string;
		principalType: Exclude<AppPrincipalType, "operator" | "service">;
		verificationStatus: IdentityVerificationStatus;
	};
	access: {
		availableApps: string[];
		entitlementGroups: string[];
		permissions: AppPermissions;
		restrictedSurfacesReady: boolean;
	};
	preferences: {
		profileMemoryEnabled: boolean;
		profileMemoryItemCount: number;
	};
	federation: {
		connectedClients: string[];
		enabled: false;
	};
}

export type IdentityPlatformAccess = IdentityPlatformOverview["access"];
export interface IdentityPlatformMaterializationProjection {
	account: IdentityPlatformOverview["account"];
	identity: IdentityPlatformOverview["identity"];
	access: IdentityPlatformOverview["access"];
	preferences: IdentityPlatformOverview["preferences"];
	federation: IdentityPlatformOverview["federation"];
}
export type IdentityPlatformIdentity = IdentityPlatformOverview["identity"];

export interface IdentityPlatformPreferences {
	profileMemoryEnabled: boolean;
	profileMemoryItemCount: number;
}

export interface IdentityPlatformSecuritySession {
	createdAt: string;
	current: boolean;
	deviceLabel: string;
	expiresAt: string;
	lastActiveAt: string;
	sessionId: string;
}

export interface IdentityPlatformAuthorizedApp {
	authorizedAt: string;
	clientId: string;
	displayName: string;
	grantedScopes: string[];
	homeUrl: null | string;
	lastUsedAt: null | string;
	status: "active";
}

export type EndUserPrincipal = ResolvedAppPrincipal & {
	principal: ResolvedAppPrincipal["principal"] & {
		email: string;
		type: Exclude<AppPrincipalType, "operator" | "service">;
	};
	session: NonNullable<ResolvedAppPrincipal["session"]>;
};
