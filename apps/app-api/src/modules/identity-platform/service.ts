import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type { ProfileMemoryStore } from "../profile-memory";
import type { EndUserPrincipal, IdentityCampusAttributes, IdentityPlatformOverview } from "./model";

const END_USER_PRINCIPAL_TYPES = new Set(["campus_member", "student", "staff", "faculty"]);
const DEFAULT_CLAIMS_VERSION = "identity-claims-v1";

export interface IdentityPlatformService {
	getOverview(input: { principal: ResolvedAppPrincipal }): Promise<IdentityPlatformOverview>;
}

export interface IdentityPlatformServiceDependencies {
	profileMemoryStore: Pick<ProfileMemoryStore, "loadSummary">;
}

function createForbiddenError(message: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "forbidden",
		message,
		retryable: false,
		status: 403,
	});
}

function requireEndUserPrincipal(principal: ResolvedAppPrincipal): EndUserPrincipal {
	if (!END_USER_PRINCIPAL_TYPES.has(principal.principal.type)) {
		throw createForbiddenError("Account overview is only available for end-user principals.");
	}
	if (!principal.principal.email?.trim()) {
		throw createForbiddenError("Account overview requires a primary email.");
	}
	if (!principal.session) {
		throw createForbiddenError("Account overview requires an authenticated user session.");
	}

	return principal as EndUserPrincipal;
}

function buildCampusAttributes(principal: EndUserPrincipal): IdentityCampusAttributes | undefined {
	const attributes: IdentityCampusAttributes = {};
	if (principal.actor.departments.length > 0) {
		attributes.departments = principal.actor.departments;
	}
	if (principal.actor.cohort) {
		attributes.cohort = principal.actor.cohort;
	}
	if (principal.actor.major) {
		attributes.major = principal.actor.major;
	}
	if (principal.actor.program) {
		attributes.program = principal.actor.program;
	}

	return Object.keys(attributes).length > 0 ? attributes : undefined;
}

function resolveClaimsVersion(principal: EndUserPrincipal): string {
	const fromAuthorization = principal.authorization?.retrievalFilter.policyProjectionVersion.trim();
	return fromAuthorization || DEFAULT_CLAIMS_VERSION;
}

function resolveEntitlementGroups(principal: EndUserPrincipal): string[] {
	return principal.authorization?.entitlementGroups ?? [];
}

function resolveRestrictedSurfacesReady(principal: EndUserPrincipal): boolean {
	return Boolean(
		principal.authorization?.retrievalFilter.visibilityScope ||
			principal.authorization?.retrievalFilter.visibilityLevel === "restricted",
	);
}

function resolveAvailableApps(principal: EndUserPrincipal): string[] {
	const apps = ["docs", "account"];
	if (principal.permissions.chat) {
		apps.unshift("chat");
	}
	return apps;
}

export function buildIdentityPlatformService(
	dependencies: IdentityPlatformServiceDependencies,
): IdentityPlatformService {
	return {
		async getOverview(input) {
			const principal = requireEndUserPrincipal(input.principal);
			const profileMemory = await dependencies.profileMemoryStore.loadSummary({
				ownerUserId: principal.principal.principalId,
			});
			const campusAttributes = buildCampusAttributes(principal);
			const identity = {
				claimsVersion: resolveClaimsVersion(principal),
				principalId: principal.principal.principalId,
				principalType: principal.principal.type,
				verificationStatus: "unverified" as const,
			};

			return {
				account: {
					accountId: principal.principal.principalId,
					displayName: principal.principal.displayName,
					email: principal.principal.email,
					status: "active",
				},
				session: {
					credentialRuntime: "better_auth",
					expiresAt: principal.session.expiresAt,
					sessionId: principal.session.sessionId,
					state: "authenticated",
				},
				identity: campusAttributes ? { ...identity, campusAttributes } : identity,
				access: {
					availableApps: resolveAvailableApps(principal),
					entitlementGroups: resolveEntitlementGroups(principal),
					permissions: principal.permissions,
					restrictedSurfacesReady: resolveRestrictedSurfacesReady(principal),
				},
				preferences: {
					profileMemoryEnabled: profileMemory.enabled,
					profileMemoryItemCount: profileMemory.itemCount,
				},
				federation: {
					connectedClients: [],
					enabled: false,
				},
			};
		},
	};
}
