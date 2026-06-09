import { randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type { ProfileMemoryStore } from "../profile-memory";
import type {
	EndUserPrincipal,
	IdentityCampusAttributes,
	IdentityPlatformAccess,
	IdentityPlatformAuthorizedApp,
	IdentityPlatformIdentity,
	IdentityPlatformOverview,
	IdentityPlatformPreferences,
	IdentityPlatformSecuritySession,
} from "./model";
import type { IdentityPlatformStore } from "./store";

const END_USER_PRINCIPAL_TYPES = new Set(["campus_member", "student", "staff", "faculty"]);
const DEFAULT_CLAIMS_VERSION = "identity-claims-v1";

export interface IdentityPlatformService {
	deleteAuthorizedApp(input: { clientId: string; principal: ResolvedAppPrincipal }): Promise<void>;
	deleteSecuritySession(input: {
		principal: ResolvedAppPrincipal;
		sessionId: string;
	}): Promise<void>;
	getAccess(input: { principal: ResolvedAppPrincipal }): Promise<IdentityPlatformAccess>;
	getAuthorizedApps(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ authorizedApps: IdentityPlatformAuthorizedApp[] }>;
	getIdentity(input: { principal: ResolvedAppPrincipal }): Promise<IdentityPlatformIdentity>;
	getOverview(input: { principal: ResolvedAppPrincipal }): Promise<IdentityPlatformOverview>;
	getPreferences(input: { principal: ResolvedAppPrincipal }): Promise<IdentityPlatformPreferences>;
	getSecuritySessions(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ sessions: IdentityPlatformSecuritySession[] }>;
	materializeSessionProjection(input: { principal: ResolvedAppPrincipal }): Promise<void>;
	updatePreferences(input: {
		principal: ResolvedAppPrincipal;
		profileMemoryEnabled: boolean;
	}): Promise<IdentityPlatformPreferences>;
}

export interface IdentityPlatformServiceDependencies {
	generateId?: (prefix: string) => string;
	identityStore: IdentityPlatformStore;
	now?: () => Date;
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

function createNotFoundError(input: { code: string; message: string }): AppApiRouteError {
	return new AppApiRouteError({
		code: input.code,
		message: input.message,
		retryable: false,
		status: 404,
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

function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function formatDeviceLabel(userAgent: string | null): string {
	const normalized = userAgent?.toLowerCase() ?? "";
	if (!normalized) {
		return "未知设备";
	}

	const browser = normalized.includes("edg/")
		? "Edge"
		: normalized.includes("firefox/")
			? "Firefox"
			: normalized.includes("safari/") && !normalized.includes("chrome/")
				? "Safari"
				: normalized.includes("chrome/")
					? "Chrome"
					: "浏览器";
	const platform =
		normalized.includes("iphone") || normalized.includes("ipad")
			? "iOS"
			: normalized.includes("android")
				? "Android"
				: normalized.includes("mac os")
					? "macOS"
					: normalized.includes("windows")
						? "Windows"
						: normalized.includes("linux")
							? "Linux"
							: "设备";

	return `${browser} / ${platform}`;
}

function buildOverview(input: {
	preferences: IdentityPlatformPreferences;
	principal: EndUserPrincipal;
}): IdentityPlatformOverview {
	const campusAttributes = buildCampusAttributes(input.principal);
	const identity = {
		claimsVersion: resolveClaimsVersion(input.principal),
		principalId: input.principal.principal.principalId,
		principalType: input.principal.principal.type,
		verificationStatus: "unverified" as const,
	};

	return {
		account: {
			accountId: input.principal.principal.principalId,
			displayName: input.principal.principal.displayName,
			email: input.principal.principal.email,
			status: "active",
		},
		session: {
			credentialRuntime: "better_auth",
			expiresAt: input.principal.session.expiresAt,
			sessionId: input.principal.session.sessionId,
			state: "authenticated",
		},
		identity: campusAttributes ? { ...identity, campusAttributes } : identity,
		access: {
			availableApps: resolveAvailableApps(input.principal),
			entitlementGroups: resolveEntitlementGroups(input.principal),
			permissions: input.principal.permissions,
			restrictedSurfacesReady: resolveRestrictedSurfacesReady(input.principal),
		},
		preferences: input.preferences,
		federation: {
			connectedClients: [],
			enabled: false,
		},
	};
}

function toPreferences(summary: {
	enabled: boolean;
	itemCount: number;
}): IdentityPlatformPreferences {
	return {
		profileMemoryEnabled: summary.enabled,
		profileMemoryItemCount: summary.itemCount,
	};
}

async function buildCurrentOverview(input: {
	principal: ResolvedAppPrincipal;
	profileMemoryStore: Pick<ProfileMemoryStore, "loadSummary">;
}): Promise<{
	overview: IdentityPlatformOverview;
	principal: EndUserPrincipal;
}> {
	const principal = requireEndUserPrincipal(input.principal);
	const preferences = toPreferences(
		await input.profileMemoryStore.loadSummary({
			ownerUserId: principal.principal.principalId,
		}),
	);
	return {
		overview: buildOverview({ preferences, principal }),
		principal,
	};
}

export function buildIdentityPlatformService(
	dependencies: IdentityPlatformServiceDependencies,
): IdentityPlatformService {
	const generateId = dependencies.generateId ?? defaultGenerateId;
	const now = dependencies.now ?? (() => new Date());

	return {
		async deleteAuthorizedApp(input) {
			const principal = requireEndUserPrincipal(input.principal);
			const revoked = await dependencies.identityStore.revokeAuthorizedApp({
				accountId: principal.principal.principalId,
				clientId: input.clientId,
				revokedAt: now().toISOString(),
			});
			if (!revoked) {
				throw createNotFoundError({
					code: "authorized_app_not_found",
					message: "Authorized application was not found.",
				});
			}
		},

		async deleteSecuritySession(input) {
			const principal = requireEndUserPrincipal(input.principal);
			const revoked = await dependencies.identityStore.revokeSecuritySession({
				accountId: principal.principal.principalId,
				sessionId: input.sessionId,
			});
			if (!revoked) {
				throw createNotFoundError({
					code: "account_session_not_found",
					message: "Account session was not found.",
				});
			}
		},

		async getAccess(input) {
			const { overview } = await buildCurrentOverview({
				principal: input.principal,
				profileMemoryStore: dependencies.profileMemoryStore,
			});
			return overview.access;
		},

		async getAuthorizedApps(input) {
			const principal = requireEndUserPrincipal(input.principal);
			const authorizedApps = await dependencies.identityStore.listAuthorizedApps({
				accountId: principal.principal.principalId,
			});
			return { authorizedApps };
		},

		async getIdentity(input) {
			const { overview } = await buildCurrentOverview({
				principal: input.principal,
				profileMemoryStore: dependencies.profileMemoryStore,
			});
			return overview.identity;
		},

		async getOverview(input) {
			const { overview } = await buildCurrentOverview({
				principal: input.principal,
				profileMemoryStore: dependencies.profileMemoryStore,
			});
			await dependencies.identityStore.materializeIdentityProjection({
				observedAt: now().toISOString(),
				projection: overview,
				snapshotId: generateId("access_snapshot"),
			});
			return overview;
		},

		async materializeSessionProjection(input) {
			const { overview } = await buildCurrentOverview({
				principal: input.principal,
				profileMemoryStore: dependencies.profileMemoryStore,
			});
			await dependencies.identityStore.materializeIdentityProjection({
				observedAt: now().toISOString(),
				projection: overview,
				snapshotId: generateId("access_snapshot"),
			});
		},

		async getPreferences(input) {
			const principal = requireEndUserPrincipal(input.principal);
			return toPreferences(
				await dependencies.profileMemoryStore.loadSummary({
					ownerUserId: principal.principal.principalId,
				}),
			);
		},

		async getSecuritySessions(input) {
			const principal = requireEndUserPrincipal(input.principal);
			const sessions = await dependencies.identityStore.listSecuritySessions({
				accountId: principal.principal.principalId,
			});
			return {
				sessions: sessions.map((session) => ({
					createdAt: session.createdAt,
					current: session.sessionId === principal.session.sessionId,
					deviceLabel: formatDeviceLabel(session.userAgent),
					expiresAt: session.expiresAt,
					lastActiveAt: session.lastActiveAt,
					sessionId: session.sessionId,
				})),
			};
		},

		async updatePreferences(input) {
			const principal = requireEndUserPrincipal(input.principal);
			const currentPreferences = toPreferences(
				await dependencies.profileMemoryStore.loadSummary({
					ownerUserId: principal.principal.principalId,
				}),
			);
			const preferences = {
				...currentPreferences,
				profileMemoryEnabled: input.profileMemoryEnabled,
			};
			const overview = buildOverview({ preferences, principal });

			await dependencies.identityStore.updatePreferencesAndMaterialize({
				observedAt: now().toISOString(),
				overview,
				snapshotId: generateId("access_snapshot"),
			});

			return preferences;
		},
	};
}
